import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression tests for the Stripe-free billing stubs in `src/lib/billing.functions.ts`.
//
// Stripe has been removed and NOWPayments does not implement subscriptions,
// saved cards, hosted invoices, or a billing portal. The exports remain so
// callers keep compiling; every handler must degrade gracefully:
//   - `getBillingSummary` returns an empty summary (no error)
//   - `listMyInvoices` returns an empty array (no error)
//   - Every mutating endpoint returns a friendly `{ error }` object
//   - Nothing imports the Stripe SDK
//
// We inspect the source text instead of invoking the RPCs because
// `createServerFn` wraps handlers in TanStack's RPC transport, which cannot
// run in a unit-test process.

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(resolve(__dirname, './billing.functions.ts'), 'utf8')

function handlerBody(fnName: string): string {
  const start = SOURCE.indexOf(`export const ${fnName} = createServerFn`)
  expect(start, `export ${fnName} present`).toBeGreaterThanOrEqual(0)
  const end = SOURCE.indexOf('export const ', start + 1)
  return end === -1 ? SOURCE.slice(start) : SOURCE.slice(start, end)
}

describe('billing stubs — Stripe-free defaults', () => {
  it('does not import the Stripe SDK or the Stripe browser client', () => {
    expect(SOURCE).not.toMatch(/from ['"]stripe['"]/)
    expect(SOURCE).not.toMatch(/from ['"]@stripe\//)
  })

  it('getBillingSummary returns an empty, no-billing shape', () => {
    const body = handlerBody('getBillingSummary')
    expect(body).toMatch(
      /return\s*\{\s*subscription:\s*null,\s*defaultPaymentMethod:\s*null,\s*hasCustomer:\s*false\s*\}/,
    )
    expect(body).not.toMatch(/\berror\b\s*:/)
  })

  it('listMyInvoices returns an empty array', () => {
    const body = handlerBody('listMyInvoices')
    expect(body).toMatch(/return\s*\[\s*\]\s*;?/)
  })

  it.each([
    'cancelSubscription',
    'resumeSubscription',
    'createSetupSession',
    'finaliseSetupSession',
    'createBillingPortalSession',
  ])('%s returns a friendly { error } payload', (fn) => {
    const body = handlerBody(fn)
    expect(body).toMatch(/return\s*\{\s*error:\s*[A-Z_a-z'"`][^}]*\}/)
    expect(body).not.toMatch(/throw new Error/)
  })

  it('all exports use requireSupabaseAuth middleware', () => {
    const exports = SOURCE.match(/export const \w+ = createServerFn/g) ?? []
    expect(exports.length).toBeGreaterThanOrEqual(6)
    for (const ex of exports) {
      const fn = ex.replace(/^export const (\w+).*/, '$1')
      expect(handlerBody(fn)).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/)
    }
  })
})
