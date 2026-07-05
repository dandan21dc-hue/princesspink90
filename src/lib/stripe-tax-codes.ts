/**
 * Central mapping of product categories → Stripe tax codes.
 *
 * These are applied to `price_data.product_data.tax_code` on inline
 * checkout sessions and should be set on catalogue products via the
 * Stripe Dashboard (Products → Edit → Tax code) so recurring / lookup
 * price flows are also classified.
 *
 * Reference: https://docs.stripe.com/tax/tax-codes
 */
export const TAX_CODES = {
  // SaaS / electronic services — All-Access subscription + term passes + lifetime
  saas: "txcd_10103001",
  // General digital goods — individual content items (photo sets, videos, bundles)
  digital_goods: "txcd_10000000",
  // Personal services — private-room bookings
  services: "txcd_20030000",
  // Tangible personal property — panty orders (not eligible for full compliance handling)
  physical_goods: "txcd_99999999",
} as const;

/**
 * True when the SKU is a digital product eligible for Stripe's full
 * compliance handling (`managed_payments: { enabled: true }`).
 *
 * Physical goods (panty orders) are excluded — Stripe will reject the
 * session. They use `automatic_tax: { enabled: true }` instead so tax is
 * still calculated and collected; the seller handles filing on those SKUs.
 */
export function isEligibleForManagedPayments(priceOrKind: string): boolean {
  if (/^panty_/.test(priceOrKind)) return false;
  return true;
}
