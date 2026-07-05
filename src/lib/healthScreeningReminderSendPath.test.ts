import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── mocks ─────────────────────────────────────────────────────────────
// Mock every external dependency the reminder route touches so the send
// path runs deterministically in-process: no network, no DB.

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

// Minimal Supabase client stub — models exactly the calls the handler makes.
function makeSupabaseStub() {
  const from = vi.fn((table: string) => {
    if (table === 'health_screenings') {
      // Two shapes: select-list (candidates) and update (flag flip).
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () =>
        Promise.resolve({ data: [SCREENING], error: null })
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
  })
  return {
    from,
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: RECIPIENT_EMAIL, user_metadata: {} } },
          error: null,
        }),
      },
    },
  }
}

const supabaseStub = makeSupabaseStub()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => supabaseStub,
}))

// ─── env ───────────────────────────────────────────────────────────────

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

// ─── helpers ───────────────────────────────────────────────────────────

async function invokeHandler(headers: Record<string, string> = {}) {
  const mod = await import(
    '@/routes/api/public/hooks/health-screening-reminders'
  )
  const handler =
    (mod as { Route: { options: { server: { handlers: { POST: Function } } } } })
      .Route.options.server.handlers.POST
  const request = new Request('https://app.princesspink90.com/api/public/hooks/health-screening-reminders', {
    method: 'POST',
    headers: {
      apikey: 'pub-key',
      'content-type': 'application/json',
      ...headers,
    },
  })
  return handler({ request })
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    for (const a of args) {
      if (typeof a === 'string') lines.push(a)
    }
  }
  return { lines, restore: () => (console.log = original) }
}

function assertNoLocalhost(url: string) {
  const bad = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(?::|\/|$)|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i
  expect(bad.test(url)).toBe(false)
}

// ─── the test ──────────────────────────────────────────────────────────

describe('health-screening-reminders — send path integration', () => {
  it('portal link in email matches portal_url in logs and never points at localhost', async () => {
    const { lines, restore } = captureLogs()
    try {
      const response = await invokeHandler()
      expect(response.status ?? 200).toBe(200)
    } finally {
      restore()
    }

    // 1. The email was sent exactly once, to the expected recipient.
    expect(sendResendEmail).toHaveBeenCalledTimes(1)
    const emailArgs = (sendResendEmail.mock.calls as any[])[0][0] as {
      to: string
      html: string
      text: string
    }
    expect(emailArgs.to).toBe(RECIPIENT_EMAIL)

    // 2. Extract the portal link the email body actually rendered.
    const hrefMatch = emailArgs.html.match(/href="([^"]+)"/)
    expect(hrefMatch).not.toBeNull()
    const emailedPortalUrl = hrefMatch![1].replace(/&amp;/g, '&')

    // 3. Find the structured `reminder_email_send` log line.
    const sendLog = lines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find((o): o is Record<string, unknown> => o?.event === 'reminder_email_send')
    expect(sendLog, 'reminder_email_send log line').toBeDefined()

    // 4. The logged portal_url matches the URL embedded in the email.
    expect(sendLog!.portal_url).toBe(emailedPortalUrl)

    // 5. Neither the log nor the email leak localhost.
    assertNoLocalhost(emailedPortalUrl)
    assertNoLocalhost(String(sendLog!.portal_url))
    assertNoLocalhost(emailArgs.text)

    // 6. The URL carries the tracing IDs used to correlate the send.
    const parsed = new URL(emailedPortalUrl)
    expect(parsed.origin).toBe('https://app.princesspink90.com')
    expect(parsed.pathname).toBe('/health-screenings')
    expect(parsed.searchParams.get('rid')).toBe(REMINDER_LOG_ID)
    expect(parsed.searchParams.get('sid')).toBe(SCREENING.id)
    expect(parsed.searchParams.get('uid')).toBe(SCREENING.user_id)

    // 7. Log line's resolved_origin matches the URL host, and PII (recipient
    //    email) is masked, never present in raw form.
    expect(sendLog!.resolved_origin).toBe('https://app.princesspink90.com')
    expect(JSON.stringify(sendLog)).not.toContain(RECIPIENT_EMAIL)
  })

  it('a stray localhost forwarded-host cannot leak into the sent URL', async () => {
    const { lines, restore } = captureLogs()
    try {
      // Simulate a misconfigured proxy: PUBLIC_APP_URL is set (from beforeEach)
      // so this dev host must be discarded, not used.
      await invokeHandler({
        'x-forwarded-host': 'localhost:8080',
        'x-forwarded-proto': 'http',
      })
    } finally {
      restore()
    }

    const emailArgs = (sendResendEmail.mock.calls as any[])[0][0] as { html: string; text: string }
    const href = emailArgs.html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&')
    assertNoLocalhost(href)
    assertNoLocalhost(emailArgs.text)

    const sendLog = lines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find((o): o is Record<string, unknown> => o?.event === 'reminder_email_send')
    expect(sendLog!.portal_url).toBe(href)
    expect(new URL(href).origin).toBe('https://app.princesspink90.com')
  })
})
