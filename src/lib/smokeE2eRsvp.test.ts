/**
 * End-to-end smoke test.
 *
 * Runs against a REAL database. Auto-skips when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are not present, so it stays green in CI /
 * local runs without secrets.
 *
 * Run against a live environment:
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
const HAS_CREDS = Boolean(URL && SERVICE_KEY && PUB_KEY)

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
  { timeoutMs = 30_000, intervalMs = 1_000 } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
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

        const rows = await poll(
          async () => {
            const { data } = await admin
              .from('email_send_log')
              .select('id, template_name, status, recipient_email, created_at')
              .eq('recipient_email', email)
              .order('created_at', { ascending: false })
              .limit(10)
            return data && data.length > 0 ? data : null
          },
          { timeoutMs: EMAIL_POLL_TIMEOUT_MS },
        )

        expect(
          rows,
          `no email_send_log row for ${email} within ${EMAIL_POLL_TIMEOUT_MS}ms — is the auth webhook / email queue running?`,
        ).not.toBeNull()
        const signup = rows!.find((r) => r.template_name === 'signup')
        expect(signup, 'no template_name=signup row for the new user').toBeTruthy()
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
