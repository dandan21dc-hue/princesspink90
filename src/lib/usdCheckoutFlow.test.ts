import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// End-to-end verification of the Stripe checkout flow for every USD plan.
// Mirrors `stripeCheckoutFlow.test.ts` (AUD) — same three-link chain per
// plan (session build → webhook → library unlock), but exercises the USD
// lookup keys the checkout function already routes.
//
// USD plans covered:
//   all_access_monthly        (recurring)
//   all_access_3mo_onetime    (payment, term_pass 3)
//   all_access_6mo_onetime    (payment, term_pass 6)
//   all_access_12mo_onetime   (payment, term_pass 12)
//   lifetime_onetime          (payment, lifetime membership)

// ---- 1. Stripe SDK stub -----------------------------------------------------

type CreatedSession = {
  mode: string
  ui_mode: string
  return_url: string
  customer?: string
  metadata?: Record<string, string>
  subscription_data?: { metadata?: Record<string, string> }
  payment_intent_data?: { description?: string }
  line_items: Array<{ price: string; quantity: number }>
}

const createdSessions: CreatedSession[] = []

// Recurring lookup keys (both currencies) — the stub uses this to shape
// the fake price object so `stripePrice.type === "recurring"` decides mode.
const RECURRING_KEYS = new Set(['all_access_monthly', 'all_access_monthly_aud'])

function stripeStub() {
  return {
    customers: {
      search: vi.fn(async () => ({ data: [] })),
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ id: 'cus_test_usd' })),
      update: vi.fn(async () => ({ id: 'cus_test_usd' })),
    },
    prices: {
      list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => {
        const key = lookup_keys[0]!
        return {
          data: [
            {
              id: `price_${key}`,
              type: RECURRING_KEYS.has(key) ? 'recurring' : 'one_time',
              product: `prod_${key}`,
            },
          ],
        }
      }),
    },
    products: {
      retrieve: vi.fn(async (id: string) => ({ id, name: `Product ${id}` })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (params: CreatedSession) => {
          createdSessions.push(params)
          return {
            id: `cs_usd_${createdSessions.length}`,
            client_secret: `secret_${createdSessions.length}`,
          }
        }),
      },
    },
  }
}

const stripeMock = stripeStub()

vi.mock('@/lib/stripe.server', () => ({
  createStripeClient: () => stripeMock,
  getStripeErrorMessage: (e: unknown) => (e as Error)?.message ?? 'stripe error',
  verifyWebhook: vi.fn(),
}))

// ---- 2. Supabase mock ------------------------------------------------------

type Row = Record<string, unknown>

const db: {
  subscriptions: Row[]
  memberships: Row[]
  content_items: Row[]
  content_purchases: Row[]
  notifications: Row[]
} = {
  subscriptions: [],
  memberships: [],
  content_items: [],
  content_purchases: [],
  notifications: [],
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
        return { select: () => ({ single: async () => ({ data: rows[0], error: null }) }) }
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
      update: (payload: Row) => ({
        eq: (col: string, val: unknown) => {
          for (const r of db[table]) if ((r as Row)[col] === val) Object.assign(r, payload)
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabase(),
}))

vi.mock('@/integrations/supabase/auth-middleware', () => ({
  requireSupabaseAuth: { _tag: 'test-noop' },
}))

// ---- 3. Setup --------------------------------------------------------------

const USER_ID = 'user_usd_test_1'
const RETURN_URL = 'https://app.example.com/library?checkout=success'

const ORIGINAL_ENV = { ...process.env }
beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv',
    SUPABASE_PUBLISHABLE_KEY: 'pub',
    STRIPE_SANDBOX_API_KEY: 'sk_test',
    LOVABLE_API_KEY: 'lv_test',
    NODE_ENV: 'development',
  }
  createdSessions.length = 0
  db.subscriptions.length = 0
  db.memberships.length = 0
  db.content_items.length = 0
  db.content_purchases.length = 0
  db.notifications.length = 0
  stripeMock.checkout.sessions.create.mockClear()
  stripeMock.prices.list.mockClear()
})
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

async function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const { runWithStartContext } = await import('@tanstack/start-storage-context')
  return runWithStartContext(
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getRouter: (async () => ({}) as any) as any,
      request: new Request('http://localhost/test'),
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: 'serverFn',
    },
    fn,
  )
}

async function checkout(priceId: string) {
  const mod = await import('@/lib/store.functions')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = mod.createStoreCheckoutSession as unknown as any
  return withStartContext(() =>
    fn({
      data: {
        priceId,
        userId: USER_ID,
        customerEmail: 'buyer@example.com',
        returnUrl: RETURN_URL,
        environment: 'sandbox',
      },
    }),
  )
}

async function fireWebhook(event: { type: string; data: { object: unknown } }) {
  const stripeServer = await import('@/lib/stripe.server')
  ;(stripeServer.verifyWebhook as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event)
  const mod = await import('@/routes/api/public/payments/webhook')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (mod as any).Route.options.server.handlers.POST
  const req = new Request(
    'https://app.example.com/api/public/payments/webhook?env=sandbox',
    { method: 'POST', headers: { 'stripe-signature': 'test' }, body: '{}' },
  )
  const res = await handler({ request: req })
  return res.json()
}

