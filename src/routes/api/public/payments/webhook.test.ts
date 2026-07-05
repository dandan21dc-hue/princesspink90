import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

// Integration test for `src/routes/api/public/payments/webhook.ts`.
//
// Covers:
//   1. Signature verification via the REAL `verifyWebhook`:
//      - valid signature → 200
//      - invalid signature → 400
//      - missing signature header → 400
//      - stale timestamp (>5 min) → 400
//      - missing/invalid `?env=` query parameter → 200 + `ignored`
//   2. Event → database mapping for each PriceId / metadata shape:
//      - customer.subscription.created  → subscriptions row (price_id from lookup_key)
//      - customer.subscription.updated  → row updated in place
//      - customer.subscription.deleted  → row status='canceled'
//      - checkout.session.completed + membership=lifetime  → memberships.kind='lifetime'
//      - checkout.session.completed + membership=term_pass (3/6/12) → memberships.kind='term_pass_N'
//      - checkout.session.completed + booking=private_room  → private_room_bookings.status='confirmed'
//      - checkout.session.completed + content_item_id  → content_purchases row
//      - checkout.session.completed with mode != 'payment' or missing userId → no-op

// ---- Env -------------------------------------------------------------------

const WEBHOOK_SECRET = 'whsec_test_sandbox_secret'
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv',
    PAYMENTS_SANDBOX_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NODE_ENV: 'test',
  }
  resetDb()
})
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.clearAllMocks()
})

// ---- Supabase mock ---------------------------------------------------------

type Row = Record<string, unknown>
const db: {
  subscriptions: Row[]
  memberships: Row[]
  private_room_bookings: Row[]
  content_items: Row[]
  content_purchases: Row[]
  notifications: Row[]
} = {
  subscriptions: [],
  memberships: [],
  private_room_bookings: [],
  content_items: [],
  content_purchases: [],
  notifications: [],
}

function resetDb() {
  for (const k of Object.keys(db) as Array<keyof typeof db>) db[k].length = 0
}

function makeChain(table: keyof typeof db) {
  const filters: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return chain
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const row = db[table].find((r) => filters.every(([c, v]) => (r as Row)[c] === v))
      return { data: row ?? null, error: null }
    },
    then: undefined,
  }
  ;(chain as unknown as { then: unknown }).then = (
    resolve: (v: { data: Row[]; error: null }) => void,
  ) => {
    const rows = db[table].filter((r) => filters.every(([c, v]) => (r as Row)[c] === v))
    resolve({ data: rows, error: null })
  }
  return chain
}

function makeSupabase() {
  return {
    from: (table: keyof typeof db) => ({
      ...makeChain(table),
      insert: (payload: Row | Row[]) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        db[table].push(...rows)
        return Promise.resolve({ data: rows, error: null })
      },
      upsert: (payload: Row, opts?: { onConflict?: string }) => {
        const conflictCols = opts?.onConflict?.split(',').map((s) => s.trim()) ?? []
        const idx = db[table].findIndex((r) =>
          conflictCols.every((c) => (r as Row)[c] === payload[c]),
        )
        if (idx >= 0) db[table][idx] = { ...db[table][idx], ...payload }
        else db[table].push(payload)
        return Promise.resolve({ data: payload, error: null })
      },
      update: (payload: Row) => {
        const upd: Record<string, unknown> = { _filters: [] as Array<[string, unknown]> }
        const updChain = {
          eq: (col: string, val: unknown) => {
            ;(upd._filters as Array<[string, unknown]>).push([col, val])
            // resolve after both eq() calls chained via .eq().eq() — apply immediately
            for (const r of db[table]) {
              if ((upd._filters as Array<[string, unknown]>).every(([c, v]) => (r as Row)[c] === v)) {
                Object.assign(r, payload)
              }
            }
            return updChain
          },
          then: (resolve: (v: { data: null; error: null }) => void) =>
            resolve({ data: null, error: null }),
        }
        return updChain
      },
    }),
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabase(),
}))

