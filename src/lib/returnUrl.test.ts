import { describe, expect, it } from "vitest";
import { ensureSessionIdInReturnUrl } from "./store.functions";

// Regression tests for the Stripe `return_url` normalizer.
// The `{CHECKOUT_SESSION_ID}` placeholder MUST reach Stripe with literal
// braces so its server-side substitution replaces it with the real session
// id before redirecting the buyer back. Percent-encoding the braces (which
// is what `URLSearchParams` / `URL.searchParams.set` do) leaves the value
// literally equal to `{CHECKOUT_SESSION_ID}` on return.

describe("ensureSessionIdInReturnUrl", () => {
  it("appends session_id={CHECKOUT_SESSION_ID} when missing", () => {
    const out = ensureSessionIdInReturnUrl("https://app.example.com/checkout/return");
    expect(out).toBe("https://app.example.com/checkout/return?session_id={CHECKOUT_SESSION_ID}");
  });

  it("preserves existing query params and appends with & separator", () => {
    const out = ensureSessionIdInReturnUrl(
      "https://app.example.com/checkout/return?next=%2Flibrary",
    );
    expect(out).toBe(
      "https://app.example.com/checkout/return?next=%2Flibrary&session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("keeps literal { and } (never percent-encodes them)", () => {
    const out = ensureSessionIdInReturnUrl("https://app.example.com/return");
    expect(out).toContain("{CHECKOUT_SESSION_ID}");
    expect(out).not.toContain("%7B");
    expect(out).not.toContain("%7D");
  });

  it("is idempotent — a URL that already has the template is returned unchanged", () => {
    const already = "https://app.example.com/return?session_id={CHECKOUT_SESSION_ID}";
    expect(ensureSessionIdInReturnUrl(already)).toBe(already);
  });

  it("preserves the URL hash when appending", () => {
    const out = ensureSessionIdInReturnUrl("https://app.example.com/return?a=1#top");
    expect(out).toBe(
      "https://app.example.com/return?a=1&session_id={CHECKOUT_SESSION_ID}#top",
    );
  });

  it("rejects relative URLs (Stripe requires absolute return_url)", () => {
    expect(() => ensureSessionIdInReturnUrl("/checkout/return")).toThrow();
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => ensureSessionIdInReturnUrl("javascript:alert(1)")).toThrow();
  });
});
