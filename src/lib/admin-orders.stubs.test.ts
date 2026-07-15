import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression tests for the admin orders reconciliation stubs in
// `src/lib/admin-orders.functions.ts`.
//
// Since the `subscriptions` and `stripe_webhook_events` tables were dropped,
// the reconciliation surface must:
//   - never query those tables
//   - leave the `subscription` kind as a no-op that yields zero rows
//   - keep `last_webhook: null` on every projected row (UI compatibility)
//   - keep the row shape and summary counts computable from just
//     panty_orders, content_purchases, and private_room_bookings

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  resolve(__dirname, './admin-orders.functions.ts'),
  'utf8',
)

describe('admin-orders stubs — no Stripe reconciliation', () => {
  it('does not query dropped Stripe tables', () => {
    expect(SOURCE).not.toMatch(/\.from\(['"`]subscriptions['"`]\)/)
    expect(SOURCE).not.toMatch(/\.from\(['"`]stripe_webhook_events['"`]\)/)
  })

  it('does not import the Stripe SDK', () => {
    expect(SOURCE).not.toMatch(/from ['"]stripe['"]/)
    expect(SOURCE).not.toMatch(/from ['"]@stripe\//)
  })

  it('projects every row with last_webhook: null', () => {
    const nulls = SOURCE.match(/last_webhook:\s*null/g) ?? []
    // panty, content, and booking projections each emit one row
    expect(nulls.length).toBeGreaterThanOrEqual(3)
    expect(SOURCE).not.toMatch(/last_webhook:\s*\{/)
  })

  it('accepts the "subscription" kind in input but does not fetch rows for it', () => {
    expect(SOURCE).toMatch(/z\.enum\(\[\s*"all",\s*"panty",\s*"subscription",/)
    // The three actual fetches are the only ones — no subscription branch.
    const fromCalls = SOURCE.match(/sb\s*\n?\s*\.from\(/g) ?? []
    expect(fromCalls.length).toBe(3)
  })

  it('validates admin access before returning any data', () => {
    expect(SOURCE).toMatch(/await assertAdmin\(context\.supabase, context\.userId\)/)
  })

  it('exports a summary that can render an empty state (counts default to 0)', () => {
    // The handler always returns { rows, summary: { total, granted, pending, revoked } }
    expect(SOURCE).toMatch(/rows\.filter\(\(r\) => r\.entitlement_state === "granted"\)\.length/)
    expect(SOURCE).toMatch(/rows\.filter\(\(r\) => r\.entitlement_state === "pending"\)\.length/)
    expect(SOURCE).toMatch(/rows\.filter\(\(r\) => r\.entitlement_state === "revoked"\)\.length/)
  })
})