// ---- Signed request helpers -----------------------------------------------

function sign(body: string, secretOverride?: string, timestampOverride?: number) {
  const t = timestampOverride ?? Math.floor(Date.now() / 1000)
  const secret = secretOverride ?? WEBHOOK_SECRET
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${sig}`
}

async function postWebhook(opts: {
  body: unknown
  env?: string | null
  signature?: string | null
  useValidSignature?: boolean
  timestamp?: number
  secret?: string
}) {
  // For checkout.session.completed events, default payment_status to 'paid'
  // so pre-existing tests keep asserting the "funds settled → grant" path.
  // Tests that specifically exercise unpaid/async gating set it explicitly.
  const rawBody = opts.body as any
  if (
    rawBody?.type === 'checkout.session.completed' &&
    rawBody?.data?.object &&
    rawBody.data.object.payment_status === undefined
  ) {
    rawBody.data.object.payment_status = 'paid'
  }
  const body = JSON.stringify(opts.body)
  let signature: string | null | undefined = opts.signature
  if (signature === undefined) {
    signature = opts.useValidSignature === false
      ? 't=' + Math.floor(Date.now() / 1000) + ',v1=deadbeef'
      : sign(body, opts.secret, opts.timestamp)
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== null) headers['stripe-signature'] = signature

  const envParam = opts.env === undefined ? 'sandbox' : opts.env
  const url = envParam === null
    ? 'https://app.example.com/api/public/payments/webhook'
    : `https://app.example.com/api/public/payments/webhook?env=${envParam}`

  const mod = await import('@/routes/api/public/payments/webhook')
  const handler = (mod as any).Route.options.server.handlers.POST
  const res: Response = await handler({
    request: new Request(url, { method: 'POST', headers, body }),
  })
  return { status: res.status, body: await res.clone().json().catch(async () => await res.text()) }
}

const USER_ID = 'user_abc_123'

// ---- 1. Signature verification --------------------------------------------

