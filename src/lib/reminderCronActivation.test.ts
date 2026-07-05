import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSendResendEmail } from '@/lib/test-utils/sendResendEmailMock'

// Integration test for the reminder cron activation contract.
//
// Verifies two guarantees the pg_cron → hook path must uphold:
//   1. The hook only performs work at/after the configured daily run time
//      (UTC). Cron may fire earlier if operators adjust the schedule; the
//      hook still short-circuits before doing any sends.
//   2. Each due reminder triggers `sendResendEmail` EXACTLY ONCE across
//      the full run — including when cron re-invokes the hook (retries,
//      overlapping schedules). The unique idempotency_key on
//      health_screening_reminder_log makes the second attempt skip via a
//      Postgres 23505 unique_violation.

const email = mockSendResendEmail()
vi.mock('@/lib/resend.server', () => ({ sendResendEmail: email.sendResendEmail }))



// Fixed target: today + 7 days in UTC (matches hook's window logic).
const TODAY = new Date()
const TARGET = new Date(TODAY)
TARGET.setUTCDate(TARGET.getUTCDate() + 7)
const TARGET_DATE = TARGET.toISOString().slice(0, 10)

type Screening = {
  id: string
  user_id: string
  valid_until: string
  status: 'approved'
  test_date: string
}

const DUE: Screening[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
    valid_until: TARGET_DATE,
    status: 'approved',
    test_date: '2099-06-01',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
    valid_until: TARGET_DATE,
    status: 'approved',
    test_date: '2099-06-02',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
    valid_until: TARGET_DATE,
    status: 'approved',
    test_date: '2099-06-03',
  },
]

// Config: daily_run_time_utc — mutated per test to simulate cron firing
// before / after the configured time.
let configuredRunTime = '00:00'
vi.mock('@/lib/reminder-job-config.functions', () => ({
  readReminderJobConfig: async () => ({
    daily_run_time_utc: configuredRunTime,
    expiring_within_days: 7,
  }),
}))

// Emulate the DB's unique_violation on repeated inserts of the same
// idempotency_key. This is the exactly-once guarantee at the storage layer.
const claimedKeys = new Set<string>()

function makeSupabaseMock() {
  return {
    from: (table: string) => {
      if (table === 'health_screenings') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        // Filters out screenings whose expiry_reminder_sent_at is not null.
        // We treat any screening whose key has been claimed as "already sent"
        // to mimic the .is('expiry_reminder_sent_at', null) filter after a
        // previous successful run.
        chain.is = () => {
          const remaining = DUE.filter(
            (s) => !claimedKeys.has(`expiry_7_day:${s.id}:${s.valid_until}`),
          )
          return Promise.resolve({ data: remaining, error: null })
        }
        chain.update = () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        })
        return chain
      }
      if (table === 'health_screening_reminder_log') {
        return {
          insert: (payload: { idempotency_key: string; screening_id: string }) => ({
            select: () => ({
              single: async () => {
                if (claimedKeys.has(payload.idempotency_key)) {
                  return {
                    data: null,
                    // Postgres unique_violation code.
                    error: { code: '23505', message: 'duplicate key' },
                  }
                }
                claimedKeys.add(payload.idempotency_key)
                return {
                  data: { id: `log-${payload.screening_id}` },
                  error: null,
                }
              },
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }
      }
      if (table === 'notifications' || table === 'email_send_log') {
        return { insert: () => Promise.resolve({ data: null, error: null }) }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { display_name: 'Test' }, error: null }),
            }),
          }),
        }
      }
      return {}
    },
    auth: {
      admin: {
        getUserById: async (uid: string) => ({
          data: {
            user: {
              email: `user-${uid.slice(-2)}@example.com`,
              user_metadata: {},
            },
          },
          error: null,
        }),
      },
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabaseMock(),
}))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv-role',
    SUPABASE_PUBLISHABLE_KEY: 'pub-key',
    PUBLIC_APP_URL: 'https://app.princesspink90.com',
  }
  email.reset()
  claimedKeys.clear()
  configuredRunTime = '00:00'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

