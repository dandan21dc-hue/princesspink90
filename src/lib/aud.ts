/**
 * AUD-only safety helpers.
 *
 * Every price rendered into JSON-LD or user-facing markup on critical pages
 * MUST go through these helpers so upstream inconsistency (wrong currency
 * field, string amounts, negative numbers, NaN, missing values) can never
 * leak a non-AUD price into the page.
 */

export const AUD_CURRENCY = "AUD" as const;
export const AUD_SYMBOL = "A$" as const;

/**
 * Coerce any upstream currency value to "AUD". Non-AUD inputs are logged
 * (in dev) and silently rewritten — the site is AUD-only by policy.
 */
export function forceAudCurrency(input?: string | null): "AUD" {
  if (input && input.toUpperCase() !== AUD_CURRENCY && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[aud] Non-AUD currency "${input}" coerced to AUD.`);
  }
  return AUD_CURRENCY;
}

/**
 * Normalise any price-cents value to a non-negative integer number of cents.
 * Returns null for missing / invalid input so callers can omit the offer.
 */
export function normalizePriceCents(input: unknown): number | null {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Format cents as a plain decimal string for schema.org `price`
 * (e.g. `19.95`). Always AUD.
 */
export function formatAudPrice(cents: unknown): string | null {
  const c = normalizePriceCents(cents);
  if (c === null) return null;
  return (c / 100).toFixed(2);
}

/** Format cents as user-facing AUD text (e.g. `A$19.95`). */
export function formatAudDisplay(cents: unknown): string | null {
  const price = formatAudPrice(cents);
  return price === null ? null : `${AUD_SYMBOL}${price}`;
}

/**
 * Build a schema.org Offer object with AUD hard-coded. Returns null when
 * the price is missing/invalid so the caller can omit `offers` entirely.
 */
export function buildAudOffer(args: {
  cents: unknown;
  url?: string;
  availability?: string;
  currency?: string | null; // ignored — always AUD
}): {
  "@type": "Offer";
  price: string;
  priceCurrency: "AUD";
  availability: string;
  url?: string;
} | null {
  const price = formatAudPrice(args.cents);
  if (price === null) return null;
  // Touch the currency arg so lint doesn't complain and so callers stay honest.
  forceAudCurrency(args.currency ?? undefined);
  return {
    "@type": "Offer",
    price,
    priceCurrency: AUD_CURRENCY,
    availability: args.availability ?? "https://schema.org/InStock",
    ...(args.url ? { url: args.url } : {}),
  };
}
