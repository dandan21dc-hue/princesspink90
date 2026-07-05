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
  id: '22222222-2222-2222-2222-222222222222',
  user_id: '33333333-3333-3333-3333-333333333333',
  valid_until: '2099-12-31',
  status: 'approved' as const,
  test_date: '2099-06-01',
}
const REMINDER_LOG_ID = '11111111-1111-1111-1111-111111111111'
const RECIPIENT_EMAIL = 'jane.doe@example.com'

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

// ─── env / capture helpers ─────────────────────────────────────────────

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

async function runHandler(headers: Record<string, string> = {}) {
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
        ...headers,
      },
    },
  )
  const lines: string[] = []
  const orig = console.log
  console.log = (...args: unknown[]) => {
    for (const a of args) if (typeof a === 'string') lines.push(a)
  }
  try {
    await handler({ request })
  } finally {
    console.log = orig
  }
  return lines
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((o): o is Record<string, unknown> => !!o)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ─── tests ─────────────────────────────────────────────────────────────

describe('reminder hook — structured JSON logs', () => {
  it('emits reminder_cron_start with all expected fields', async () => {
    const events = await runHandler({
      'x-forwarded-host': 'app.princesspink90.com',
      'x-forwarded-proto': 'https',
    })
    const start = events.find((e) => e.event === 'reminder_cron_start')
    expect(start, 'reminder_cron_start line').toBeDefined()

    // Envelope
    expect(start!.hook).toBe('health-screening-reminders')
    expect(typeof start!.run_id).toBe('string')
    expect(String(start!.run_id).length).toBeGreaterThan(0)
    expect(String(start!.ts)).toMatch(ISO_RE)

    // Resolver context
    expect(start!.resolved_origin).toBe('https://app.princesspink90.com')
    expect(start!.public_app_url_set).toBe(true)
    expect(start!.site_url_set).toBe(false)
    expect(start!.forwarded_host).toBe('app.princesspink90.com')
    expect(start!.forwarded_proto).toBe('https')

    // Job context
    expect(String(start!.target_date)).toMatch(DATE_RE)
    expect(start!.window_days).toBe(7)
    expect(start!.candidates).toBe(1)
  })

  it('emits reminder_email_send with all expected fields', async () => {
    const events = await runHandler()
    const send = events.find((e) => e.event === 'reminder_email_send')
    expect(send, 'reminder_email_send line').toBeDefined()

    // Envelope
    expect(send!.hook).toBe('health-screening-reminders')
    expect(String(send!.ts)).toMatch(ISO_RE)

    // Tracing IDs (UUIDs, must survive redaction untouched)
    expect(String(send!.reminder_id)).toMatch(UUID_RE)
    expect(String(send!.screening_id)).toMatch(UUID_RE)
    expect(String(send!.user_id)).toMatch(UUID_RE)
    expect(send!.reminder_id).toBe(REMINDER_LOG_ID)
    expect(send!.screening_id).toBe(SCREENING.id)
    expect(send!.user_id).toBe(SCREENING.user_id)

    // Origin + portal URL
    expect(send!.resolved_origin).toBe('https://app.princesspink90.com')
    const portalUrl = String(send!.portal_url)
    const parsed = new URL(portalUrl)
    expect(parsed.origin).toBe('https://app.princesspink90.com')
    expect(parsed.pathname).toBe('/health-screenings')
    expect(parsed.searchParams.get('rid')).toBe(REMINDER_LOG_ID)
    expect(parsed.searchParams.get('sid')).toBe(SCREENING.id)
    expect(parsed.searchParams.get('uid')).toBe(SCREENING.user_id)
    expect(parsed.searchParams.get('utm_source')).toBe('email')
    expect(parsed.searchParams.get('utm_medium')).toBe('reminder')
    expect(parsed.searchParams.get('utm_campaign')).toBe(
      'health_screening_expiry_7_day',
    )

    // Metadata
    expect(send!.template).toBe('health_screening_expiry_7_day')
    expect(send!.status).toBe('sent')
    expect(send!.error).toBeNull()
    // idempotency_key's key name contains "key", so the redactor treats
    // its long UUID segment as a credential-shaped token and masks it.
    // What we care about is the prefix + date suffix landing intact.
    expect(String(send!.idempotency_key)).toBe(
      `expiry_7_day:***:${SCREENING.valid_until}`,
    )


    // Recipient masking: masked form present, raw email absent everywhere.
    expect(String(send!.recipient_masked)).toBe('j***@example.com')
    expect(JSON.stringify(send)).not.toContain(RECIPIENT_EMAIL)
  })

  it('shares one run_id across cron_start and email_send events', async () => {
    const events = await runHandler()
    const start = events.find((e) => e.event === 'reminder_cron_start')!
    const send = events.find((e) => e.event === 'reminder_email_send')!
    expect(start.run_id).toBeDefined()
    expect(start.run_id).toBe(send.run_id)
  })

  it('every emitted log line parses as JSON and carries the standard envelope', async () => {
    const events = await runHandler()
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(typeof e.event).toBe('string')
      expect(e.hook).toBe('health-screening-reminders')
      expect(typeof e.run_id).toBe('string')
      expect(String(e.ts)).toMatch(ISO_RE)
    }
  })
})
