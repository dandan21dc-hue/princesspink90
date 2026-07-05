/**
 * End-to-end smoke test.
 *
 * Runs against a REAL database. Auto-skips when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are not present, so it stays green in CI /
 * local runs without secrets.
 *
 * Run against a live environment (opt-in):
 *   RUN_SMOKE_TESTS=1 \
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_PUBLISHABLE_KEY=... \
 *     bunx vitest run src/lib/smokeE2eRsvp.test.ts
 *
 * Verifies, end-to-end:
 *   1. Public signUp (as any browser would) triggers the signup
 *      confirmation email, which lands in email_send_log with
 *      template_name='signup'.
 *   2. Inserting an RSVP row fires the rsvps_assign_entry_phrase trigger
 *      and populates entry_phrase with a non-empty value.
 *
 * The confirmation email checked here is the SIGNUP confirmation email
 * enqueued by the Lovable auth webhook — the RSVP flow itself does not
 * currently enqueue a separate confirmation email.
 *
 * Cleanup runs best-effort in afterAll; deleting the auth user cascades
 * to rsvps / health_screenings / age_verifications / events (host_id).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUB_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY
// Opt-in: smoke tests hit a real database and enqueue real emails, so they
// stay off by default. Set RUN_SMOKE_TESTS=1 in addition to the creds below.
const HAS_CREDS =
  Boolean(URL && SERVICE_KEY && PUB_KEY) && process.env.RUN_SMOKE_TESTS === '1'

// Signup email is enqueued via the auth webhook and processed by the pg_cron
// job on a ~5s tick, so this must comfortably exceed a couple of ticks.
const TEST_TIMEOUT_MS = 90_000
const EMAIL_POLL_TIMEOUT_MS = 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let anon: SupabaseClient<any>
let userId = ''
let email = ''
let eventId = ''
let rsvpId = ''

async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  {
    timeoutMs = 30_000,
    intervalMs = 1_000,
    onTick,
  }: {
    timeoutMs?: number
    intervalMs?: number
    onTick?: (attempt: number, elapsedMs: number) => void
  } = {},
): Promise<T | null> {
  const start = Date.now()
  const deadline = start + timeoutMs
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    const v = await fn()
    if (v) return v
    onTick?.(attempt, Date.now() - start)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}

function fmt(v: unknown) {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}


describe.skipIf(!HAS_CREDS)(
  'smoke: signup → RSVP → entry_phrase + email log',
  () => {
    beforeAll(() => {
      admin = createClient(URL!, SERVICE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      anon = createClient(URL!, PUB_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      email = `lovable-smoke+${Date.now()}@lovable-smoke.test`
    })

    afterAll(async () => {
      if (!HAS_CREDS) return
      // Best-effort cleanup; ignore errors.
      try {
        if (rsvpId) await admin.from('rsvps').delete().eq('id', rsvpId)
      } catch { /* noop */ }
      try {
        if (eventId) await admin.from('events').delete().eq('id', eventId)
      } catch { /* noop */ }
      try {
        if (userId) {
          await admin.from('health_screenings').delete().eq('user_id', userId)
          await admin.from('age_verifications').delete().eq('user_id', userId)
        }
      } catch { /* noop */ }
      try {
        if (email) {
          await admin.from('email_send_log').delete().eq('recipient_email', email)
        }
      } catch { /* noop */ }
      try {
        if (userId) await admin.auth.admin.deleteUser(userId)
      } catch { /* noop */ }
    })

    it(
      'signUp triggers a confirmation email logged in email_send_log',
      async () => {
        // Public signUp mirrors what a real browser does and fires the auth
        // webhook that enqueues the signup confirmation email.
        const { data, error } = await anon.auth.signUp({
          email,
          password: `Smoke!${Date.now()}Aa1`,
          options: { data: { display_name: 'Smoke Tester' } },
        })
        expect(error, error?.message).toBeNull()
        expect(data.user?.id).toBeTruthy()
        userId = data.user!.id
        console.log(`[smoke] signUp ok user=${userId} email=${email}`)

        // Poll until a template_name=signup row lands for this recipient.
        // Keep the most recent snapshot around so we can surface it in the
        // failure message if the poll times out.
        let lastRows: Array<{
          id: string
          template_name: string | null
          status: string | null
          recipient_email: string | null
          error_message?: string | null
          created_at: string
        }> = []
        const signup = await poll(
          async () => {
            const { data, error: qErr } = await admin
              .from('email_send_log')
              .select('id, template_name, status, recipient_email, error_message, created_at')
              .eq('recipient_email', email)
              .order('created_at', { ascending: false })
              .limit(20)
            if (qErr) {
              console.warn(`[smoke] email_send_log query error: ${qErr.message}`)
              return null
            }
            lastRows = data ?? []
            return lastRows.find((r) => r.template_name === 'signup') ?? null
          },
          {
            timeoutMs: EMAIL_POLL_TIMEOUT_MS,
            onTick: (attempt, elapsedMs) => {
              if (attempt % 5 === 0) {
                console.log(
                  `[smoke] waiting for signup email (${Math.round(elapsedMs / 1000)}s) — rows so far for ${email}: ${
                    lastRows.length
                  } [${lastRows.map((r) => `${r.template_name}:${r.status}`).join(', ') || 'none'}]`,
                )
              }
            },
          },
        )

        if (!signup) {
          // Broader context to help diagnose: recent log rows across all
          // recipients + a hint at queue health.
          const { data: recent } = await admin
            .from('email_send_log')
            .select('template_name, status, recipient_email, error_message, created_at')
            .order('created_at', { ascending: false })
            .limit(10)
          console.error(
            `[smoke] no signup email for ${email} in ${EMAIL_POLL_TIMEOUT_MS}ms.\n` +
              `  rows for this recipient: ${fmt(lastRows)}\n` +
              `  10 most recent email_send_log rows (any recipient): ${fmt(recent)}`,
          )
        }

        expect(
          signup,
          `no template_name='signup' row for ${email} within ${EMAIL_POLL_TIMEOUT_MS}ms — ` +
            `check the auth webhook (/lovable/email/auth/webhook) and the process-email-queue cron. ` +
            `see console output above for the most recent log rows.`,
        ).toBeTruthy()

      },
      TEST_TIMEOUT_MS,
    )

    it(
      'inserts an RSVP and the entry_phrase trigger populates a value',
      async () => {
        expect(userId, 'user must exist from previous step').toBeTruthy()

        // Seed preconditions the app enforces at the handler layer.
        const { error: avErr } = await admin.from('age_verifications').insert({
          user_id: userId,
          date_of_birth: '1990-01-01',
          id_file_path: `smoke/${userId}-id.jpg`,
          status: 'approved',
        })
        expect(avErr, avErr?.message).toBeFalsy()

        const validUntil = new Date(Date.now() + 60 * 86_400_000)
          .toISOString()
          .slice(0, 10)
        const testDate = new Date().toISOString().slice(0, 10)
        const { error: hsErr } = await admin.from('health_screenings').insert({
          user_id: userId,
          file_path: `smoke/${userId}.pdf`,
          test_date: testDate,
          valid_until: validUntil,
          status: 'approved',
        })
        expect(hsErr, hsErr?.message).toBeFalsy()

        // Create an event to RSVP against (user hosts their own smoke event).
        const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
        const { data: ev, error: evErr } = await admin
          .from('events')
          .insert({
            host_id: userId,
            title: `Smoke event ${Date.now()}`,
            venue_name: 'Smoke Venue',
            starts_at: startsAt,
            published: false,
          })
          .select('id')
          .single()
        expect(evErr, evErr?.message).toBeFalsy()
        eventId = ev!.id

        // Insert an RSVP — the BEFORE INSERT trigger
        // rsvps_assign_entry_phrase_trg must populate entry_phrase.
        const { data: rsvp, error: rsvpErr } = await admin
          .from('rsvps')
          .insert({
            event_id: eventId,
            user_id: userId,
            guest_count: 1,
            status: 'confirmed',
          })
          .select('id, entry_code, entry_phrase, ticket_code')
          .single()
        expect(rsvpErr, rsvpErr?.message).toBeFalsy()
        rsvpId = rsvp!.id

        expect(rsvp!.entry_code).toMatch(/^PINK-\d+$/)
        expect(rsvp!.ticket_code, 'ticket_code should be generated').toBeTruthy()
        expect(
          rsvp!.entry_phrase,
          'entry_phrase must be populated by the trigger',
        ).toBeTruthy()
        expect(String(rsvp!.entry_phrase).length).toBeGreaterThan(0)
        expect(rsvp!.entry_phrase).not.toBe('')
      },
      TEST_TIMEOUT_MS,
    )
  },
)
