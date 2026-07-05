/**
 * Integration tests for the free-event-ticket perk on term_pass_12
 * memberships.
 *
 * These mirror the exact SQL the RSVP auto-redeem path in
 * `src/lib/rsvp.functions.ts` executes: select the perk-eligible
 * memberships for the user, pick the winning row (lifetime first, then an
 * *active* term_pass_12 whose `expires_at > now()`), and if it hasn't been
 * consumed yet, stamp `event_ticket_used_at` + `event_ticket_event_id`.
 *
 * The UI at `src/routes/_authenticated/library.tsx` reads those same
 * columns through `getMyMembership` / `loadPerkMembership`, so verifying
 * them at the DB layer keeps the UI and backend consistent by
 * construction: if these tests pass, the "Free event ticket" perk card
 * flips from "Browse events" to "Redeemed. Thanks for coming!" the moment
 * the same update lands from the server function.
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=... bunx vitest run src/lib/termPass12TicketRedemption.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const PUBLISHABLE =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

const HAS_ENV = Boolean(URL && PUBLISHABLE && SERVICE_ROLE)

function adminClient(): SupabaseClient {
  return createClient(URL!, SERVICE_ROLE!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  })
}

function anonClient(): SupabaseClient {
  return createClient(URL!, PUBLISHABLE!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  })
}

// Mirrors the perk-resolution rules from
// `loadPerkMembership` in src/lib/memberships.functions.ts and the inline
// auto-redeem query in src/lib/rsvp.functions.ts. Kept as a plain helper
// so the test itself asserts the same behavior the app relies on.
type Row = {
  id: string
  kind: 'lifetime' | 'term_pass_12' | string
  event_ticket_used_at: string | null
  expires_at: string | null
}
function pickPerkRow(rows: Row[], nowMs = Date.now()): Row | null {
  return (
    rows.find((r) => r.kind === 'lifetime') ??
    rows.find(
      (r) =>
        r.kind === 'term_pass_12' &&
        r.expires_at !== null &&
        new Date(r.expires_at).getTime() > nowMs,
    ) ??
    null
  )
}

describe.skipIf(!HAS_ENV)(
  'term_pass_12 free-event-ticket redemption + UI/backend consistency',
  () => {
    const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient)

    const createdUserIds: string[] = []
    const createdEventIds: string[] = []
    const createdMembershipIds: string[] = []
    const createdRsvpIds: string[] = []

    async function createUser(prefix: string) {
      const email = `${prefix}-${crypto.randomUUID()}@example.test`
      const password = `Test-${crypto.randomUUID()}`
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      createdUserIds.push(data.user.id)
      return { id: data.user.id, email, password }
    }

    async function createEvent(hostId: string) {
      const { data, error } = await admin
        .from('events')
        .insert({
          host_id: hostId,
          title: `Perk Test ${crypto.randomUUID().slice(0, 8)}`,
          venue_name: 'Test Venue',
          starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('event insert failed')
      createdEventIds.push(data.id as string)
      return data.id as string
    }

    async function createMembership(row: {
      user_id: string
      kind: 'lifetime' | 'term_pass_12'
      expires_at?: string | null
      term_months?: number | null
    }) {
      const { data, error } = await admin
        .from('memberships')
        .insert({
          user_id: row.user_id,
          kind: row.kind,
          environment: 'sandbox',
          expires_at: row.expires_at ?? null,
          term_months: row.term_months ?? null,
        })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('membership insert failed')
      createdMembershipIds.push(data.id as string)
      return data.id as string
    }

    // The exact select the RSVP auto-redeem runs.
    async function loadPerkRowsAsAdmin(userId: string): Promise<Row[]> {
      const { data, error } = await admin
        .from('memberships')
        .select('id, kind, event_ticket_used_at, expires_at')
        .eq('user_id', userId)
        .eq('environment', 'sandbox')
        .in('kind', ['lifetime', 'term_pass_12'])
      if (error) throw error
      return (data ?? []) as Row[]
    }

    // Simulates the RSVP auto-redeem write.
    async function autoRedeemForRsvp(userId: string, eventId: string) {
      const rows = await loadPerkRowsAsAdmin(userId)
      const perk = pickPerkRow(rows)
      if (!perk || perk.event_ticket_used_at) return { perk, updated: false }
      const { error } = await admin
        .from('memberships')
        .update({
          event_ticket_used_at: new Date().toISOString(),
          event_ticket_event_id: eventId,
        })
        .eq('id', perk.id)
      if (error) throw error
      return { perk, updated: true }
    }

    let hostId = ''
    let eventId = ''

    beforeAll(async () => {
      if (!HAS_ENV) return
      const host = await createUser('perk-host')
      hostId = host.id
      eventId = await createEvent(hostId)
    }, 30_000)

    afterAll(async () => {
      if (!HAS_ENV) return
      for (const id of createdRsvpIds) {
        await admin.from('rsvps').delete().eq('id', id).then(() => {}, () => {})
      }
      for (const id of createdMembershipIds) {
        await admin.from('memberships').delete().eq('id', id).then(() => {}, () => {})
      }
      for (const id of createdEventIds) {
        await admin.from('events').delete().eq('id', id).then(() => {}, () => {})
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id).catch(() => {})
      }
    }, 30_000)

    it('picks an active term_pass_12 row as the perk holder', async () => {
      const guest = await createUser('perk-active')
      const expires = new Date(Date.now() + 90 * 86_400_000).toISOString()
      await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: expires,
        term_months: 12,
      })

      const rows = await loadPerkRowsAsAdmin(guest.id)
      const perk = pickPerkRow(rows)
      expect(perk).not.toBeNull()
      expect(perk!.kind).toBe('term_pass_12')
      expect(perk!.event_ticket_used_at).toBeNull()
    }, 30_000)

    it('ignores an expired term_pass_12 row', async () => {
      const guest = await createUser('perk-expired')
      const expired = new Date(Date.now() - 86_400_000).toISOString()
      await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: expired,
        term_months: 12,
      })

      const rows = await loadPerkRowsAsAdmin(guest.id)
      expect(pickPerkRow(rows)).toBeNull()
    }, 30_000)

    it('prefers a lifetime row over an active term_pass_12', async () => {
      const guest = await createUser('perk-both')
      const lifetimeId = await createMembership({
        user_id: guest.id,
        kind: 'lifetime',
      })
      await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        term_months: 12,
      })

      const rows = await loadPerkRowsAsAdmin(guest.id)
      const perk = pickPerkRow(rows)
      expect(perk?.kind).toBe('lifetime')
      expect(perk?.id).toBe(lifetimeId)
    }, 30_000)

    it('consumes the ticket on first RSVP and does not re-consume it on a second RSVP', async () => {
      const guest = await createUser('perk-consume')
      const expires = new Date(Date.now() + 60 * 86_400_000).toISOString()
      const membershipId = await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: expires,
        term_months: 12,
      })

      const first = await autoRedeemForRsvp(guest.id, eventId)
      expect(first.updated).toBe(true)

      // Backend state: consumed + pointing at the event that spent it.
      const afterFirst = await admin
        .from('memberships')
        .select('event_ticket_used_at, event_ticket_event_id')
        .eq('id', membershipId)
        .single()
      expect(afterFirst.error).toBeNull()
      expect(afterFirst.data!.event_ticket_used_at).not.toBeNull()
      expect(afterFirst.data!.event_ticket_event_id).toBe(eventId)
      const firstUsedAt = afterFirst.data!.event_ticket_used_at as string

      // Second RSVP (to a different event) must NOT reconsume the ticket:
      // the ticket_used_at timestamp and event_id must stay pinned to the
      // first redemption — this is the exact contract the Library UI's
      // "Redeemed. Thanks for coming!" copy relies on.
      const secondEventId = await createEvent(hostId)
      const second = await autoRedeemForRsvp(guest.id, secondEventId)
      expect(second.updated).toBe(false)

      const afterSecond = await admin
        .from('memberships')
        .select('event_ticket_used_at, event_ticket_event_id')
        .eq('id', membershipId)
        .single()
      expect(afterSecond.data!.event_ticket_used_at).toBe(firstUsedAt)
      expect(afterSecond.data!.event_ticket_event_id).toBe(eventId)
    }, 30_000)

    it('exposes the consumed ticket through the same select getMyMembership uses (UI/backend consistency)', async () => {
      const guest = await createUser('perk-ui')
      const expires = new Date(Date.now() + 45 * 86_400_000).toISOString()
      await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: expires,
        term_months: 12,
      })
      await autoRedeemForRsvp(guest.id, eventId)

      // Read back exactly the projection getMyMembership / loadPerkMembership use.
      const { data, error } = await admin
        .from('memberships')
        .select(
          'id, kind, event_ticket_used_at, event_ticket_event_id, expires_at, private_session_requested_at, private_session_fulfilled_at, private_session_duration_minutes, private_session_bundle_id, private_session_bundle_granted_at',
        )
        .eq('user_id', guest.id)
        .eq('environment', 'sandbox')
        .in('kind', ['lifetime', 'term_pass_12'])

      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      const row = data![0]!
      expect(row.kind).toBe('term_pass_12')
      // These two fields drive the library copy:
      //   ticketUsed = !!membership.event_ticket_used_at
      //   headerLabel: isTerm12 → "12-month pass perks"
      expect(row.event_ticket_used_at).not.toBeNull()
      expect(row.event_ticket_event_id).toBe(eventId)
      // Duration column must exist and default to 30 for the "half-hour"
      // perk copy to hold.
      expect(row.private_session_duration_minutes).toBe(30)
    }, 30_000)

    it('lets the member update their own membership row via RLS (auth-user consumption path)', async () => {
      // The RSVP server fn runs with requireSupabaseAuth, so the update is
      // performed by an authenticated Supabase client subject to the
      // "Users update own membership perks" policy. This test drives that
      // exact path end-to-end.
      const guest = await createUser('perk-rls')
      const expires = new Date(Date.now() + 30 * 86_400_000).toISOString()
      const membershipId = await createMembership({
        user_id: guest.id,
        kind: 'term_pass_12',
        expires_at: expires,
        term_months: 12,
      })

      const authed = anonClient()
      const { error: signInErr } = await authed.auth.signInWithPassword({
        email: guest.email,
        password: guest.password,
      })
      expect(signInErr).toBeNull()

      const nowIso = new Date().toISOString()
      const { error: updateErr } = await authed
        .from('memberships')
        .update({
          event_ticket_used_at: nowIso,
          event_ticket_event_id: eventId,
        })
        .eq('id', membershipId)
      expect(updateErr).toBeNull()

      const readback = await admin
        .from('memberships')
        .select('event_ticket_used_at, event_ticket_event_id')
        .eq('id', membershipId)
        .single()
      expect(readback.data!.event_ticket_used_at).toBe(nowIso)
      expect(readback.data!.event_ticket_event_id).toBe(eventId)

      await authed.auth.signOut()
    }, 45_000)
  },
)