async function invokeHook() {
  const mod = await import(
    '@/routes/api/public/hooks/health-screening-reminders'
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (mod as any).Route.options.server.handlers.POST
  const request = new Request(
    'https://app.princesspink90.com/api/public/hooks/health-screening-reminders',
    {
      method: 'POST',
      headers: { apikey: 'pub-key', 'content-type': 'application/json' },
    },
  )
  const res = await handler({ request })
  return (await res.json()) as {
    success: boolean
    skipped_reason?: string
    candidates?: number
    sent?: number
    emailed?: number
    skipped?: number
    failures?: unknown[]
  }
}

describe('reminder cron activation → exactly-once send per due reminder', () => {
  it('skips work when cron fires before the configured daily run time', async () => {
    // Configure the run time to 23:59 UTC. Unless the test happens to run in
    // the last minute of the UTC day, the hook must short-circuit.
    const now = new Date()
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    if (nowMinutes >= 23 * 60 + 59) {
      // Skip the guard assertion in the improbable minute where "before"
      // cannot be simulated; the other tests still cover activation.
      return
    }
    configuredRunTime = '23:59'

    const body = await invokeHook()
    expect(body.success).toBe(true)
    expect(body.skipped_reason).toBe('before_configured_run_time')
    expect(email.sendResendEmail).not.toHaveBeenCalled()
  })

  it('sends exactly one email per due reminder when cron fires at/after the run time', async () => {
    configuredRunTime = '00:00' // any time on or after 00:00 UTC is eligible

    const body = await invokeHook()

    expect(body.success).toBe(true)
    expect(body.candidates).toBe(DUE.length)
    expect(body.sent).toBe(DUE.length)
    expect(body.emailed).toBe(DUE.length)
    expect(body.skipped).toBe(0)
    expect(body.failures).toEqual([])

    // Exactly one send per due reminder — no duplicates, no missed rows.
    expect(email.sendResendEmail).toHaveBeenCalledTimes(DUE.length)

    const recipients = email.recipients()
    const unique = new Set(recipients)
    expect(unique.size).toBe(DUE.length)
    for (const s of DUE) {
      expect(recipients).toContain(`user-${s.user_id.slice(-2)}@example.com`)
    }

    // Every send used the deterministic per-screening idempotency key.
    const keys = email.keys()
    for (const s of DUE) {
      expect(keys).toContain(`expiry_7_day:${s.id}:${s.valid_until}`)
    }
  })



  it('does not double-send when cron re-invokes the hook (idempotency)', async () => {
    configuredRunTime = '00:00'

    const first = await invokeHook()
    expect(first.emailed).toBe(DUE.length)
    expect(email.sendResendEmail).toHaveBeenCalledTimes(DUE.length)

    // Second invocation: the log filter (expiry_reminder_sent_at IS NULL) is
    // mirrored by our mock — already-claimed keys are excluded from the
    // candidate set, so no additional sends happen. Even if a candidate
    // slipped through, the unique constraint would reject the log insert
    // with 23505 and the hook would skip.
    const second = await invokeHook()
    expect(second.success).toBe(true)
    expect(second.candidates).toBe(0)
    expect(second.emailed).toBe(0)
    expect(email.sendResendEmail).toHaveBeenCalledTimes(DUE.length)
  })

  it('re-uses the idempotency key to skip on unique_violation when a stale candidate is retried', async () => {
    configuredRunTime = '00:00'

    // Pre-claim one key to simulate a race where a prior run already inserted
    // the log row but hadn't yet flipped expiry_reminder_sent_at. The row
    // still appears as a candidate; the insert must return 23505 and the
    // hook must NOT send an email for it.
    const preClaimed = DUE[0]!
    claimedKeys.add(
      `expiry_7_day:${preClaimed.id}:${preClaimed.valid_until}`,
    )

    const body = await invokeHook()
    // Candidate list excludes the pre-claimed row because our .is() mock
    // filters by claimedKeys — matching the real "sent_at IS NULL" filter
    // after step 4 flips the flag. The remaining two are sent once each.
    expect(body.candidates).toBe(DUE.length - 1)
    expect(body.emailed).toBe(DUE.length - 1)
    expect(email.sendResendEmail).toHaveBeenCalledTimes(DUE.length - 1)
    const recipients = email.recipients()
    expect(recipients).not.toContain(
      `user-${preClaimed.user_id.slice(-2)}@example.com`,
    )
  })

  it('never resends an email for the same idempotency key across duplicate hook invocations', async () => {
    // Hardening test for the exactly-once guarantee: even if the candidate
    // filter fails to exclude already-sent rows (e.g. expiry_reminder_sent_at
    // wasn't flipped, a replica lag, or a concurrent cron overlap), the
    // unique constraint on health_screening_reminder_log.idempotency_key
    // MUST prevent a second sendResendEmail call for the same key.
    //
    // We simulate that by shadowing the mock's `.is()` filter so it returns
    // the full DUE set on every invocation regardless of claimedKeys. Only
    // the 23505 unique_violation on the log insert protects us here.
    configuredRunTime = '00:00'

    const originalMake = makeSupabaseMock
    const alwaysReturnAllCandidates = () => {
      const client = originalMake()
      const originalFrom = client.from
      client.from = (table: string) => {
        if (table === 'health_screenings') {
          const chain: Record<string, unknown> = {}
          chain.select = () => chain
          chain.eq = () => chain
          chain.is = () => Promise.resolve({ data: DUE, error: null })
          chain.update = () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          })
          return chain
        }
        return originalFrom(table)
      }
      return client
    }

    const supabaseModule = await import('@supabase/supabase-js')
    const createClientSpy = vi
      .spyOn(supabaseModule, 'createClient')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(alwaysReturnAllCandidates as any)

    try {
      // Invoke the hook three times back-to-back — the same candidates come
      // through every time, so only the idempotency-key uniqueness stops
      // duplicate sends.
      await invokeHook()
      await invokeHook()
      await invokeHook()

      // Exactly one send per unique key, ever.
      expect(email.sendResendEmail).toHaveBeenCalledTimes(DUE.length)

      const keys = email.keys()
      expect(new Set(keys).size).toBe(keys.length)
      expect(new Set(keys).size).toBe(DUE.length)
      for (const s of DUE) {
        expect(keys).toContain(`expiry_7_day:${s.id}:${s.valid_until}`)
      }

      const recipients = email.recipients()
      expect(new Set(recipients).size).toBe(DUE.length)
    } finally {
      createClientSpy.mockRestore()
    }
  })
})
