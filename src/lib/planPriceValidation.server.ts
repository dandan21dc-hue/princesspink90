import type Stripe from "stripe";

/**
 * Expected shape of each selectable plan price in Stripe. Used to detect
 * catalogue drift (missing price, wrong billing interval, wrong amount)
 * at checkout time so mispriced/mis-recurring plans are caught loudly
 * instead of silently charging the wrong thing.
 */
export interface ExpectedPlanPrice {
  currency: string;
  unit_amount: number; // in minor units (cents)
  interval: "day" | "week" | "month" | "year" | null; // null = one-time
}

export const EXPECTED_PLAN_PRICES: Record<string, ExpectedPlanPrice> = {
  all_access_monthly_aud:      { currency: "aud", unit_amount:  1000, interval: "month" },
  // Term passes: single upfront lump-sum charge for the full term
  // (3mo=A$27, 6mo=A$48, 12mo=A$84). One-time payment, no renewal.
  all_access_3mo_monthly_aud:  { currency: "aud", unit_amount:  2700, interval: null    },
  all_access_6mo_monthly_aud:  { currency: "aud", unit_amount:  4800, interval: null    },
  all_access_12mo_monthly_aud: { currency: "aud", unit_amount:  8400, interval: null    },
  lifetime_onetime_aud:        { currency: "aud", unit_amount: 50000, interval: null    },
};

export type PlanPriceIssue =
  | { kind: "missing"; lookupKey: string }
  | {
      kind: "mismatch";
      lookupKey: string;
      expected: ExpectedPlanPrice;
      actual: { currency: string; unit_amount: number | null; interval: string | null };
      fields: Array<"currency" | "unit_amount" | "interval">;
    };

/**
 * Validates a Stripe price against the expected catalogue entry (if any).
 * Returns null for prices we don't track. Emits a structured console
 * event on any discrepancy so it shows up in server function logs.
 */
export function validatePlanPrice(
  lookupKey: string,
  stripePrice: Stripe.Price | null | undefined,
): PlanPriceIssue | null {
  const expected = EXPECTED_PLAN_PRICES[lookupKey];
  if (!expected) return null;

  if (!stripePrice) {
    const issue: PlanPriceIssue = { kind: "missing", lookupKey };
    console.error("[plan-price-validation] missing", issue);
    return issue;
  }

  const actual = {
    currency: (stripePrice.currency ?? "").toLowerCase(),
    unit_amount: stripePrice.unit_amount ?? null,
    interval: stripePrice.recurring?.interval ?? null,
  };

  const fields: Array<"currency" | "unit_amount" | "interval"> = [];
  if (actual.currency !== expected.currency) fields.push("currency");
  if (actual.unit_amount !== expected.unit_amount) fields.push("unit_amount");
  if (actual.interval !== expected.interval) fields.push("interval");

  if (fields.length === 0) return null;

  const issue: PlanPriceIssue = { kind: "mismatch", lookupKey, expected, actual, fields };
  console.error("[plan-price-validation] mismatch", issue);
  return issue;
}
