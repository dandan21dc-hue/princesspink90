import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// ─── mocks (mirror reminderHookLogging.test.ts) ────────────────────────
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

// ─── strict schemas ────────────────────────────────────────────────────
// Strict = unknown keys rejected, required fields non-null, types enforced.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const iso = z.string().regex(ISO_RE, 'must be ISO-8601 UTC timestamp')
const date = z.string().regex(DATE_RE, 'must be YYYY-MM-DD')
const uuid = z.string().regex(UUID_RE, 'must be a UUID')
const nonEmpty = z.string().min(1)

// Every reminder log line must carry this envelope.
const EnvelopeSchema = z.object({
  event: nonEmpty,
  hook: z.literal('health-screening-reminders'),
  run_id: nonEmpty,
  ts: iso,
})

const CronStartSchema = EnvelopeSchema.extend({
  event: z.literal('reminder_cron_start'),
  resolved_origin: z.string().url(),
  public_app_url_set: z.boolean(),
  site_url_set: z.boolean(),
  forwarded_host: z.string().nullable(),
  forwarded_proto: z.string().nullable(),
  target_date: date,
  window_days: z.number().int().positive(),
  candidates: z.number().int().nonnegative(),
}).strict()

const EmailSendSchema = EnvelopeSchema.extend({
  event: z.literal('reminder_email_send'),
  reminder_id: uuid,
  screening_id: uuid,
  user_id: uuid,
  resolved_origin: z.string().url(),
  portal_url: z.string().url(),
  template: nonEmpty,
  status: z.enum(['sent', 'failed', 'skipped']),
  error: z.string().nullable(),
  idempotency_key: nonEmpty,
  recipient_masked: nonEmpty,
}).strict()

function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ')
}

// ─── tests ─────────────────────────────────────────────────────────────

describe('reminder hook — structured JSON log schema contract', () => {
  it('every emitted line conforms to the base envelope schema', async () => {
    const events = await runHandler()
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      const result = EnvelopeSchema.safeParse(e)
      if (!result.success) {
        throw new Error(
          `envelope violation on ${JSON.stringify(e)}: ${formatIssues(result.error)}`,
        )
      }
    }
  })

  it('reminder_cron_start matches the strict schema before any value assertions', async () => {
    const events = await runHandler({
      'x-forwarded-host': 'app.princesspink90.com',
      'x-forwarded-proto': 'https',
    })
    const start = events.find((e) => e.event === 'reminder_cron_start')
    expect(start, 'reminder_cron_start line').toBeDefined()

    const result = CronStartSchema.safeParse(start)
    if (!result.success) {
      throw new Error(
        `reminder_cron_start schema violation: ${formatIssues(result.error)}`,
      )
    }
    // Value assertions run only after the schema contract holds.
    const parsed = result.data
    expect(parsed.resolved_origin).toBe('https://app.princesspink90.com')
    expect(parsed.public_app_url_set).toBe(true)
    expect(parsed.window_days).toBe(7)
    expect(parsed.candidates).toBe(1)
  })

  it('reminder_email_send matches the strict schema before any value assertions', async () => {
    const events = await runHandler()
    const send = events.find((e) => e.event === 'reminder_email_send')
    expect(send, 'reminder_email_send line').toBeDefined()

    const result = EmailSendSchema.safeParse(send)
    if (!result.success) {
      throw new Error(
        `reminder_email_send schema violation: ${formatIssues(result.error)}`,
      )
    }
    const parsed = result.data
    expect(parsed.reminder_id).toBe(REMINDER_LOG_ID)
    expect(parsed.screening_id).toBe(SCREENING.id)
    expect(parsed.user_id).toBe(SCREENING.user_id)
    expect(parsed.status).toBe('sent')
    expect(parsed.error).toBeNull()
    // Raw recipient must never leak into the structured log.
    expect(JSON.stringify(parsed)).not.toContain(RECIPIENT_EMAIL)
  })

  it('rejects reminder_email_send payloads with missing required fields', () => {
    const bad = {
      event: 'reminder_email_send',
      hook: 'health-screening-reminders',
      run_id: 'run-1',
      ts: '2099-01-01T00:00:00Z',
      // missing reminder_id, screening_id, user_id, resolved_origin, portal_url,
      // template, status, error, idempotency_key, recipient_masked
    }
    const result = EmailSendSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects reminder_email_send payloads with a null user_id', () => {
    const bad = {
      event: 'reminder_email_send',
      hook: 'health-screening-reminders',
      run_id: 'run-1',
      ts: '2099-01-01T00:00:00Z',
      reminder_id: REMINDER_LOG_ID,
      screening_id: SCREENING.id,
      user_id: null,
      resolved_origin: 'https://app.princesspink90.com',
      portal_url: 'https://app.princesspink90.com/health-screenings',
      template: 'health_screening_expiry_7_day',
      status: 'sent',
      error: null,
      idempotency_key: 'expiry_7_day:***:2099-12-31',
      recipient_masked: 'j***@example.com',
    }
    const result = EmailSendSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects reminder_email_send payloads with an unexpected extra field', () => {
    const bad = {
      event: 'reminder_email_send',
      hook: 'health-screening-reminders',
      run_id: 'run-1',
      ts: '2099-01-01T00:00:00Z',
      reminder_id: REMINDER_LOG_ID,
      screening_id: SCREENING.id,
      user_id: SCREENING.user_id,
      resolved_origin: 'https://app.princesspink90.com',
      portal_url: 'https://app.princesspink90.com/health-screenings',
      template: 'health_screening_expiry_7_day',
      status: 'sent',
      error: null,
      idempotency_key: 'expiry_7_day:***:2099-12-31',
      recipient_masked: 'j***@example.com',
      recipient_email: RECIPIENT_EMAIL, // raw PII must be rejected by strict()
    }
    const result = EmailSendSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })
})
