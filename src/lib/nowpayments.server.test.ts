import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { stableStringify, verifyNowPaymentsSignature } from "./nowpayments.server";

const SECRET = "test-ipn-secret";

function sign(body: unknown): { raw: string; sig: string } {
  const raw = JSON.stringify(body);
  const canonical = stableStringify(JSON.parse(raw));
  const sig = createHmac("sha512", SECRET).update(canonical).digest("hex");
  return { raw, sig };
}

describe("verifyNowPaymentsSignature", () => {
  const validPayload = {
    payment_id: 12345,
    payment_status: "finished",
    order_id: "aap30d:11111111-1111-1111-1111-111111111111:sandbox:1000",
    price_amount: 10,
    price_currency: "aud",
  };

  it("accepts a valid signature", () => {
    const { raw, sig } = sign(validPayload);
    expect(verifyNowPaymentsSignature(raw, sig, SECRET)).toBe(true);
  });

  it("accepts a signature computed over key-reordered JSON (canonicalization)", () => {
    const { sig } = sign(validPayload);
    // Same fields, different key order — canonical form should match.
    const reordered = JSON.stringify({
      price_currency: validPayload.price_currency,
      order_id: validPayload.order_id,
      price_amount: validPayload.price_amount,
      payment_status: validPayload.payment_status,
      payment_id: validPayload.payment_id,
    });
    expect(verifyNowPaymentsSignature(reordered, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const { raw, sig } = sign(validPayload);
    const tampered = raw.replace('"finished"', '"waiting"');
    expect(verifyNowPaymentsSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("rejects when signature is missing", () => {
    const { raw } = sign(validPayload);
    expect(verifyNowPaymentsSignature(raw, null, SECRET)).toBe(false);
  });

  it("rejects when secret is wrong", () => {
    const { raw, sig } = sign(validPayload);
    expect(verifyNowPaymentsSignature(raw, sig, "other-secret")).toBe(false);
  });

  it("rejects a malformed JSON body", () => {
    expect(verifyNowPaymentsSignature("{not json", "deadbeef", SECRET)).toBe(false);
  });
});
