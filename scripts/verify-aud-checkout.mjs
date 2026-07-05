#!/usr/bin/env node
// scripts/verify-aud-checkout.mjs
//
// AUD checkout verification — runs in CI, fails loudly on drift between the
// subscribe page and the expected Stripe wiring.
//
// Two checks, both static (no network required — safe to run in every CI run):
//
//   1. Every AUD PriceId visible on `src/routes/store.subscribe.tsx` matches
//      the canonical list below.
//   2. `src/lib/store.functions.ts` — the server function that builds the
//      Stripe Checkout Session — templates `return_url` and sets the right
//      metadata keys for each plan (userId, membership, term_months).
//
// When run against the Stripe sandbox (STRIPE_SANDBOX_API_KEY +
// LOVABLE_API_KEY present), it additionally hits Stripe via the connector
// gateway and asserts each PriceId resolves to an actual Stripe price. This
// is skipped locally (missing creds) but MUST pass in CI when the sandbox
// secrets are wired up as GitHub Actions secrets.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(process.cwd())
const SUBSCRIBE = readFileSync(resolve(ROOT, 'src/routes/store.subscribe.tsx'), 'utf8')
const STORE_FUNCTIONS = readFileSync(resolve(ROOT, 'src/lib/store.functions.ts'), 'utf8')

// Canonical AUD PriceIds — the source of truth for this verifier. Any drift
// from these in the source code is a CI failure.
const EXPECTED_AUD_PRICE_IDS = new Set([
  'all_access_monthly_aud',
  'all_access_3mo_onetime_aud',
  'all_access_6mo_onetime_aud',
  'all_access_12mo_onetime_aud',
  'lifetime_onetime_aud',
  'panty_24hr_aud',
  'panty_48hr_aud',
  'panty_72hr_aud',
])

const failures = []
function fail(msg) {
  failures.push(msg)
}
function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

// ---- 1. PriceId parity between subscribe page and canonical list -----------

console.log('\n[1/3] Verifying AUD PriceIds in src/routes/store.subscribe.tsx')

const usedPriceIds = new Set(
  [...SUBSCRIBE.matchAll(/buy\("([^"]+)"\)/g)].map((m) => m[1]),
)

for (const priceId of usedPriceIds) {
  if (!EXPECTED_AUD_PRICE_IDS.has(priceId)) {
    fail(`store.subscribe.tsx uses unknown PriceId "${priceId}" — update the canonical list or fix the page`)
  } else {
    ok(`PriceId "${priceId}" is on the canonical list`)
  }
}
for (const priceId of EXPECTED_AUD_PRICE_IDS) {
  if (!usedPriceIds.has(priceId)) {
    fail(`Canonical PriceId "${priceId}" is not wired up on store.subscribe.tsx`)
  }
}

// ---- 2. return_url + metadata wiring in store.functions.ts -----------------

console.log('\n[2/3] Verifying return_url templating and metadata in src/lib/store.functions.ts')

// return_url must be passed through from the client-supplied returnUrl and
// NOT contain a hardcoded checkout.stripe.com or literal `{CHECKOUT_SESSION_ID}`
// substitution — the subscribe page controls the return URL.
if (!/return_url:\s*data\.returnUrl/.test(STORE_FUNCTIONS)) {
  fail('store.functions.ts should pass return_url through from `data.returnUrl` (client-controlled)')
} else {
  ok('return_url is passed through from data.returnUrl')
}

// The subscribe page's returnUrl for AUD checkouts must land on /library with
// a success flag — that's what unlocks the UI. Prevent silent regressions
// where the return URL is changed to something else on the subscribe page.
if (!/\/library\?checkout=success/.test(SUBSCRIBE)) {
  fail('store.subscribe.tsx must send buyers to /library?checkout=success on return')
} else {
  ok('subscribe page returns to /library?checkout=success')
}

// Metadata invariants for each plan family.
const metadataChecks = [
  {
    label: 'Term-pass sessions set membership=term_pass + term_months',
    ok:
      /membership:\s*["']term_pass["']/.test(STORE_FUNCTIONS) &&
      /term_months/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Lifetime sessions set membership=lifetime',
    ok: /membership:\s*["']lifetime["']/.test(STORE_FUNCTIONS),
  },
  {
    label: 'Every session forwards userId in metadata',
    ok: /metadata:\s*\{[^}]*userId/s.test(STORE_FUNCTIONS),
  },
  {
    label: 'Subscription mode forwards userId onto the subscription object',
    ok: /subscription_data:\s*\{\s*metadata:\s*\{\s*userId/s.test(STORE_FUNCTIONS),
  },
  {
    label: 'Embedded UI mode is used (never redirect checkout)',
    ok: /ui_mode:\s*["']embedded_page["']/.test(STORE_FUNCTIONS),
  },
]
for (const check of metadataChecks) {
  if (check.ok) ok(check.label)
  else fail(check.label)
}

// ---- 3. Optional Stripe sandbox price existence check ----------------------

console.log('\n[3/3] Verifying PriceIds exist in Stripe sandbox (requires creds)')

const stripeKey = process.env.STRIPE_SANDBOX_API_KEY
const lovableKey = process.env.LOVABLE_API_KEY

if (!stripeKey || !lovableKey) {
  console.log(
    '  ⚠ STRIPE_SANDBOX_API_KEY or LOVABLE_API_KEY not set — skipping live sandbox check.',
  )
  console.log('    In CI, wire these as GitHub Actions secrets to enable this step.')
} else {
  const gateway = 'https://connector-gateway.lovable.dev/stripe'
  for (const priceId of EXPECTED_AUD_PRICE_IDS) {
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
      fail(`Network error looking up "${priceId}" in Stripe sandbox: ${err?.message ?? err}`)
      continue
    }
    if (!res.ok) {
      fail(`Stripe sandbox lookup for "${priceId}" failed with HTTP ${res.status}`)
      continue
    }
    const body = await res.json()
    if (!Array.isArray(body.data) || body.data.length === 0) {
      fail(`Stripe sandbox has no price with lookup_key "${priceId}"`)
    } else {
      const price = body.data[0]
      const currency = String(price.currency ?? '').toLowerCase()
      if (currency !== 'aud') {
        fail(`Sandbox price "${priceId}" has currency ${currency} (expected aud)`)
      } else {
        ok(`Sandbox price "${priceId}" exists (currency=aud, id=${price.id})`)
      }
    }
  }
}

// ---- Report ----------------------------------------------------------------

console.log('')
if (failures.length) {
  console.error(`AUD checkout verification FAILED with ${failures.length} issue(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('AUD checkout verification passed ✓')