function libraryHasAccess(): boolean {
  const now = Date.now()
  const sub = db.subscriptions.find(
    (r) => r.user_id === USER_ID && r.environment === 'sandbox',
  )
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end as string).getTime()
    : null
  const hasRecurring =
    !!sub &&
    ((['active', 'trialing', 'past_due'].includes(sub.status as string) &&
      (!periodEnd || periodEnd > now)) ||
      (sub.status === 'canceled' && !!periodEnd && periodEnd > now))
  const hasMembership = db.memberships
    .filter((m) => m.user_id === USER_ID && m.environment === 'sandbox')
    .some((m) => {
      if (m.kind === 'lifetime') return true
      if (
        typeof m.kind === 'string' &&
        m.kind.startsWith('term_pass_') &&
        m.expires_at
      ) {
        return new Date(m.expires_at as string).getTime() > now
      }
      return false
    })
  return hasRecurring || hasMembership
}

// ---- 4. Assertions per plan (USD) -----------------------------------------

describe('Stripe checkout flow end-to-end — USD plans', () => {
  it('monthly USD: subscription mode, correct price + metadata, webhook → library unlocks', async () => {
    await checkout('all_access_monthly')
    const s = createdSessions[0]!
    expect(s.mode).toBe('subscription')
    expect(s.ui_mode).toBe('embedded_page')
    expect(s.return_url).toBe(RETURN_URL)
    expect(s.line_items[0]!.price).toBe('price_all_access_monthly')
    expect(s.metadata?.userId).toBe(USER_ID)
    expect(s.subscription_data?.metadata?.userId).toBe(USER_ID)
    // USD subscription must NOT carry membership metadata.
    expect(s.metadata?.membership).toBeUndefined()
    expect(s.metadata?.term_months).toBeUndefined()

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400
    await fireWebhook({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_usd_month_1',
          customer: 'cus_test_usd',
          status: 'active',
          cancel_at_period_end: false,
          metadata: { userId: USER_ID },
          items: {
            data: [
              {
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: periodEnd,
                price: {
                  id: 'price_all_access_monthly',
                  lookup_key: 'all_access_monthly',
                  product: 'prod_all_access_monthly',
                },
              },
            ],
          },
        },
      },
    })

    const row = db.subscriptions.find((r) => r.user_id === USER_ID)
    expect(row?.status).toBe('active')
    expect(row?.price_id).toBe('all_access_monthly') // lookup_key (currency-agnostic)
    expect(row?.environment).toBe('sandbox')
    expect(libraryHasAccess()).toBe(true)
  })

  for (const months of [3, 6, 12] as const) {
    it(`${months}-month USD term pass: payment mode, term_pass metadata, memberships.expires_at = +${months}mo`, async () => {
      const priceId = `all_access_${months}mo_onetime`
      await checkout(priceId)
      const s = createdSessions[0]!
      expect(s.mode).toBe('payment')
      expect(s.ui_mode).toBe('embedded_page')
      expect(s.return_url).toBe(RETURN_URL)
      expect(s.line_items[0]!.price).toBe(`price_${priceId}`)
      expect(s.metadata?.userId).toBe(USER_ID)
      expect(s.metadata?.membership).toBe('term_pass')
      expect(s.metadata?.term_months).toBe(String(months))
      expect(s.subscription_data).toBeUndefined()

      await fireWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_usd_term_${months}`,
            mode: 'payment',
            amount_total: months === 3 ? 2700 : months === 6 ? 4800 : 8400,
            metadata: {
              userId: USER_ID,
              membership: 'term_pass',
              term_months: String(months),
            },
          },
        },
      })

      const row = db.memberships.find((r) => r.user_id === USER_ID)
      expect(row?.kind).toBe(`term_pass_${months}`)
      expect(row?.term_months).toBe(months)
      expect(row?.environment).toBe('sandbox')
      const expiresAt = new Date(row?.expires_at as string).getTime()
      const expected = new Date()
      expected.setMonth(expected.getMonth() + months)
      expect(Math.abs(expiresAt - expected.getTime())).toBeLessThan(60_000)
      expect(libraryHasAccess()).toBe(true)
    })
  }

  it('lifetime USD: payment mode, membership=lifetime, memberships.kind=lifetime, no expiry', async () => {
    await checkout('lifetime_onetime')
    const s = createdSessions[0]!
    expect(s.mode).toBe('payment')
    expect(s.metadata?.userId).toBe(USER_ID)
    expect(s.metadata?.membership).toBe('lifetime')
    expect(s.metadata?.term_months).toBeUndefined()
    expect(s.line_items[0]!.price).toBe('price_lifetime_onetime')

    await fireWebhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_usd_lifetime_1',
          mode: 'payment',
          amount_total: 49900,
          metadata: { userId: USER_ID, membership: 'lifetime' },
        },
      },
    })
    const row = db.memberships.find((r) => r.user_id === USER_ID)
    expect(row?.kind).toBe('lifetime')
    expect(row?.environment).toBe('sandbox')
    expect(row?.expires_at).toBeUndefined()
    expect(libraryHasAccess()).toBe(true)
  })
})
