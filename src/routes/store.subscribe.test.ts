import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression test for `src/routes/store.subscribe.tsx`.
//
// Guards:
//   - Every plan card (Monthly `<PassCard>`, term `<TermPassCard>`, panty
//     `<PassCard>`, and the inline Lifetime block) wires its label to the
//     right Stripe lookup_key in BOTH the priceLabel fallback and the
//     onBuy() handler.
//   - The PriceId union stays in sync with the plans actually used.
//   - Term-pass headline prices render the upfront "for N months" label
//     regardless of the auto-renew toggle (per the beta pricing spec).

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(resolve(__dirname, './store.subscribe.tsx'), 'utf8')

type PlanExpectation = { label: string; priceId: string; fallback: string }

// Source of truth for label → priceId. Update when plans change.
const PASS_PLANS: PlanExpectation[] = [
  { label: 'Monthly',       priceId: 'all_access_monthly_aud', fallback: 'A$10' },
  { label: '24 Hours Worn', priceId: 'panty_24hr_aud',         fallback: 'A$60' },
  { label: '48 Hours Worn', priceId: 'panty_48hr_aud',         fallback: 'A$90' },
  { label: '72 Hours Worn', priceId: 'panty_72hr_aud',         fallback: 'A$120' },
]
const TERM_PLANS: (PlanExpectation & { termMonths: 3 | 6 | 12 })[] = [
  { label: '3-Month Term',  priceId: 'all_access_3mo_monthly_aud',  fallback: 'A$27', termMonths: 3 },
  { label: '6-Month Term',  priceId: 'all_access_6mo_monthly_aud',  fallback: 'A$48', termMonths: 6 },
  { label: '12-Month Term', priceId: 'all_access_12mo_monthly_aud', fallback: 'A$84', termMonths: 12 },
]
const LIFETIME = { priceId: 'lifetime_onetime_aud', fallback: 'A$00' }
const ALL_KNOWN = new Set<string>([
  ...PASS_PLANS.map((p) => p.priceId),
  ...TERM_PLANS.map((p) => p.priceId),
  LIFETIME.priceId,
])

function extractPassCards(src: string) {
  // Panty cards live inside a .map() and reference `p.key` / `p.label` / `p.fallbackCents`
  // instead of literals. Extract that config table separately below; here we only
  // handle the literal <PassCard label="..." price={priceLabel(...)} ... onClick=...> shape.
  const out: PlanExpectation[] = []
  for (const m of src.matchAll(/<PassCard\b([\s\S]*?)\/>/g)) {
    const body = m[1]!
    const label = /label=\{?"([^"]+)"\}?/.exec(body)?.[1]
    const clickId = /onClick=\{\(\)\s*=>\s*onBuy\("([^"]+)"\)\}/.exec(body)?.[1]
    const priceLabel = /priceLabel\(\s*prices\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(body)
    if (label && clickId && priceLabel) {
      expect(priceLabel[1]).toBe(clickId) // lookup_key inside priceLabel must match onBuy id
      out.push({ label, priceId: clickId, fallback: priceLabel[2]! })
    }
  }
  return out
}

function extractPantyConfig(src: string) {
  const out: { priceId: string; label: string; fallbackCents: number }[] = []
  const re = /\{\s*key:\s*"(panty_\d+hr_aud)"[^}]*label:\s*"([^"]+)"[^}]*fallbackCents:\s*(\d+)/g
  for (const m of src.matchAll(re)) {
    out.push({ priceId: m[1]!, label: m[2]!, fallbackCents: Number(m[3]) })
  }
  return out
}

function extractTermPassCards(src: string) {
  const out: (PlanExpectation & { termMonths: number })[] = []
  for (const m of src.matchAll(/<TermPassCard\b([\s\S]*?)\/>/g)) {
    const body = m[1]!
    const label = /label="([^"]+)"/.exec(body)?.[1]
    const priceId = /priceId="([^"]+)"/.exec(body)?.[1]
    const termMonths = Number(/termMonths=\{(\d+)\}/.exec(body)?.[1])
    const priceLabel = /priceLabel\(\s*prices\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(body)
    if (label && priceId && termMonths && priceLabel) {
      expect(priceLabel[1]).toBe(priceId) // lookup_key alignment
      out.push({ label, priceId, fallback: priceLabel[2]!, termMonths })
    }
  }
  return out
}

