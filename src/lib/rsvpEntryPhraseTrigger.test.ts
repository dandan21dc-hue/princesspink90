/**
 * Integration test for the rsvps_assign_entry_phrase BEFORE INSERT trigger.
 *
 * Verifies that when a client inserts an RSVP with entry_phrase omitted,
 * empty (''), or blank-whitespace ('   '), the trigger populates a
 * non-empty entry_phrase in the row that lands in the database.
 *
 * Uses the service role to create/clean up a throwaway host + event so the
 * test doesn't depend on any pre-existing fixtures. Skips cleanly when
 * SUPABASE_SERVICE_ROLE_KEY is not exposed.
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=... bunx vitest run src/lib/rsvpEntryPhraseTrigger.test.ts
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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
  })
}

describe.skipIf(!HAS_ENV)(
  'rsvps_assign_entry_phrase trigger populates entry_phrase',
  () => {
    const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient)

    const createdUserIds: string[] = []
    const createdEventIds: string[] = []
    const createdRsvpIds: string[] = []

    async function createHost() {
      const email = `phrase-host-${crypto.randomUUID()}@example.test`
      const password = `Test-${crypto.randomUUID()}`
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      createdUserIds.push(data.user.id)
      return data.user.id
    }

    async function createEvent(hostId: string) {
      const { data, error } = await admin
        .from('events')
        .insert({
          host_id: hostId,
          title: `Trigger Test ${crypto.randomUUID().slice(0, 8)}`,
          venue_name: 'Test Venue',
          starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })
        .select('id')
        .single()
      if (error || !data)
        throw error ?? new Error('event insert failed')
      createdEventIds.push(data.id as string)
      return data.id as string
    }

    async function createGuest() {
      const email = `phrase-guest-${crypto.randomUUID()}@example.test`
      const password = `Test-${crypto.randomUUID()}`
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      createdUserIds.push(data.user.id)
      return data.user.id
    }

    let hostId = ''
    let eventId = ''

    beforeAll(async () => {
      if (!HAS_ENV) return
      hostId = await createHost()
      eventId = await createEvent(hostId)
    }, 30_000)

    afterAll(async () => {
      if (!HAS_ENV) return
      for (const id of createdRsvpIds) {
        await admin.from('rsvps').delete().eq('id', id).then(
          () => undefined,
          () => undefined,
        )
      }
      for (const id of createdEventIds) {
        await admin.from('events').delete().eq('id', id).then(
          () => undefined,
          () => undefined,
        )
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id).catch(() => {})
      }
    }, 30_000)

    async function insertRsvpAndReadBack(
      entry_phrase: string | null | undefined,
    ) {
      const guestId = await createGuest()

      // Build the insert payload — omit the key entirely when `undefined`
      // so we cover both "field not sent" and "explicit blank" cases.
      const payload: Record<string, unknown> = {
        event_id: eventId,
        user_id: guestId,
      }
      if (entry_phrase !== undefined) payload.entry_phrase = entry_phrase

      const insert = await admin
        .from('rsvps')
        .insert(payload)
        .select('id, entry_phrase')
        .single()

      expect(
        insert.error,
        `rsvp insert failed: ${insert.error?.message}`,
      ).toBeNull()
      expect(insert.data, 'insert returned no row').not.toBeNull()

      const rsvpId = insert.data!.id as string
      createdRsvpIds.push(rsvpId)

      // Read back through a fresh SELECT to confirm the row actually
      // persisted with a non-empty entry_phrase (not just what the insert
      // returning clause echoed).
      const readback = await admin
        .from('rsvps')
        .select('entry_phrase')
        .eq('id', rsvpId)
        .single()
      expect(readback.error).toBeNull()

      return {
        fromInsert: insert.data!.entry_phrase as string | null,
        fromSelect: readback.data!.entry_phrase as string | null,
      }
    }

    it('assigns a non-empty entry_phrase when the field is omitted', async () => {
      const { fromInsert, fromSelect } = await insertRsvpAndReadBack(undefined)
      expect(fromInsert).toBe(fromSelect)
      expect(fromSelect, 'entry_phrase is null after insert').not.toBeNull()
      expect(fromSelect!.trim().length, 'entry_phrase is blank').toBeGreaterThan(0)
    }, 30_000)

    it("assigns a non-empty entry_phrase when '' is sent", async () => {
      const { fromInsert, fromSelect } = await insertRsvpAndReadBack('')
      expect(fromInsert).toBe(fromSelect)
      expect(fromSelect).not.toBeNull()
      expect(fromSelect).not.toBe('')
      expect(fromSelect!.trim().length).toBeGreaterThan(0)
    }, 30_000)

    it('assigns a non-empty entry_phrase when only whitespace is sent', async () => {
      const { fromInsert, fromSelect } = await insertRsvpAndReadBack('   ')
      expect(fromInsert).toBe(fromSelect)
      expect(fromSelect).not.toBeNull()
      expect(fromSelect!.trim().length).toBeGreaterThan(0)
      // Must not be the whitespace we sent — the trigger must overwrite it.
      expect(fromSelect).not.toBe('   ')
    }, 30_000)

    it('preserves an explicit non-blank entry_phrase', async () => {
      const explicit = `Custom Phrase ${crypto.randomUUID().slice(0, 8)}`
      const { fromSelect } = await insertRsvpAndReadBack(explicit)
      expect(fromSelect).toBe(explicit)
    }, 30_000)
  },
)
