import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── mocks ─────────────────────────────────────────────────────────────
const sendResendEmail = vi.fn(async () => ({ ok: true as const }))
vi.mock('@/lib/resend.server', () => ({ sendResendEmail }))

vi.mock('@/lib/reminder-job-config.functions', () => ({
  readReminderJobConfig: async () => ({
    daily_run_time_utc: '00:00',
    expiring_within_days: 7,
  }),
}))

const SCREENING = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  valid_until: '2099-12-31',
  status: 'approved' as const,
  test_date: '2099-06-01',
}
const REMINDER_LOG_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const RECIPIENT_EMAIL = 'integration.tester@example.com'

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
  sendResendEmail.mockClear()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('reminder email integration — end-to-end send + structured logs', () => {
  it('sends the reminder email and emits logs with all required fields', async () => {
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

    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => {
      for (const a of args) if (typeof a === 'string') lines.push(a)
    }
    try {
      const res = await handler({ request })
      expect(res).toBeDefined()
    } finally {
      console.log = orig
    }

    // The email path actually ran.
    expect(sendResendEmail).toHaveBeenCalledTimes(1)
    const emailArgs = (sendResendEmail.mock.calls[0] as unknown as [
      { to: string; html?: string; text?: string },
    ])[0]
    expect(emailArgs.to).toBe(RECIPIENT_EMAIL)

    const events = lines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter((o): o is Record<string, unknown> => !!o)

    const send = events.find((e) => e.event === 'reminder_email_send')
    expect(send, 'reminder_email_send log line').toBeDefined()

    // All required fields from the request.
    expect(String(send!.run_id).length).toBeGreaterThan(0)
    expect(send!.resolved_origin).toBe('https://app.princesspink90.com')

    const portalUrl = String(send!.portal_url)
    expect(portalUrl.startsWith('https://app.princesspink90.com/')).toBe(true)
    expect(portalUrl).not.toContain('localhost')

    expect(String(send!.reminder_id)).toMatch(UUID_RE)
    expect(String(send!.screening_id)).toMatch(UUID_RE)
    expect(String(send!.user_id)).toMatch(UUID_RE)
    expect(send!.reminder_id).toBe(REMINDER_LOG_ID)
    expect(send!.screening_id).toBe(SCREENING.id)
    expect(send!.user_id).toBe(SCREENING.user_id)

    // Recipient is masked; raw address never appears in this log line.
    expect(String(send!.recipient_masked)).toBe('i***@example.com')
    expect(JSON.stringify(send)).not.toContain(RECIPIENT_EMAIL)

    // And it never leaks into ANY emitted log line, either.
    for (const e of events) {
      expect(JSON.stringify(e)).not.toContain(RECIPIENT_EMAIL)
    }

    // The portal_url the user will click matches what was logged.
    const rendered = String(emailArgs.html ?? emailArgs.text ?? '')
    expect(rendered).toContain(portalUrl)
  })
})
