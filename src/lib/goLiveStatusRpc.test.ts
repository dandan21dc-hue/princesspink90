/**
 * Integration test for the go_live_status() RPC.
 *
 * Runs against a REAL database. Auto-skips when SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and SUPABASE_PUBLISHABLE_KEY are not present
 * and when RUN_SMOKE_TESTS!=1, so it stays green in CI / local runs
 * without secrets.
 *
 *   RUN_SMOKE_TESTS=1 \
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SUPABASE_PUBLISHABLE_KEY=... \
 *     bunx vitest run src/lib/goLiveStatusRpc.test.ts
 *
 * Verifies the RPC contract:
 *  - Requires authentication + admin role (rejects anon, rejects
 *    non-admin authenticated users).
 *  - Returns every documented field with the correct type / nullability.
 *  - Numeric counts are self-consistent (rsvp_with_entry_phrase ≤ rsvp_total,
 *    both non-negative).
 *  - cron_jobs is an array of {jobname, schedule, active} objects.
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

const HAS_CREDS =
  Boolean(URL && SERVICE_KEY && PUB_KEY) && process.env.RUN_SMOKE_TESTS === '1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let anon: SupabaseClient<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminUser: SupabaseClient<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plainUser: SupabaseClient<any>
let adminUserId = ''
let plainUserId = ''

const OPTIONAL_TIMESTAMP_FIELDS = [
  'last_email_sent_at',
  'last_entry_phrase_at',
] as const
const OPTIONAL_STRING_FIELDS = [
  'last_email_template',
  'last_email_recipient',
] as const

function isIsoTimestamp(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const d = new Date(v)
  return !Number.isNaN(d.getTime())
}

async function createConfirmedUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a: SupabaseClient<any>,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw new Error(`createUser failed: ${error?.message ?? 'no user'}`)
  }
  return data.user.id
}

describe.skipIf(!HAS_CREDS)('go_live_status() RPC contract', () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    anon = createClient(URL!, PUB_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const stamp = Date.now()
    const adminEmail = `go-live-admin-${stamp}@example.test`
    const plainEmail = `go-live-plain-${stamp}@example.test`
    const password = `Pw!${stamp}abcdef`

    adminUserId = await createConfirmedUser(admin, adminEmail, password)
    plainUserId = await createConfirmedUser(admin, plainEmail, password)

    // Grant admin role only to adminUser.
    const { error: roleErr } = await admin
      .from('user_roles')
      .insert({ user_id: adminUserId, role: 'admin' })
    if (roleErr) throw new Error(`grant admin failed: ${roleErr.message}`)

    adminUser = createClient(URL!, PUB_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    plainUser = createClient(URL!, PUB_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const s1 = await adminUser.auth.signInWithPassword({
      email: adminEmail,
      password,
    })
    if (s1.error) throw new Error(`admin sign-in failed: ${s1.error.message}`)
    const s2 = await plainUser.auth.signInWithPassword({
      email: plainEmail,
      password,
    })
    if (s2.error) throw new Error(`plain sign-in failed: ${s2.error.message}`)
  }, 60_000)

  afterAll(async () => {
    // Best-effort cleanup.
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId).catch(() => {})
    if (plainUserId) await admin.auth.admin.deleteUser(plainUserId).catch(() => {})
  })

  it('rejects unauthenticated callers', async () => {
    const { data, error } = await anon.rpc('go_live_status')
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/not authenticated|auth/)
  })

  it('rejects authenticated non-admin callers', async () => {
    const { data, error } = await plainUser.rpc('go_live_status')
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/admin/)
  })

  it('returns every documented field with correct types for an admin', async () => {
    const { data, error } = await adminUser.rpc('go_live_status')
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const s = data as Record<string, unknown>

    // Numeric, non-negative, and consistent.
    expect(typeof s.rsvp_total).toBe('number')
    expect(typeof s.rsvp_with_entry_phrase).toBe('number')
    expect(s.rsvp_total as number).toBeGreaterThanOrEqual(0)
    expect(s.rsvp_with_entry_phrase as number).toBeGreaterThanOrEqual(0)
    expect(s.rsvp_with_entry_phrase as number).toBeLessThanOrEqual(
      s.rsvp_total as number,
    )

    // Optional timestamps: either null or a parseable ISO string.
    for (const f of OPTIONAL_TIMESTAMP_FIELDS) {
      const v = s[f]
      if (v !== null) {
        expect(isIsoTimestamp(v)).toBe(true)
      }
    }
    // Optional strings: either null or a non-empty string.
    for (const f of OPTIONAL_STRING_FIELDS) {
      const v = s[f]
      if (v !== null) {
        expect(typeof v).toBe('string')
        expect((v as string).length).toBeGreaterThan(0)
      }
    }

    // cron_jobs: array of {jobname:string, schedule:string, active:boolean}
    expect(Array.isArray(s.cron_jobs)).toBe(true)
    for (const j of s.cron_jobs as unknown[]) {
      const row = j as Record<string, unknown>
      expect(typeof row.jobname).toBe('string')
      expect((row.jobname as string).length).toBeGreaterThan(0)
      expect(typeof row.schedule).toBe('string')
      expect(typeof row.active).toBe('boolean')
    }

    // If a "sent" email exists, template + recipient must also be present.
    if (s.last_email_sent_at !== null) {
      expect(s.last_email_template).not.toBeNull()
      expect(s.last_email_recipient).not.toBeNull()
    }
  })
})
