import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Cross-file regression guard for the term-pass metadata mapping.
//
// The checkout builder (src/lib/store.functions.ts) writes
// `metadata.membership = "term_pass"` + `term_months` based on a regex over
// the PriceId, and the webhook (src/routes/api/public/payments/webhook.ts)
// provisions the `memberships.kind = term_pass_N` row from a matching
// regex on `customer.subscription.created`. These two regexes must stay in
// lockstep — otherwise a 12-month renewal lands as a subscription row with
// no membership perk, and the free-event-ticket never provisions.

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE  = readFileSync(resolve(__dirname, './store.functions.ts'), 'utf8')
const HOOK   = readFileSync(
  resolve(__dirname, '../routes/api/public/payments/webhook.ts'),
  'utf8',
)

function extractRegex(source: string, marker: RegExp): RegExp {
  const m = marker.exec(source)
  if (!m) throw new Error(`marker not found: ${marker}`)
  // Rebuild the JS RegExp literal `/…/` from the source snippet.
  const lit = /\/(\^all_access_[^\/]+)\/(?=\.exec)/.exec(m[0])
  if (!lit) throw new Error(`could not parse regex literal near: ${m[0]}`)
  return new RegExp(lit[1]!)
}

// Both mappings — checkout (writes metadata) and webhook (reads price lookup_key
// on the subscription item) — are the only surface for term-pass provisioning.
const CHECKOUT_RE = extractRegex(STORE, /\/\^all_access_[^\/]+\/\.exec\(data\.priceId\)/)
const WEBHOOK_RE  = extractRegex(HOOK,  /\/\^all_access_[^\/]+\/\.exec\(priceId\)/)

describe('term-pass PriceId → termMonths mapping', () => {
  const CHECKOUT_INPUTS = [
    { id: 'all_access_3mo_monthly_aud',  months: 3 },
    { id: 'all_access_6mo_monthly_aud',  months: 6 },
    { id: 'all_access_12mo_monthly_aud', months: 12 },
    { id: 'all_access_3mo_onetime_aud',  months: 3 },
    { id: 'all_access_12mo_onetime_aud', months: 12 },
  ]
  const WEBHOOK_ONLY_INPUTS = [
    // Auto-renew swaps to a `_renew_aud` lookup_key; only the webhook must accept it.
    { id: 'all_access_3mo_renew_aud',   months: 3 },
    { id: 'all_access_6mo_renew_aud',   months: 6 },
    { id: 'all_access_12mo_renew_aud',  months: 12 },
  ]

  it.each(CHECKOUT_INPUTS)('checkout: %s → term_pass, term_months=$months', ({ id, months }) => {
    const m = CHECKOUT_RE.exec(id)
    expect(m, `checkout regex must accept ${id}`).not.toBeNull()
    expect(Number(m![1])).toBe(months)
  })

  it.each([...CHECKOUT_INPUTS, ...WEBHOOK_ONLY_INPUTS])(
    'webhook: %s → term_pass_%s membership',
    ({ id, months }) => {
      const m = WEBHOOK_RE.exec(id)
      expect(m, `webhook regex must accept ${id}`).not.toBeNull()
      expect(Number(m![1])).toBe(months)
    },
  )

  it.each([
    'lifetime_onetime_aud',
    'all_access_monthly_aud',       // plain monthly is NOT a term pass
    'all_access_9mo_monthly_aud',   // unsupported term length
    'all_access_3mo_yearly_aud',    // wrong suffix
    'panty_24hr_aud',
  ])('rejects non-term-pass PriceId "%s"', (id) => {
    expect(CHECKOUT_RE.exec(id)).toBeNull()
    expect(WEBHOOK_RE.exec(id)).toBeNull()
  })

  it('checkout metadata block emits the correct membership + term_months keys', () => {
    // Locks the exact metadata shape the webhook keys off of:
    //   { membership: "term_pass", term_months: String(termMonths) }
    expect(STORE).toMatch(
      /membership:\s*"term_pass"\s*,\s*term_months:\s*String\(termMonths\)/,
    )
    expect(STORE).toMatch(/isLifetime\s*&&\s*\{\s*membership:\s*"lifetime"\s*\}/)
  })

  it('webhook provisions a term_pass_N membership for termMonths ∈ {3,6,12}', () => {
    // Two provisioning paths must both stay in place:
    //  1. checkout.session.completed  → kind = `term_pass_${termMonths}` with [3,6,12] guard
    //  2. customer.subscription.created → ensureTermPassMembership(termMonths)
    expect(HOOK).toMatch(/\[3,\s*6,\s*12\]\.includes\(termMonths\)/)
    expect(HOOK).toMatch(/`term_pass_\$\{(?:opts\.)?termMonths\}`/)
    expect(HOOK).toMatch(/ensureTermPassMembership\(/)
  })

  it('webhook still routes lifetime purchases to memberships.kind="lifetime"', () => {
    expect(HOOK).toMatch(/session\.metadata\?\.membership\s*===\s*"lifetime"/)
    expect(HOOK).toMatch(/kind:\s*"lifetime"/)
  })
})