describe('webhook signature verification', () => {
  it('accepts a correctly signed request and returns 200', async () => {
    const res = await postWebhook({
      body: { type: 'nothing.interesting', data: { object: {} } },
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
  })

  it('rejects a request with an invalid v1 signature (400)', async () => {
    const res = await postWebhook({
      body: { type: 'customer.subscription.created', data: { object: {} } },
      useValidSignature: false,
    })
    expect(res.status).toBe(400)
  })

  it('rejects a request missing the stripe-signature header (400)', async () => {
    const res = await postWebhook({
      body: { type: 'customer.subscription.created', data: { object: {} } },
      signature: null,
    })
    expect(res.status).toBe(400)
  })

  it('rejects a stale timestamp (>5 minute skew) as replay protection', async () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 10 // 10 minutes ago
    const res = await postWebhook({
      body: { type: 'customer.subscription.created', data: { object: {} } },
      timestamp: stale,
    })
    expect(res.status).toBe(400)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const res = await postWebhook({
      body: { type: 'customer.subscription.created', data: { object: {} } },
      secret: 'whsec_WRONG',
    })
    expect(res.status).toBe(400)
  })

  it('ignores requests with a missing ?env= query parameter (200 + ignored)', async () => {
    const res = await postWebhook({
      body: { type: 'x', data: { object: {} } },
      env: null,
      signature: 'ignored', // never reaches verify
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, ignored: 'invalid env' })
  })

  it('ignores requests with an invalid ?env= value (200 + ignored)', async () => {
    const res = await postWebhook({
      body: { type: 'x', data: { object: {} } },
      env: 'staging',
      signature: 'ignored',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, ignored: 'invalid env' })
  })
})

// ---- 2. Event → database mapping ------------------------------------------

describe('webhook event → database mapping', () => {
  it('customer.subscription.created seeds a subscriptions row with price_id from lookup_key', async () => {
    const periodStart = Math.floor(Date.now() / 1000)
    const periodEnd = periodStart + 30 * 86400
    const res = await postWebhook({
      body: {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_month_1',
            customer: 'cus_test_123',
            status: 'active',
            cancel_at_period_end: false,
            metadata: { userId: USER_ID },
            items: {
              data: [
                {
                  current_period_start: periodStart,
                  current_period_end: periodEnd,
                  price: {
                    id: 'price_all_access_monthly_aud',
                    lookup_key: 'all_access_monthly_aud',
                    product: 'prod_all_access_monthly_aud',
                  },
                },
              ],
            },
          },
        },
      },
    })
    expect(res.status).toBe(200)
    const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_month_1')
    expect(row).toBeDefined()
    expect(row?.user_id).toBe(USER_ID)
    expect(row?.price_id).toBe('all_access_monthly_aud') // lookup_key wins over Stripe id
    expect(row?.product_id).toBe('prod_all_access_monthly_aud')
    expect(row?.status).toBe('active')
    expect(row?.environment).toBe('sandbox')
    expect(row?.current_period_end).toBe(new Date(periodEnd * 1000).toISOString())
  })

  it('falls back to metadata.lovable_external_id when lookup_key is absent', async () => {
    await postWebhook({
      body: {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_legacy_1',
            customer: 'cus_legacy',
            status: 'active',
            metadata: { userId: USER_ID },
            items: {
              data: [
                {
                  price: {
                    id: 'price_xyz',
                    metadata: { lovable_external_id: 'legacy_priceid' },
                    product: 'prod_legacy',
                  },
                },
              ],
            },
          },
        },
      },
    })
    const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_legacy_1')
    expect(row?.price_id).toBe('legacy_priceid')
  })

  it('ignores subscription events without metadata.userId (no row written)', async () => {
    const res = await postWebhook({
      body: {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_no_user',
            customer: 'cus_x',
            status: 'active',
            metadata: {},
            items: { data: [{ price: { lookup_key: 'x' } }] },
          },
        },
      },
    })
    expect(res.status).toBe(200)
    expect(db.subscriptions).toHaveLength(0)
  })

  it('customer.subscription.updated toggles cancel_at_period_end on the existing row', async () => {
    // seed
    db.subscriptions.push({
      stripe_subscription_id: 'sub_update_1',
      user_id: USER_ID,
      status: 'active',
      cancel_at_period_end: false,
      environment: 'sandbox',
    })
    await postWebhook({
      body: {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_update_1',
            customer: 'cus_test_123',
            status: 'active',
            cancel_at_period_end: true,
            metadata: { userId: USER_ID },
            items: {
              data: [
                {
                  price: {
                    lookup_key: 'all_access_monthly_aud',
                    product: 'prod_all_access_monthly_aud',
                  },
                },
              ],
            },
          },
        },
      },
    })
    const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_update_1')
    expect(row?.cancel_at_period_end).toBe(true)
  })

  it('customer.subscription.deleted flips status to canceled without wiping the row', async () => {
    db.subscriptions.push({
      stripe_subscription_id: 'sub_del_1',
      user_id: USER_ID,
      status: 'active',
      environment: 'sandbox',
      price_id: 'all_access_monthly_aud',
    })
    await postWebhook({
      body: {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_del_1' } },
      },
    })
    const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_del_1')
    expect(row?.status).toBe('canceled')
    expect(row?.price_id).toBe('all_access_monthly_aud') // untouched
  })

  it('checkout.session.completed with membership=lifetime writes memberships.kind=lifetime', async () => {
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_lifetime_1',
            mode: 'payment',
            amount_total: 50000,
            metadata: { userId: USER_ID, membership: 'lifetime' },
          },
        },
      },
    })
    const row = db.memberships.find((r) => r.user_id === USER_ID)
    expect(row?.kind).toBe('lifetime')
    expect(row?.environment).toBe('sandbox')
    expect(row?.amount_cents).toBe(50000)
    expect(row?.expires_at).toBeUndefined()
  })

  for (const months of [3, 6, 12] as const) {
    it(`checkout.session.completed with membership=term_pass (${months} mo) sets expires_at = now + ${months} months`, async () => {
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: `cs_term_${months}`,
              mode: 'payment',
              amount_total: 1000,
              metadata: {
                userId: USER_ID,
                membership: 'term_pass',
                term_months: String(months),
              },
            },
          },
        },
      })
      const row = db.memberships.find((r) => r.kind === `term_pass_${months}`)
      expect(row).toBeDefined()
      expect(row?.term_months).toBe(months)
      const expiresAt = new Date(row?.expires_at as string).getTime()
      const expected = new Date()
      expected.setMonth(expected.getMonth() + months)
      expect(Math.abs(expiresAt - expected.getTime())).toBeLessThan(60_000)
    })
  }

  it('term_pass renewal extends from the existing expiry, not from now', async () => {
    // Seed an active 3-month pass expiring in ~15 days.
    const existingExpiry = new Date()
    existingExpiry.setDate(existingExpiry.getDate() + 15)
    db.memberships.push({
      user_id: USER_ID,
      kind: 'term_pass_3',
      environment: 'sandbox',
      term_months: 3,
      expires_at: existingExpiry.toISOString(),
    })
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_renew_1',
            mode: 'payment',
            amount_total: 2700,
            metadata: { userId: USER_ID, membership: 'term_pass', term_months: '3' },
          },
        },
      },
    })
    const row = db.memberships.find((r) => r.kind === 'term_pass_3')
    const newExpiry = new Date(row?.expires_at as string).getTime()
    const expected = new Date(existingExpiry)
    expected.setMonth(expected.getMonth() + 3)
    // Must extend from existingExpiry, not now(): >~2.5 months away.
    expect(Math.abs(newExpiry - expected.getTime())).toBeLessThan(60_000)
  })

  it('checkout.session.completed with booking=private_room confirms the pending booking', async () => {
    db.private_room_bookings.push({
      id: 'booking_1',
      user_id: USER_ID,
      status: 'pending',
      environment: 'sandbox',
    })
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_room_1',
            mode: 'payment',
            amount_total: 27500,
            customer_details: { email: 'buyer@example.com' },
            metadata: {
              userId: USER_ID,
              booking: 'private_room',
              private_room_booking_id: 'booking_1',
            },
          },
        },
      },
    })
    const row = db.private_room_bookings.find((r) => r.id === 'booking_1')
    expect(row?.status).toBe('confirmed')
    expect(row?.stripe_session_id).toBe('cs_room_1')
    expect(row?.amount_cents).toBe(27500)
    expect(row?.customer_email).toBe('buyer@example.com')
  })

  it('checkout.session.completed with content_item_id records a content purchase', async () => {
    db.content_items.push({
      id: 'content_1',
      creator_id: 'creator_1',
      title: 'Test Set',
    })
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_content_1',
            mode: 'payment',
            amount_total: 1500,
            metadata: { userId: USER_ID, content_item_id: 'content_1' },
          },
        },
      },
    })
    const row = db.content_purchases.find((r) => r.content_item_id === 'content_1')
    expect(row).toBeDefined()
    expect(row?.user_id).toBe(USER_ID)
    expect(row?.stripe_session_id).toBe('cs_content_1')
    expect(row?.amount_cents).toBe(1500)
    expect(row?.environment).toBe('sandbox')
  })

  it('checkout.session.completed with mode != "payment" is a no-op', async () => {
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_setup_1',
            mode: 'setup',
            metadata: { userId: USER_ID, membership: 'lifetime' },
          },
        },
      },
    })
    expect(db.memberships).toHaveLength(0)
  })

  it('checkout.session.completed without metadata.userId is a no-op', async () => {
    await postWebhook({
      body: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_anon_1',
            mode: 'payment',
            metadata: { membership: 'lifetime' },
          },
        },
      },
    })
    expect(db.memberships).toHaveLength(0)
  })

  // ---- payment_status gate + async payment lifecycle ----------------------

  describe('payment_status gate + async payment events', () => {
    it('checkout.session.completed with payment_status="unpaid" grants nothing', async () => {
      // Async payment methods (some bank debits, wallets) complete the session
      // BEFORE funds settle — payment_status is "unpaid" at this point. We
      // must not write memberships/purchases yet; that happens later on
      // checkout.session.async_payment_succeeded.
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_pending_1',
              mode: 'payment',
              payment_status: 'unpaid',
              amount_total: 50000,
              metadata: { userId: USER_ID, membership: 'lifetime' },
            },
          },
        },
      })
      expect(db.memberships).toHaveLength(0)
    })

    it('checkout.session.completed with payment_status="unpaid" does NOT confirm a private-room booking', async () => {
      db.private_room_bookings.push({
        id: 'booking_pending',
        user_id: USER_ID,
        status: 'pending',
        environment: 'sandbox',
      })
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_room_pending',
              mode: 'payment',
              payment_status: 'unpaid',
              amount_total: 27500,
              metadata: {
                userId: USER_ID,
                booking: 'private_room',
                private_room_booking_id: 'booking_pending',
              },
            },
          },
        },
      })
      const row = db.private_room_bookings.find((r) => r.id === 'booking_pending')
      // Slot stays pending — we haven't been paid yet, so we don't confirm.
      expect(row?.status).toBe('pending')
    })

    it('checkout.session.async_payment_succeeded grants the entitlement once funds settle', async () => {
      // First: the initial "completed" arrives unpaid and grants nothing.
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_async_ok',
              mode: 'payment',
              payment_status: 'unpaid',
              amount_total: 50000,
              metadata: { userId: USER_ID, membership: 'lifetime' },
            },
          },
        },
      })
      expect(db.memberships).toHaveLength(0)

      // Later: funds settle. Stripe re-delivers the same session object
      // with payment_status='paid' under async_payment_succeeded.
      await postWebhook({
        body: {
          type: 'checkout.session.async_payment_succeeded',
          data: {
            object: {
              id: 'cs_async_ok',
              mode: 'payment',
              payment_status: 'paid',
              amount_total: 50000,
              metadata: { userId: USER_ID, membership: 'lifetime' },
            },
          },
        },
      })
      const row = db.memberships.find((r) => r.stripe_session_id === 'cs_async_ok')
      expect(row?.kind).toBe('lifetime')
      expect(row?.user_id).toBe(USER_ID)
    })

    it('checkout.session.async_payment_failed releases the pending private-room booking', async () => {
      db.private_room_bookings.push({
        id: 'booking_async_fail',
        user_id: USER_ID,
        status: 'pending',
        environment: 'sandbox',
      })
      await postWebhook({
        body: {
          type: 'checkout.session.async_payment_failed',
          data: {
            object: {
              id: 'cs_async_fail',
              mode: 'payment',
              payment_status: 'unpaid',
              metadata: {
                userId: USER_ID,
                booking: 'private_room',
                private_room_booking_id: 'booking_async_fail',
              },
            },
          },
        },
      })
      const row = db.private_room_bookings.find((r) => r.id === 'booking_async_fail')
      expect(row?.status).toBe('canceled')
      expect(row?.stripe_session_id).toBe('cs_async_fail')
    })

    it('checkout.session.async_payment_failed for a non-booking session is a safe no-op', async () => {
      // A failed async lifetime purchase: we never granted anything, and
      // there is no booking row to release, so this event must not throw
      // or write anything.
      await postWebhook({
        body: {
          type: 'checkout.session.async_payment_failed',
          data: {
            object: {
              id: 'cs_async_fail_life',
              mode: 'payment',
              payment_status: 'unpaid',
              metadata: { userId: USER_ID, membership: 'lifetime' },
            },
          },
        },
      })
      expect(db.memberships).toHaveLength(0)
    })
  })

  it('unhandled event types are accepted (200) without touching the database', async () => {
    const res = await postWebhook({
      body: {
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_test' } },
      },
    })
    expect(res.status).toBe(200)
    expect(db.subscriptions).toHaveLength(0)
    expect(db.memberships).toHaveLength(0)
    expect(db.content_purchases).toHaveLength(0)
  })
})

