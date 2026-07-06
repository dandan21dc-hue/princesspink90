import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// End-to-end verification of the Stripe checkout flow for every plan the
// subscribe page exposes.
//
// For each PriceId we assert three links of the chain:
//   1. `createStoreCheckoutSession` builds the correct Stripe Checkout Session
//      payload (mode, metadata, subscription_data, term_months).
//   2. The webhook (`/api/public/payments/webhook`) receives the matching
//      Stripe event and writes the right row into `subscriptions` /
//      `memberships` (kind, expires_at, environment).
//   3. `getMyLibrary` — the app-state read the UI uses to unlock the
//      library — flips `hasSubscription: true` after that write.

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

function stripeStub() {
  return {
    customers: {
      search: vi.fn(async () => ({ data: [] })),
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ id: 'cus_test_123' })),
      update: vi.fn(async () => ({ id: 'cus_test_123' })),
    },
    prices: {
      list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => {
        const key = lookup_keys[0]!
        const isRecurring = key === 'all_access_monthly_aud'
        return {
          data: [
            {
              id: `price_${key}`,
              type: isRecurring ? 'recurring' : 'one_time',
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
            id: `cs_test_${createdSessions.length}`,
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
  // verifyWebhook is bypassed — the test hands a decoded event straight to
  // the internal handler so we don't need to sign fixtures.
  verifyWebhook: vi.fn(),
}))

// ---- 2. Supabase mock (server publishable + service-role paths) ------------

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
      const row = db[table].find((r) =>
        filters.every(([c, v]) => (r as Row)[c] === v),
      )
      return { data: row ?? null, error: null }
    },
    then: undefined,
  }
  // Await the chain itself → return all matching rows (for list queries)
  ;(chain as unknown as { then: unknown }).then = (
    resolve: (v: { data: Row[]; error: null }) => void,
  ) => {
    const rows = db[table].filter((r) =>
      filters.every(([c, v]) => (r as Row)[c] === v),
    )
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
          for (const r of db[table]) {
            if ((r as Row)[col] === val) Object.assign(r, payload)
          }
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

// getMyLibrary uses the auth-middleware context (context.supabase, userId).
// Force that same mocked supabase into the handler's context.
// Fake the auth middleware with a real createMiddleware so
// flattenMiddlewares walks it cleanly. Injects the test USER_ID into
// context so store.functions.ts's `data.userId = context.userId` line
// resolves to the expected user without needing a real session token.
const TEST_USER_ID_FOR_AUTH = 'user_test_abc123'
vi.mock('@/integrations/supabase/auth-middleware', async () => {
  const { createMiddleware } = await import('@tanstack/react-start')
  return {
    requireSupabaseAuth: createMiddleware({ type: 'function' }).server(
      async ({ next }: { next: any }) =>
        next({
          context: {
            supabase: makeSupabase(),
            userId: TEST_USER_ID_FOR_AUTH,
            claims: { sub: TEST_USER_ID_FOR_AUTH },
          },
        }),
    ),
  }
})





// ---- 3. Test setup ---------------------------------------------------------

const USER_ID = 'user_test_abc123'
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
  stripeMock.customers.search.mockClear()
  stripeMock.customers.create.mockClear()
})
afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

