import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression test for `src/routes/store.subscribe.tsx`.
//
// The subscribe page reads live prices from Stripe (getSubscribePrices) so
// the visible amount tracks the catalogue automatically. What this test
// STILL guards is the label → PriceId wiring: each PassCard's label must
// resolve to the correct Stripe lookup_key inside priceLabel(...) AND the
// button must call onBuy() with that same lookup_key. If someone shuffles
// the JSX and misroutes a card, the user gets charged the wrong plan.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  resolve(__dirname, './store.subscribe.tsx'),
  'utf8',
)

type PlanExpectation = { label: string; priceId: string; fallback: string }

// Source of truth for label → priceId. Update this table when plans change.
const EXPECTED_PLANS: PlanExpectation[] = [
  { label: 'Monthly',        priceId: 'all_access_monthly_aud',       fallback: 'A$10' },
  { label: '3-Month Term',   priceId: 'all_access_3mo_monthly_aud',   fallback: 'A$27' },
  { label: '6-Month Term',   priceId: 'all_access_6mo_monthly_aud',   fallback: 'A$48' },
  { label: '12-Month Term',  priceId: 'all_access_12mo_monthly_aud',  fallback: 'A$84' },
  { label: '24 Hours Worn',  priceId: 'panty_24hr_aud',               fallback: 'A$60' },
  { label: '48 Hours Worn',  priceId: 'panty_48hr_aud',               fallback: 'A$90' },
  { label: '72 Hours Worn',  priceId: 'panty_72hr_aud',               fallback: 'A$120' },
]
const LIFETIME = { priceId: 'lifetime_onetime_aud', fallback: 'A$500' }

// Match either:
//   <PassCard label="Monthly" price="A$10" ... onClick={() => onBuy("...")}
// or (post live-prices) the priceLabel(...) form:
//   <PassCard label="Monthly" price={priceLabel(prices, "all_access_monthly_aud", "A$10")} ...
//              onClick={() => onBuy("all_access_monthly_aud")}
function extractPassCards(src: string): Array<{ label: string; priceId: string; fallback: string }> {
  const cardRe = /<PassCard\b([\s\S]*?)\/>/g
  const cards: Array<{ label: string; priceId: string; fallback: string }> = []
  for (const match of src.matchAll(cardRe)) {
    const body = match[1]!
    const label = /label=\{?"([^"]+)"\}?/.exec(body)?.[1]
    const clickPriceId = /onClick=\{\(\)\s*=>\s*onBuy\("([^"]+)"\)\}/.exec(body)?.[1]
    // priceLabel(prices, "<lookup_key>", "<fallback>") — quoted fallback
    const priceLabelMatch = /priceLabel\(\s*prices\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(body)
    if (label && clickPriceId && priceLabelMatch) {
      cards.push({
        label,
        priceId: clickPriceId,
        fallback: priceLabelMatch[2]!,
      })
      // ALSO assert the lookup_key inside priceLabel matches the onBuy id
      // (this is the tightest wire).
      expect(priceLabelMatch[1]).toBe(clickPriceId)
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
    it(`wires "${expected.label}" to priceId "${expected.priceId}" with fallback ${expected.fallback}`, () => {
      const card = cards.find((c) => c.label === expected.label)
      expect(card, `no PassCard found with label ${expected.label}`).toBeDefined()
      expect(card!.priceId).toBe(expected.priceId)
      expect(card!.fallback).toBe(expected.fallback)
    })
  }

  it('wires the Lifetime block to the correct PriceId and includes its fallback price', () => {
    expect(SOURCE).toContain(LIFETIME.fallback)
    expect(SOURCE).toMatch(new RegExp(`onBuy\\("${LIFETIME.priceId}"\\)`))
    // Escape $ (regex meta) in the fallback literal
    const escapedFallback = LIFETIME.fallback.replace(/[$]/g, '\\$')
    expect(SOURCE).toMatch(
      new RegExp(
        `priceLabel\\(prices,\\s*"${LIFETIME.priceId}",\\s*"${escapedFallback}"\\)`,
      ),
    )
  })


  it('does not call onBuy() with any unknown PriceId', () => {
    const allowed = new Set<string>([
      ...EXPECTED_PLANS.map((p) => p.priceId),
      LIFETIME.priceId,
    ])
    const buyRe = /onBuy\("([^"]+)"\)/g
    const used = new Set<string>()
    for (const m of SOURCE.matchAll(buyRe)) used.add(m[1]!)
    for (const priceId of used) {
      expect(allowed.has(priceId), `unexpected PriceId used: ${priceId}`).toBe(true)
    }
    for (const priceId of allowed) {
      expect(used.has(priceId), `PriceId "${priceId}" is declared but never used`).toBe(true)
    }
  })

  it('keeps the PriceId union in sync with the plans actually wired up', () => {
    const unionMatch = /type PriceId =([\s\S]*?);/.exec(SOURCE)
    expect(unionMatch, 'PriceId union not found in source').not.toBeNull()
    const declared = new Set<string>(
      Array.from(unionMatch![1]!.matchAll(/"([^"]+)"/g)).map((m) => m[1]!),
    )
    const used = new Set<string>(
      Array.from(SOURCE.matchAll(/onBuy\("([^"]+)"\)/g)).map((m) => m[1]!),
    )
    expect([...declared].sort()).toEqual([...used].sort())
  })
})
