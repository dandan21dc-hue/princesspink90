#!/usr/bin/env node
// scripts/verify-multi-currency-checkout.mjs
//
// Multi-currency checkout verification — runs in CI, fails on drift between
// the checkout code and the expected Stripe wiring across every supported
// currency.
//
// Currencies covered:
//   AUD — full public plan set (monthly, 3/6/12mo passes, lifetime, panty)
//   USD — parallel core plans (monthly, 3/6/12mo passes, lifetime)
//
// Three checks:
//   1. Every AUD PriceId visible on `src/routes/store.subscribe.tsx` matches
//      the canonical AUD list.
//   2. `src/lib/store.functions.ts` templates `return_url` and sets the right
//      metadata for both currencies' plan families (subscription vs. term
//      vs. lifetime), and routes USD lookup keys via the same code paths as
//      AUD (no _aud suffix required for USD).
//   3. When STRIPE_SANDBOX_API_KEY + LOVABLE_API_KEY are set, every AUD and
//      USD PriceId resolves against Stripe sandbox in the expected currency.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(process.cwd())
const SUBSCRIBE = readFileSync(resolve(ROOT, 'src/routes/store.subscribe.tsx'), 'utf8')
const STORE_FUNCTIONS = readFileSync(resolve(ROOT, 'src/lib/store.functions.ts'), 'utf8')

// Canonical per-currency PriceId lists. Any drift from these in the source
// code — or missing prices in Stripe sandbox — is a CI failure.
const EXPECTED = {
  aud: new Set([
    'all_access_monthly_aud',
    'all_access_3mo_monthly_aud',
    'all_access_6mo_monthly_aud',
    'all_access_12mo_monthly_aud',
    'lifetime_onetime_aud',
    'panty_24hr_aud',
    'panty_48hr_aud',
    'panty_72hr_aud',
  ]),
  // USD core plans — subscription page currently only wires AUD, but the
  // checkout function accepts these lookup_keys (verified by
  // usdCheckoutFlow.test.ts) and they must remain provisioned in Stripe
  // sandbox for API-driven / A-B / geo-priced flows.
  usd: new Set([
    'all_access_monthly',
    'all_access_3mo_onetime',
    'all_access_6mo_onetime',
    'all_access_12mo_onetime',
    'lifetime_onetime',
  ]),
}

const failures = []
const fail = (msg) => failures.push(msg)
const ok = (msg) => console.log(`  ✓ ${msg}`)

// ---- 1. AUD PriceId parity with subscribe page ----------------------------

console.log('\n[1/3] Verifying AUD PriceIds in src/routes/store.subscribe.tsx')

const usedPriceIds = new Set(
  [...SUBSCRIBE.matchAll(/buy\("([^"]+)"\)/g)].map((m) => m[1]),
)
for (const priceId of usedPriceIds) {
  if (!EXPECTED.aud.has(priceId)) {
    fail(`store.subscribe.tsx uses unknown PriceId "${priceId}"`)
  } else {
    ok(`PriceId "${priceId}" is on the canonical AUD list`)
  }
}
for (const priceId of EXPECTED.aud) {
  if (!usedPriceIds.has(priceId)) fail(`Canonical AUD PriceId "${priceId}" not wired up`)
}

// ---- 2. store.functions.ts wiring (both currencies) -----------------------

console.log('\n[2/3] Verifying return_url + metadata wiring for both currencies')

const staticChecks = [
  {
    label: 'return_url passed through from data.returnUrl',
    ok: /return_url:\s*data\.returnUrl/.test(STORE_FUNCTIONS),
  },
  {
    label: 'subscribe page returns to /library?checkout=success',
    ok: /\/library\?checkout=success/.test(SUBSCRIBE),
  },
  {
    label: 'Embedded UI mode (never redirect checkout)',
    ok: /ui_mode:\s*["']embedded_page["']/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Lifetime detection accepts both USD and AUD (lifetime_onetime + lifetime_onetime_aud)',
    ok:
      /["']lifetime_onetime_aud["']/.test(STORE_FUNCTIONS) &&
      /["']lifetime_onetime["']/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Term-pass regex accepts BOTH currencies (optional _aud suffix)',
    // Matches something like /^all_access_(3|6|12)mo_onetime(?:_aud)?$/
    ok: /all_access_.*mo_onetime\(\?:_aud\)\?/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Every session forwards userId in metadata',
    ok: /metadata:\s*\{[^}]*userId/s.test(STORE_FUNCTIONS),
  },
  {
    label: 'Subscription mode forwards userId onto the subscription',
    ok: /subscription_data:\s*\{\s*metadata:\s*\{\s*userId/s.test(STORE_FUNCTIONS),
  },
  {
    label: 'Lifetime sessions set membership=lifetime',
    ok: /membership:\s*["']lifetime["']/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Term-pass sessions set membership=term_pass + term_months',
    ok:
      /membership:\s*["']term_pass["']/.test(STORE_FUNCTIONS) &&
      /term_months/.test(STORE_FUNCTIONS),
  },
]
for (const c of staticChecks) (c.ok ? ok : fail)(c.label)

// ---- 3. Live Stripe sandbox verification (per currency) -------------------

console.log('\n[3/3] Verifying PriceIds in Stripe sandbox (requires creds)')

const stripeKey = process.env.STRIPE_SANDBOX_API_KEY
const lovableKey = process.env.LOVABLE_API_KEY
const requireLive = process.env.REQUIRE_LIVE_STRIPE_CHECK === '1'

if (!stripeKey || !lovableKey) {
  const msg = 'STRIPE_SANDBOX_API_KEY / LOVABLE_API_KEY not set — skipping live sandbox check'
  if (requireLive) {
    fail(msg + ' (REQUIRE_LIVE_STRIPE_CHECK=1)')
  } else {
    console.log(`  ⚠ ${msg}`)
    console.log('    In CI, wire these as GitHub Actions secrets to enable this step.')
  }
} else {
  const gateway = 'https://connector-gateway.lovable.dev/stripe'
  for (const [currency, priceIds] of Object.entries(EXPECTED)) {
    for (const priceId of priceIds) {
      const url = `${gateway}/v1/prices/search?query=${encodeURIComponent(
        `lookup_key:'${priceId}'`,
      )}`
      let res
      try {
        res = await fetch(url, {
          headers: {
            'X-Connection-Api-Key': stripeKey,
            'Lovable-API-Key': lovableKey,
          },
        })
      } catch (err) {
        fail(`Network error looking up "${priceId}": ${err?.message ?? err}`)
        continue
      }
      if (!res.ok) {
        fail(`Sandbox lookup for "${priceId}" failed with HTTP ${res.status}`)
        continue
      }
      const body = await res.json()
      if (!Array.isArray(body.data) || body.data.length === 0) {
        fail(`Stripe sandbox has no price with lookup_key "${priceId}" (expected ${currency})`)
        continue
      }
      const price = body.data[0]
      const actualCurrency = String(price.currency ?? '').toLowerCase()
      if (actualCurrency !== currency) {
        fail(
          `Sandbox price "${priceId}" has currency ${actualCurrency} (expected ${currency})`,
        )
      } else {
        ok(`Sandbox price "${priceId}" exists (currency=${currency}, id=${price.id})`)
      }
    }
  }
}

// ---- Report ----------------------------------------------------------------

console.log('')
if (failures.length) {
  console.error(`Multi-currency checkout verification FAILED with ${failures.length} issue(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('Multi-currency checkout verification passed ✓')
