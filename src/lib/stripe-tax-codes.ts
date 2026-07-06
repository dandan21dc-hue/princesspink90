/**
 * Central mapping of product categories → Stripe tax codes.
 *
 * These are applied to `price_data.product_data.tax_code` on inline
 * checkout sessions and should be set on catalogue products via the
 * one-off `scripts/sync-stripe-tax-codes.mjs` script (not on every
 * checkout — that hides API failures and adds latency).
 *
 * Reference: https://docs.stripe.com/tax/tax-codes
 */
export const TAX_CODES = {
  // SaaS / electronic services — All-Access subscription + term passes + lifetime
  saas: "txcd_10103001",
  // General digital goods — individual content items (photo sets, videos, bundles)
  digital_goods: "txcd_10000000",
  // Personal services — private-room bookings (services aren't eligible for
  // Stripe's full compliance handling, so these use automatic_tax instead)
  services: "txcd_20030000",
  // Tangible personal property — panty orders (not eligible for full compliance handling)
  physical_goods: "txcd_99999999",
} as const;

/**
 * True when the SKU is eligible for Stripe's full compliance handling
 * (`managed_payments: { enabled: true }`).
 *
 * Excluded:
 * - Panty orders (physical goods) — Stripe rejects them.
 * - Private-room bookings (services) — not in the eligible tax-code set for
 *   full compliance handling, so we fall back to automatic_tax which still
 *   calculates and collects tax.
 */
export function isEligibleForManagedPayments(priceOrKind: string): boolean {
  if (/^panty_/.test(priceOrKind)) return false;
  if (/^private_room_/.test(priceOrKind)) return false;
  return true;
}