// ---- 3. userId + plan metadata parsing ------------------------------------
//
// Focused regression tests: every code path that reads `userId` or plan
// metadata off a Stripe checkout / subscription payload must associate the
// right user with the right plan. If the webhook ever reads from the wrong
// field (e.g. `session.client_reference_id` instead of `metadata.userId`,
// or `metadata.plan` instead of `metadata.membership`), these break.

describe('userId + plan metadata parsing', () => {
  describe('subscription checkout sessions (customer.subscription.*)', () => {
    it('reads userId from subscription.metadata.userId', async () => {
      await postWebhook({
        body: {
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_meta_user',
              customer: 'cus_meta',
              status: 'active',
              // userId lives on subscription.metadata (subscription_data.metadata
              // at checkout creation time), NOT on session.metadata.
              metadata: { userId: 'user_from_sub_metadata' },
              items: {
                data: [{ price: { lookup_key: 'all_access_monthly_aud' } }],
              },
            },
          },
        },
      })
      const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_meta_user')
      expect(row?.user_id).toBe('user_from_sub_metadata')
    })

    it('records the plan via price.lookup_key (canonical human-readable id)', async () => {
      await postWebhook({
        body: {
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_plan_lookup',
              customer: 'cus_x',
              status: 'active',
              metadata: { userId: USER_ID },
              items: {
                data: [
                  {
                    price: {
                      id: 'price_stripe_internal_xxx', // must be ignored
                      lookup_key: 'all_access_monthly_aud',
                      product: 'prod_all_access',
                    },
                  },
                ],
              },
            },
          },
        },
      })
      const row = db.subscriptions.find((r) => r.stripe_subscription_id === 'sub_plan_lookup')
      expect(row?.price_id).toBe('all_access_monthly_aud')
      expect(row?.price_id).not.toBe('price_stripe_internal_xxx')
    })

    it('does NOT read userId from session-level fields on a subscription payload', async () => {
      // If handler mistakenly used e.g. customer or client_reference_id,
      // this test still writes a row — but user_id must come from metadata.
      await postWebhook({
        body: {
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_no_meta',
              customer: 'cus_should_not_be_user_id',
              client_reference_id: 'client_ref_should_not_be_user_id',
              status: 'active',
              metadata: {}, // no userId
              items: { data: [{ price: { lookup_key: 'all_access_monthly_aud' } }] },
            },
          },
        },
      })
      expect(db.subscriptions).toHaveLength(0)
    })
  })

  describe('payment checkout sessions (checkout.session.completed)', () => {
    it('reads userId from session.metadata.userId for lifetime purchases', async () => {
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_life_meta',
              mode: 'payment',
              amount_total: 50000,
              // Note: session.metadata (not subscription_data.metadata) for one-off payments.
              metadata: { userId: 'user_from_session_metadata', membership: 'lifetime' },
            },
          },
        },
      })
      const row = db.memberships.find((r) => r.stripe_session_id === 'cs_life_meta')
      expect(row?.user_id).toBe('user_from_session_metadata')
      expect(row?.kind).toBe('lifetime')
    })

    it.each([3, 6, 12] as const)(
      'reads plan=term_pass + term_months=%i and stores kind=term_pass_%i',
      async (months) => {
        await postWebhook({
          body: {
            type: 'checkout.session.completed',
            data: {
              object: {
                id: `cs_plan_term_${months}`,
                mode: 'payment',
                amount_total: 1000,
                metadata: {
                  userId: USER_ID,
                  membership: 'term_pass',
                  term_months: String(months), // Stripe metadata is always string
                },
              },
            },
          },
        })
        const row = db.memberships.find((r) => r.stripe_session_id === `cs_plan_term_${months}`)
        expect(row?.user_id).toBe(USER_ID)
        expect(row?.kind).toBe(`term_pass_${months}`)
        expect(row?.term_months).toBe(months)
      },
    )

    it('rejects term_pass with an unsupported term_months value', async () => {
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_bad_term',
              mode: 'payment',
              amount_total: 1000,
              metadata: { userId: USER_ID, membership: 'term_pass', term_months: '9' },
            },
          },
        },
      })
      expect(db.memberships.find((r) => r.stripe_session_id === 'cs_bad_term')).toBeUndefined()
    })

    it('reads content_item_id from session.metadata and links purchase to userId', async () => {
      db.content_items.push({ id: 'content_meta_1', creator_id: 'creator_x', title: 'X' })
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_content_meta',
              mode: 'payment',
              amount_total: 999,
              metadata: {
                userId: 'buyer_user_id',
                content_item_id: 'content_meta_1',
              },
            },
          },
        },
      })
      const row = db.content_purchases.find((r) => r.stripe_session_id === 'cs_content_meta')
      expect(row?.user_id).toBe('buyer_user_id')
      expect(row?.content_item_id).toBe('content_meta_1')
    })

    it('reads booking=private_room + private_room_booking_id from metadata', async () => {
      db.private_room_bookings.push({
        id: 'booking_meta_1',
        user_id: USER_ID,
        status: 'pending',
        environment: 'sandbox',
      })
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_booking_meta',
              mode: 'payment',
              amount_total: 27500,
              customer_details: { email: 'b@e.com' },
              metadata: {
                userId: USER_ID,
                booking: 'private_room',
                private_room_booking_id: 'booking_meta_1',
              },
            },
          },
        },
      })
      const row = db.private_room_bookings.find((r) => r.id === 'booking_meta_1')
      expect(row?.status).toBe('confirmed')
      expect(row?.stripe_session_id).toBe('cs_booking_meta')
    })

    it('ignores payment sessions when metadata.userId is missing (all plan shapes)', async () => {
      const shapes = [
        { membership: 'lifetime' },
        { membership: 'term_pass', term_months: '3' },
        { content_item_id: 'content_meta_1' },
        { booking: 'private_room', private_room_booking_id: 'booking_meta_1' },
      ]
      for (const [i, meta] of shapes.entries()) {
        await postWebhook({
          body: {
            type: 'checkout.session.completed',
            data: {
              object: {
                id: `cs_no_user_${i}`,
                mode: 'payment',
                amount_total: 1000,
                metadata: meta, // no userId
              },
            },
          },
        })
      }
      expect(db.memberships).toHaveLength(0)
      expect(db.content_purchases).toHaveLength(0)
      // no pre-seeded booking either → nothing was updated
      expect(db.private_room_bookings.filter((r) => r.status === 'confirmed')).toHaveLength(0)
    })

    it('routes to the correct table based on which plan metadata key is present', async () => {
      // lifetime → memberships (not content_purchases, not private_room_bookings)
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_route_life',
              mode: 'payment',
              amount_total: 50000,
              metadata: { userId: USER_ID, membership: 'lifetime' },
            },
          },
        },
      })
      expect(db.memberships.some((r) => r.stripe_session_id === 'cs_route_life')).toBe(true)
      expect(db.content_purchases.some((r) => r.stripe_session_id === 'cs_route_life')).toBe(false)

      // content_item_id → content_purchases (not memberships)
      db.content_items.push({ id: 'ci_route', creator_id: 'c', title: 't' })
      await postWebhook({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_route_content',
              mode: 'payment',
              amount_total: 500,
              metadata: { userId: USER_ID, content_item_id: 'ci_route' },
            },
          },
        },
      })
      expect(db.content_purchases.some((r) => r.stripe_session_id === 'cs_route_content')).toBe(true)
      expect(db.memberships.some((r) => r.stripe_session_id === 'cs_route_content')).toBe(false)
    })
  })
})