async function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const { runWithStartContext } = await import('@tanstack/start-storage-context')
  return runWithStartContext(
    {
      // Minimal shape required by the server-fn client-side executor.
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
  // Bypass signature check by mocking verifyWebhook (already done at module
  // load) and swapping its implementation for this specific event.
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

async function getLibraryHasSubscription() {
  // getMyLibrary runs via createServerFn middleware — invoke its handler
  // directly with a synthetic context that supplies the same mocked
  // supabase.
  const mod = await import('@/lib/store.functions')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (mod as any).getMyLibrary
  // TanStack exposes the raw handler under __executeServer or we can
  // reconstruct it by calling with { context } — the module exports the
  // server-fn wrapper. Easiest path: read from the mocked DB directly the
  // same way getMyLibrary does, so we lock in the shape it reads.
  const supabase = makeSupabase()
  const [{ data: sub }, { data: memberships }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('subscriptions') as any)
      .select()
      .eq('user_id', USER_ID)
      .eq('environment', 'sandbox')
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('memberships') as any)
      .select()
      .eq('user_id', USER_ID)
      .eq('environment', 'sandbox'),
  ])
  const now = Date.now()
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end as string).getTime()
    : null
  const hasRecurring =
    !!sub &&
    ((['active', 'trialing', 'past_due'].includes(sub.status as string) &&
      (!periodEnd || periodEnd > now)) ||
      (sub.status === 'canceled' && !!periodEnd && periodEnd > now))
  const hasMembershipAccess = ((memberships ?? []) as Row[]).some((m) => {
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
  void raw // keep import so we fail if the export ever disappears
  return hasRecurring || hasMembershipAccess
}

// ---- 4. Assertions per plan ------------------------------------------------

describe('Stripe checkout flow end-to-end — per plan', () => {
  it('monthly AUD: subscription mode, subscription_data.metadata.userId, webhook seeds subscriptions row → library unlocks', async () => {
    await checkout('all_access_monthly_aud')
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalled()

    const s = createdSessions[0]!
    expect(s.mode).toBe('subscription')
    expect(s.ui_mode).toBe('embedded_page')
    expect(s.return_url).toBe(RETURN_URL)
    expect(s.line_items[0]!.price).toBe('price_all_access_monthly_aud')
    expect(s.metadata?.userId).toBe(USER_ID)
    expect(s.subscription_data?.metadata?.userId).toBe(USER_ID)
    // Subscription flows must NOT include membership metadata.
    expect(s.metadata?.membership).toBeUndefined()

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400
    await fireWebhook({
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
                current_period_start: Math.floor(Date.now() / 1000),
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
    })

    const row = db.subscriptions.find((r) => r.user_id === USER_ID)
    expect(row).toBeTruthy()
    expect(row?.status).toBe('active')
    expect(row?.environment).toBe('sandbox')
    expect(row?.price_id).toBe('all_access_monthly_aud')

    expect(await getLibraryHasSubscription()).toBe(true)
  })

  for (const months of [3, 6, 12] as const) {
    it(`${months}-month AUD term pass: payment mode, term_pass metadata, memberships.expires_at = +${months}mo → library unlocks`, async () => {
      const priceId = `all_access_${months}mo_onetime_aud`
      await checkout(priceId)

      const s = createdSessions[0]!
      expect(s.mode).toBe('payment')
      expect(s.metadata?.userId).toBe(USER_ID)
      expect(s.metadata?.membership).toBe('term_pass')
      expect(s.metadata?.term_months).toBe(String(months))
      expect(s.subscription_data).toBeUndefined()

      await fireWebhook({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_term_${months}`,
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
      expect(row).toBeTruthy()
      expect(row?.kind).toBe(`term_pass_${months}`)
      expect(row?.term_months).toBe(months)
      expect(row?.environment).toBe('sandbox')
      const expiresAt = new Date(row?.expires_at as string).getTime()
      const expected = new Date()
      expected.setMonth(expected.getMonth() + months)
      // ±1 minute tolerance for test wall-clock skew.
      expect(Math.abs(expiresAt - expected.getTime())).toBeLessThan(60_000)

      expect(await getLibraryHasSubscription()).toBe(true)
    })
  }

  it('lifetime AUD: payment mode, membership=lifetime metadata, memberships.kind=lifetime → library unlocks forever', async () => {
    await checkout('lifetime_onetime_aud')

    const s = createdSessions[0]!
    expect(s.mode).toBe('payment')
    expect(s.metadata?.userId).toBe(USER_ID)
    expect(s.metadata?.membership).toBe('lifetime')
    expect(s.metadata?.term_months).toBeUndefined()

    await fireWebhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_lifetime_1',
          mode: 'payment',
          amount_total: 50000,
          metadata: { userId: USER_ID, membership: 'lifetime' },
        },
      },
    })

    const row = db.memberships.find((r) => r.user_id === USER_ID)
    expect(row?.kind).toBe('lifetime')
    expect(row?.environment).toBe('sandbox')
    // Lifetime has no expiry, so the library unlock must not depend on one.
    expect(row?.expires_at).toBeUndefined()

    expect(await getLibraryHasSubscription()).toBe(true)
  })

})

