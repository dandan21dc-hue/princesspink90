import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression tests for the Stripe-free billing/admin surfaces.
//
// These pages must render without touching any Stripe-only concept:
//   - `account/billing` derives state from `useMyTiers` (memberships-only)
//     and shows an empty-state CTA when nothing is active.
//   - `admin/orders-status` reads from the stubbed reconciliation server fn
//     and never dereferences `last_webhook` unsafely (it is always null now).

const __dirname = dirname(fileURLToPath(import.meta.url))
const BILLING = readFileSync(
  resolve(__dirname, './account.billing.tsx'),
  'utf8',
)
const ORDERS = readFileSync(
  resolve(__dirname, './admin.orders-status.tsx'),
  'utf8',
)

describe('account/billing UI — memberships-only, empty-state safe', () => {
  it('does not import any Stripe/billing server functions', () => {
    expect(BILLING).not.toMatch(/from ['"]@\/lib\/billing\.functions['"]/)
    expect(BILLING).not.toMatch(/getBillingSummary|listMyInvoices|cancelSubscription|createBillingPortalSession/)
    expect(BILLING).not.toMatch(/from ['"]stripe['"]|from ['"]@stripe\//)
  })

  it('derives access from useMyTiers (memberships-only hook)', () => {
    expect(BILLING).toMatch(/from ['"]@\/hooks\/useMyTiers['"]/)
    expect(BILLING).toMatch(/useMyTiers\(\)/)
  })

  it('renders an empty state with a browse CTA when no tier is active', () => {
    // The empty-state component must exist and link to the store.
    expect(BILLING).toMatch(/No active passes yet/i)
    expect(BILLING).toMatch(/to=['"]\/store\/subscribe['"]/)
  })

  it('lists every known All-Access plan meta entry', () => {
    for (const plan of [
      'all_access_monthly_aud',
      'all_access_3mo_monthly_aud',
      'all_access_6mo_monthly_aud',
      'all_access_12mo_monthly_aud',
      'lifetime_onetime_aud',
    ]) {
      expect(BILLING).toContain(plan)
    }
  })
})

describe('admin/orders-status UI — stub-safe rendering', () => {
  it('calls the stubbed listAdminOrders server fn', () => {
    expect(ORDERS).toMatch(/from ['"]@\/lib\/admin-orders\.functions['"]/)
    expect(ORDERS).toMatch(/listAdminOrders/)
  })

  it('defaults counts to zero when the summary is missing (empty-state safe)', () => {
    expect(ORDERS).toMatch(
      /summary\s*\?\?\s*\{\s*total:\s*0,\s*granted:\s*0,\s*pending:\s*0,\s*revoked:\s*0\s*\}/,
    )
    expect(ORDERS).toMatch(/query\.data\?\.rows\s*\?\?\s*\[\s*\]/)
  })

  it('still offers the subscription kind filter (renders zero rows via the stub)', () => {
    expect(ORDERS).toMatch(/subscription:\s*['"]Subscription['"]/)
  })

  it('does not import the Stripe SDK', () => {
    expect(ORDERS).not.toMatch(/from ['"]stripe['"]|from ['"]@stripe\//)
  })
})
