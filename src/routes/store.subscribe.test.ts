import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression test for `src/routes/store.subscribe.tsx`.
//
// The subscribe page wires each visible plan (label + price) to a Stripe
// `PriceId` through the local `buy(...)` helper. If someone reshuffles the
// JSX and hooks a card up to the wrong PriceId, the UI still renders fine
// and typecheck still passes — the customer is just quietly charged the
// wrong amount. This test scans the source and asserts the label ↔ price
// ↔ PriceId triple for every plan, so any future mismatch fails CI before
// it ships.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  resolve(__dirname, './store.subscribe.tsx'),
  'utf8',
)

type PlanExpectation = {
  label: string
  price: string
  priceId: string
}

// The source of truth for what each visible plan MUST charge. Update this
// table (and only this table) when plans genuinely change; a drift between
// the table and the JSX is the bug this test is designed to catch.
const EXPECTED_PLANS: PlanExpectation[] = [
  { label: 'Monthly',        price: 'A$10',  priceId: 'all_access_monthly_aud' },
  { label: '3-Month Pass',   price: 'A$27',  priceId: 'all_access_3mo_onetime_aud' },
  { label: '6-Month Pass',   price: 'A$48',  priceId: 'all_access_6mo_onetime_aud' },
  { label: '12-Month Pass',  price: 'A$84',  priceId: 'all_access_12mo_onetime_aud' },
  { label: '24 Hours Worn',  price: 'A$60',  priceId: 'panty_24hr_aud' },
  { label: '48 Hours Worn',  price: 'A$90',  priceId: 'panty_48hr_aud' },
  { label: '72 Hours Worn',  price: 'A$120', priceId: 'panty_72hr_aud' },
]

// The lifetime card is a bespoke block (not a <PassCard/>) so we match it
// separately by its button copy.
const LIFETIME = { priceId: 'lifetime_onetime_aud', price: 'A$500' }

function extractPassCards(src: string): Array<Record<string, string>> {
  // Match <PassCard ... /> blocks and pull out label, price and the priceId
  // passed to buy(...). Non-greedy on purpose so each card is captured
  // independently.
  const cardRe = /<PassCard\b([\s\S]*?)\/>/g
  const cards: Array<Record<string, string>> = []
  for (const match of src.matchAll(cardRe)) {
    const body = match[1]!
    const label = /label=\{?"([^"]+)"\}?/.exec(body)?.[1]
    const price = /price=\{?"([^"]+)"\}?/.exec(body)?.[1]
    const priceId = /onClick=\{\(\)\s*=>\s*buy\("([^"]+)"\)\}/.exec(body)?.[1]
    if (label && price && priceId) {
      cards.push({ label, price, priceId })
    }
  }
  return cards
}

describe('store.subscribe.tsx — PriceId regression', () => {
  const cards = extractPassCards(SOURCE)

  it('renders every expected plan card exactly once', () => {
    expect(cards).toHaveLength(EXPECTED_PLANS.length)
    const labels = cards.map((c) => c.label).sort()
    expect(labels).toEqual(EXPECTED_PLANS.map((p) => p.label).sort())
  })

  for (const expected of EXPECTED_PLANS) {
    it(`wires "${expected.label}" (${expected.price}) to priceId "${expected.priceId}"`, () => {
      const card = cards.find((c) => c.label === expected.label)
      expect(card, `no PassCard found with label ${expected.label}`).toBeDefined()
      expect(card!.price).toBe(expected.price)
      expect(card!.priceId).toBe(expected.priceId)
    })
  }

  it('wires the Lifetime block to the correct PriceId and price', () => {
    // Lifetime is a bespoke block, not a <PassCard/>. Assert the price copy
    // and the buy() call live in the same source and match expectations.
    expect(SOURCE).toContain(`${LIFETIME.price}`)
    expect(SOURCE).toMatch(
      new RegExp(`onClick=\\{\\(\\)\\s*=>\\s*buy\\("${LIFETIME.priceId}"\\)\\}`),
    )
  })

  it('does not call buy() with any unknown PriceId', () => {
    const allowed = new Set<string>([
      ...EXPECTED_PLANS.map((p) => p.priceId),
      LIFETIME.priceId,
    ])
    const buyRe = /buy\("([^"]+)"\)/g
    const used = new Set<string>()
    for (const m of SOURCE.matchAll(buyRe)) used.add(m[1]!)
    for (const priceId of used) {
      expect(allowed.has(priceId), `unexpected PriceId used: ${priceId}`).toBe(true)
    }
    // And every allowed PriceId is actually used — no dead entries left in
    // the PriceId union after a plan is removed.
    for (const priceId of allowed) {
      expect(used.has(priceId), `PriceId "${priceId}" is declared but never used`).toBe(true)
    }
  })

  it('keeps the PriceId union in sync with the plans actually wired up', () => {
    // Extract the PriceId type union and ensure it matches the set of
    // priceIds we actually call buy() with. Prevents orphaned union members
    // (dead types) and undeclared PriceIds (type error waiting to happen).
    const unionMatch = /type PriceId =([\s\S]*?);/.exec(SOURCE)
    expect(unionMatch, 'PriceId union not found in source').not.toBeNull()
    const declared = new Set<string>(
      Array.from(unionMatch![1]!.matchAll(/"([^"]+)"/g)).map((m) => m[1]!),
    )
    const used = new Set<string>(
      Array.from(SOURCE.matchAll(/buy\("([^"]+)"\)/g)).map((m) => m[1]!),
    )
    expect([...declared].sort()).toEqual([...used].sort())
  })
})
