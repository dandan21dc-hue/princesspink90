import { describe, it, expect } from "vitest";
import { parseCheckoutInput } from "./nowpayments.functions";

const OK_BASE = {
  environment: "sandbox" as const,
  returnOrigin: "https://example.com",
};
const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("parseCheckoutInput — pantyListingId validation error mapping", () => {
  it("accepts a well-formed UUID pantyListingId and returns the parsed payload", () => {
    const parsed = parseCheckoutInput({
      ...OK_BASE,
      pantyListingId: VALID_UUID,
    });
    expect(parsed.pantyListingId).toBe(VALID_UUID);
  });

  it("rejects a legacy Stripe lookup key with a message that names the field, explains the UUID contract, and echoes the received value", () => {
    let caught: unknown;
    try {
      parseCheckoutInput({ ...OK_BASE, pantyListingId: "panty_24hr_aud" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;

    // Prefix + field name so the client can route the toast.
    expect(msg).toMatch(/^Invalid checkout request:/);
    expect(msg).toContain("pantyListingId");

    // Explains the UUID contract and calls out the legacy-key remediation.
    expect(msg).toMatch(/panty_listings\.id UUID/);
    expect(msg).toMatch(/8-4-4-4-12 hex/);
    expect(msg).toMatch(/legacy stripe lookup keys/i);
    expect(msg).toMatch(/remove the item from your cart/i);

    // Echoes the actual received value + length so the shopper knows which
    // cart line failed without leaking anything else about the request.
    expect(msg).toContain('received "panty_24hr_aud"');
    expect(msg).toContain("(14 chars)");
  });

  it("redacts control chars and truncates over-long ids in the echoed value", () => {
    const nasty = "\u0000\u0007bad-id-".padEnd(200, "x");
    let caught: unknown;
    try {
      parseCheckoutInput({ ...OK_BASE, pantyListingId: nasty });
    } catch (e) {
      caught = e;
    }
    const msg = (caught as Error).message;
    // Control chars stripped, value truncated to 64 chars + ellipsis, real
    // length preserved for debugging.
    expect(msg).not.toContain("\u0000");
    expect(msg).not.toContain("\u0007");
    expect(msg).toMatch(/received "bad-id-x+…"/);
    expect(msg).toContain(`(${nasty.length} chars)`);
  });

  it("reports a non-string pantyListingId as a type error rather than exposing the raw value", () => {
    let caught: unknown;
    try {
      parseCheckoutInput({ ...OK_BASE, pantyListingId: 12345 });
    } catch (e) {
      caught = e;
    }
    const msg = (caught as Error).message;
    expect(msg).toContain("pantyListingId");
    expect(msg).toContain("received number");
    // Guard: don't echo the raw numeric value back into the error surface.
    expect(msg).not.toMatch(/12345/);
  });

  it("keeps the mutually-exclusive refine message unchanged (no id-echo diagnostic)", () => {
    let caught: unknown;
    try {
      parseCheckoutInput({
        ...OK_BASE,
        pantyListingId: VALID_UUID,
        contentItemId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      });
    } catch (e) {
      caught = e;
    }
    const msg = (caught as Error).message;
    expect(msg).toMatch(/pass at most one of priceid, pantylistingid/i);
    expect(msg).not.toMatch(/received "/);
  });
});
