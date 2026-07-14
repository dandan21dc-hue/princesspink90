/**
 * Compatibility shim after Stripe removal. Tax handling now happens through
 * NOWPayments / manual invoicing; these constants remain so legacy imports
 * in the checkout server functions still resolve.
 */
export const TAX_CODES = {
  physical_goods: "txcd_99999999",
  digital_goods: "txcd_10000000",
} as const;

export function isEligibleForManagedPayments(_lookupKey: string): boolean {
  return false;
}
