import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Recipient email whose raw form must NEVER appear in any logged output,
// regardless of code path (success, resend failure, thrown exception).
const RECIPIENT_EMAIL = 'jane.doe@example.com'
const SCREENING = {
  id: '22222222-2222-2222-2222-222222222222',
  user_id: '33333333-3333-3333-3333-333333333333',
  valid_until: '2099-12-31',
  status: 'approved' as const,
  test_date: '2099-06-01',
}
const REMINDER_LOG_ID = '11111111-1111-1111-1111-111111111111'

// sendResendEmail is reassigned per-scenario. Tests that need to inject
// specific behavior overwrite this reference before invoking the handler.
const sendResendEmail = vi.fn(async () => ({ ok: true as const }))
vi.mock('@/lib/resend.server', () => ({ sendResendEmail }))

vi.mock('@/lib/reminder-job-config.functions', () => ({
  readReminderJobConfig: async () => ({
    daily_run_time_utc: '00:00',
    expiring_within_days: 7,
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'health_screenings') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.is = () => Promise.resolve({ data: [SCREENING], error: null })
        chain.update = () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        })
        return chain
      }
      if (table === 'health_screening_reminder_log') {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: REMINDER_LOG_ID }, error: null }),
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
                Promise.resolve({ data: { display_name: 'Jane' }, error: null }),
            }),
          }),
        }
      }
      return {}
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: RECIPIENT_EMAIL, user_metadata: {} } },
          error: null,
        }),
      },
    },
  }),
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
  sendResendEmail.mockReset()
  sendResendEmail.mockResolvedValue({ ok: true as const })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

// Captures EVERY stream a log might land in: console.log AND console.error.
// Serializes non-string args (objects, Errors) so a raw email nested inside
// a structured object still gets scanned.
async function captureAllLogsWhile(fn: () => Promise<unknown>): Promise<string[]> {
  const captured: string[] = []
  const streams: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = [
    'log',
    'info',
    'warn',
    'error',
    'debug',
  ]
  const originals: Record<string, (...a: unknown[]) => void> = {}
  const stringify = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  for (const name of streams) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (console as any)[name] as (...a: unknown[]) => void
    originals[name] = orig
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(console as any)[name] = (...args: unknown[]) => {
      captured.push(args.map(stringify).join(' '))
    }
  }
  try {
    await fn()
  } finally {
    for (const name of streams) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(console as any)[name] = originals[name]
    }
  }
  return captured
}

async function runHealthScreeningHook(): Promise<string[]> {
  const mod = await import(
    '@/routes/api/public/hooks/health-screening-reminders'
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (mod as any).Route.options.server.handlers.POST
  const request = new Request(
    'https://app.princesspink90.com/api/public/hooks/health-screening-reminders',
    {
      method: 'POST',
      headers: {
        apikey: 'pub-key',
        'content-type': 'application/json',
      },
    },
  )
  return captureAllLogsWhile(async () => {
    await handler({ request })
  })
}

function assertNoRawRecipient(lines: string[], scenario: string) {
  const combined = lines.join('\n')
  // A single hit anywhere = PII leak. Report the offending line for triage.
  const offenders = lines.filter((l) => l.includes(RECIPIENT_EMAIL))
  if (offenders.length > 0) {
    throw new Error(
      `[${scenario}] raw recipient email leaked into ${offenders.length} log line(s):\n` +
        offenders.map((o, i) => `  #${i + 1}: ${o.slice(0, 400)}`).join('\n'),
    )
  }
  // Also guard against the local-part alone appearing beside the domain
  // (e.g. word-broken by a stray character) — this catches accidental
  // string interpolation that split the address.
  expect(combined, `[${scenario}] raw local-part must not appear near domain`).not.toMatch(
    /jane\.doe[\s\S]{0,20}example\.com/,
  )
}

describe('reminder hook — recipient email PII containment across all paths', () => {
  it('does not leak the raw recipient email on the happy send path', async () => {
    sendResendEmail.mockResolvedValueOnce({ ok: true as const })
    const lines = await runHealthScreeningHook()
    expect(lines.length).toBeGreaterThan(0)
    assertNoRawRecipient(lines, 'happy-path')
  })

  it('does not leak the raw recipient email when Resend returns an error containing it', async () => {
    // Simulate a provider error message that echoes back the recipient
    // address — the exact shape most likely to leak PII into logs.
    sendResendEmail.mockResolvedValueOnce({
      ok: false as const,
      error: `Resend 422: invalid recipient <${RECIPIENT_EMAIL}> was rejected by upstream MTA`,
    })
    const lines = await runHealthScreeningHook()
    assertNoRawRecipient(lines, 'resend-error-with-email-in-message')
  })

  it('does not leak the raw recipient email when the send path throws an exception whose message contains it', async () => {
    // A thrown error whose .message embeds the address is caught by the
    // handler's try/catch and logged via logEvent — the redactor must scrub it.
    sendResendEmail.mockImplementationOnce(async () => {
      throw new Error(
        `network failure while delivering to ${RECIPIENT_EMAIL} (ECONNRESET)`,
      )
    })
    const lines = await runHealthScreeningHook()
    assertNoRawRecipient(lines, 'thrown-exception-with-email-in-message')
  })

  it('does not leak the raw recipient email across multiple consecutive runs', async () => {
    // Retry-shaped scenario: three attempts, mixed outcomes. Any of these
    // may hit the same code path with different provider responses; none
    // may leak the raw address.
    sendResendEmail
      .mockResolvedValueOnce({ ok: true as const })
      .mockResolvedValueOnce({
        ok: false as const,
        error: `retry attempt failed for ${RECIPIENT_EMAIL}: 5xx`,
      })
      .mockImplementationOnce(async () => {
        throw new Error(`SMTP handshake aborted for <${RECIPIENT_EMAIL}>`)
      })
    const all: string[] = []
    for (let i = 0; i < 3; i++) {
      const lines = await runHealthScreeningHook()
      all.push(...lines)
    }
    assertNoRawRecipient(all, 'three-consecutive-retry-attempts')
  })

  it('the guard itself detects leaked emails when they are present (self-test)', () => {
    // Negative control: proves this test's guard actually fails when a
    // raw email is present. If this stops throwing, the guard is broken
    // and the other assertions above are worthless.
    expect(() =>
      assertNoRawRecipient(
        [`some log line mentioning ${RECIPIENT_EMAIL} directly`],
        'self-test',
      ),
    ).toThrow(/raw recipient email leaked/)
  })
})