describe('store.subscribe.tsx — plan wiring regression', () => {
  const passCards = extractPassCards(SOURCE)
  const pantyConfig = extractPantyConfig(SOURCE)
  const termCards = extractTermPassCards(SOURCE)

  it('renders every literal <PassCard> plan exactly once with the right lookup_key + fallback', () => {
    // Panty variants render inside a .map(), so the literal PassCards are just the Monthly one.
    const literals = passCards.filter((c) => !c.priceId.startsWith('panty_'))
    expect(literals).toHaveLength(1)
    const monthly = PASS_PLANS[0]!
    expect(literals[0]).toMatchObject({ label: monthly.label, priceId: monthly.priceId, fallback: monthly.fallback })
  })

  it('declares every panty variant in the config table with the expected label', () => {
    const panties = PASS_PLANS.filter((p) => p.priceId.startsWith('panty_'))
    expect(pantyConfig.map((p) => p.priceId).sort()).toEqual(panties.map((p) => p.priceId).sort())
    for (const p of panties) {
      const cfg = pantyConfig.find((c) => c.priceId === p.priceId)!
      expect(cfg.label).toBe(p.label)
      // fallbackCents must round-trip to the documented A$ fallback.
      expect(`A$${cfg.fallbackCents / 100}`).toBe(p.fallback)
    }
  })

  it('renders every <TermPassCard> once with matching label, termMonths, and priceId', () => {
    expect(termCards).toHaveLength(TERM_PLANS.length)
    for (const t of TERM_PLANS) {
      const card = termCards.find((c) => c.priceId === t.priceId)
      expect(card, `missing TermPassCard for ${t.priceId}`).toBeDefined()
      expect(card!.label).toBe(t.label)
      expect(card!.termMonths).toBe(t.termMonths)
      expect(card!.fallback).toBe(t.fallback)
    }
  })

  it('renders term-pass headline prices as an upfront "for N months" label (not "every N mo")', () => {
    // The subscribe page must NOT show "every 3 mo" style cadence — beta spec locks it
    // to the upfront lump-sum framing regardless of the auto-renew toggle state.
    const cadenceLine = /const\s+cadence\s*=\s*([^;]+);/.exec(SOURCE)
    expect(cadenceLine, 'TermPassCard cadence declaration not found').not.toBeNull()
    const rhs = cadenceLine![1]!
    expect(rhs).toMatch(/`for \$\{termMonths\} months`/)
    expect(rhs).not.toMatch(/every\s+\$\{termMonths\}\s*mo/)
  })

  it('wires the Lifetime block to the correct PriceId and fallback', () => {
    const escaped = LIFETIME.fallback.replace(/[$]/g, '\\$')
    expect(SOURCE).toMatch(new RegExp(`onBuy\\("${LIFETIME.priceId}"\\)`))
    expect(SOURCE).toMatch(
      new RegExp(`priceLabel\\(prices,\\s*"${LIFETIME.priceId}",\\s*"${escaped}"\\)`),
    )
  })

  it('does not call onBuy() with any unknown PriceId, and every declared plan is used', () => {
    const used = new Set<string>([
      ...Array.from(SOURCE.matchAll(/onBuy\("([^"]+)"\)/g)).map((m) => m[1]!),
      // TermPassCard receives its PriceId as a prop and calls onBuy from inside the component.
      ...Array.from(SOURCE.matchAll(/priceId="([^"]+)"/g)).map((m) => m[1]!),
    ])
    // Panty PriceIds are passed through p.key, not a literal — check separately.
    const pantyUsed = /onBuy\(p\.key\)/.test(SOURCE)
    for (const id of used) {
      expect(ALL_KNOWN.has(id), `unexpected PriceId used: ${id}`).toBe(true)
    }
    for (const id of ALL_KNOWN) {
      if (id.startsWith('panty_')) {
        expect(pantyUsed, `panty PriceId "${id}" must be reachable via p.key`).toBe(true)
      } else {
        expect(used.has(id), `PriceId "${id}" is declared but never used`).toBe(true)
      }
    }
  })

  it('keeps the PriceId union in sync with the plans actually wired up', () => {
    const unionMatch = /type PriceId =([\s\S]*?);/.exec(SOURCE)
    expect(unionMatch, 'PriceId union not found').not.toBeNull()
    const declared = new Set<string>(
      Array.from(unionMatch![1]!.matchAll(/"([^"]+)"/g)).map((m) => m[1]!),
    )
    expect([...declared].sort()).toEqual([...ALL_KNOWN].sort())
  })
})
