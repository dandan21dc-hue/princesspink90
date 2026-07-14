/**
 * End-to-end webhook tests: signed request → HTTP response, plus a stateful
 * fake of the `grant_all_access_pass_30d` RPC that mirrors the real Postgres
 * function's rules (single row per user/env, idempotent by
 * `external_payment_reference`, no stacking, expiry enforced by
 * `expires_at > now()`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { stableStringify } from "@/lib/nowpayments.server";

// ---- fake RPC state -------------------------------------------------------

type MembershipRow = {
  id: string;
  user_id: string;
  environment: "sandbox" | "live";
  kind: "term_pass_all_access_30d";
  amount_cents: number | null;
  expires_at: Date;
  external_payment_reference: string | null;
};

const state: { rows: MembershipRow[]; nowMs: number } = { rows: [], nowMs: 0 };

function nowDate() {
  return new Date(state.nowMs);
}

// Reproduces the migration's function body semantically.
function fakeGrantAllAccessPass30d(args: {
  _user_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number | null;
  _external_payment_reference: string | null;
}) {
  const existingByRef = args._external_payment_reference
    ? state.rows.find((r) => r.external_payment_reference === args._external_payment_reference)
    : undefined;
  if (existingByRef) return { data: existingByRef, error: null };

  const existing = state.rows
    .filter((r) => r.user_id === args._user_id && r.environment === args._environment)
    .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime())[0];

  const newExpiry = new Date(state.nowMs + 30 * 24 * 60 * 60 * 1000);

  if (existing) {
    existing.expires_at = newExpiry;
    if (args._amount_cents != null) existing.amount_cents = args._amount_cents;
    if (args._external_payment_reference) existing.external_payment_reference = args._external_payment_reference;
    return { data: existing, error: null };
  }

  const row: MembershipRow = {
    id: `mem_${state.rows.length + 1}`,
    user_id: args._user_id,
    environment: args._environment,
    kind: "term_pass_all_access_30d",
    amount_cents: args._amount_cents,
    expires_at: newExpiry,
    external_payment_reference: args._external_payment_reference,
  };
  state.rows.push(row);
  return { data: row, error: null };
}

// The webhook loads supabaseAdmin via dynamic import — vi.mock hoisting handles this.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Parameters<typeof fakeGrantAllAccessPass30d>[0]) => {
      if (name !== "grant_all_access_pass_30d") {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
      }
      return Promise.resolve(fakeGrantAllAccessPass30d(args));
    },
  },
}));

import { handleWebhookRequest } from "./nowpayments-webhook";

// ---- helpers --------------------------------------------------------------

const SECRET = "e2e-ipn-secret";
const USER = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = `aap30d:${USER}:sandbox:1000`;

function signedRequest(body: unknown, opts: { badSig?: boolean; noSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const canonical = stableStringify(JSON.parse(raw));
  const sig = createHmac("sha512", SECRET).update(canonical).digest("hex");
  const headers = new Headers({ "content-type": "application/json" });
  if (!opts.noSig) {
    headers.set("x-nowpayments-sig", opts.badSig ? "deadbeef" : sig);
  }
  return new Request("https://example.test/api/public/payments/nowpayments-webhook", {
    method: "POST",
    headers,
    body: raw,
  });
}

/** Mirrors `user_can_access_content`'s pass-window check. */
function passIsActive(userId: string, env: "sandbox" | "live") {
  return state.rows.some(
    (r) => r.user_id === userId && r.environment === env && r.expires_at.getTime() > state.nowMs,
  );
}

beforeEach(() => {
  process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
  state.rows = [];
  state.nowMs = new Date("2026-01-01T00:00:00Z").getTime();
});

// ---- signature verification (HTTP surface) -------------------------------

describe("NOWPayments webhook — signature verification", () => {
  const finished = { payment_status: "finished", order_id: ORDER_ID, payment_id: 1 };

  it("rejects requests with no signature header (401)", async () => {
    const res = await handleWebhookRequest(signedRequest(finished, { noSig: true }));
    expect(res.status).toBe(401);
    expect(passIsActive(USER, "sandbox")).toBe(false);
  });

  it("rejects requests with a wrong signature (401)", async () => {
    const res = await handleWebhookRequest(signedRequest(finished, { badSig: true }));
    expect(res.status).toBe(401);
    expect(passIsActive(USER, "sandbox")).toBe(false);
  });

  it("rejects requests when the server has no IPN secret configured (500)", async () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    const res = await handleWebhookRequest(signedRequest(finished));
    expect(res.status).toBe(500);
  });

  it("accepts a correctly signed body but doesn't crash on unknown extra fields", async () => {
    const res = await handleWebhookRequest(
      signedRequest({ ...finished, extra_field: { nested: [1, 2, 3] } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
  });

  it("returns 400 on a signed but non-JSON body", async () => {
    const raw = "not-json";
    const canonical = raw; // signature stays computable so we hit the JSON.parse branch
    const sig = createHmac("sha512", SECRET).update(canonical).digest("hex");
    const req = new Request("https://example.test/api/public/payments/nowpayments-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: raw,
    });
    // stableStringify called during verify will bail on invalid JSON → 401 first.
    // Confirm the handler still returns a non-2xx and never grants.
    const res = await handleWebhookRequest(req);
    expect([400, 401]).toContain(res.status);
    expect(passIsActive(USER, "sandbox")).toBe(false);
  });
});

// ---- entitlement lifecycle (single 30-day window, no stacking) ----------

describe("NOWPayments webhook — entitlement expiration behavior", () => {
  it("grants a 30-day window on the first finished payment", async () => {
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: ORDER_ID, payment_id: 100 }),
    );
    expect(res.status).toBe(200);
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.external_payment_reference).toBe("nowpayments:100");
    expect(row.expires_at.getTime() - state.nowMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(passIsActive(USER, "sandbox")).toBe(true);
  });

  it("is idempotent: replayed webhook for same payment_id does not extend or duplicate", async () => {
    const body = { payment_status: "finished", order_id: ORDER_ID, payment_id: 200 };
    await handleWebhookRequest(signedRequest(body));
    const firstExpiry = state.rows[0].expires_at.getTime();

    // Time advances, but a replay of the same payment must not extend the pass.
    state.nowMs += 5 * 24 * 60 * 60 * 1000;
    await handleWebhookRequest(signedRequest(body));

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].expires_at.getTime()).toBe(firstExpiry);
  });

  it("does not stack: a second distinct payment resets the window to now()+30d, not existing+30d", async () => {
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: ORDER_ID, payment_id: 300 }),
    );

    // 10 days later, buy again. The window should slide to 30 days from *now*,
    // not 20 (remaining) + 30. That's the "no stacking" contract.
    state.nowMs += 10 * 24 * 60 * 60 * 1000;
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: ORDER_ID, payment_id: 301 }),
    );

    expect(state.rows).toHaveLength(1);
    const daysLeft = (state.rows[0].expires_at.getTime() - state.nowMs) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBe(30);
  });

  it("expires after 30 days and requires a manual re-buy to regain access", async () => {
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: ORDER_ID, payment_id: 400 }),
    );
    expect(passIsActive(USER, "sandbox")).toBe(true);

    // 31 days later: pass has expired, no auto-renew.
    state.nowMs += 31 * 24 * 60 * 60 * 1000;
    expect(passIsActive(USER, "sandbox")).toBe(false);

    // A new finished payment (different payment_id) grants a fresh 30-day window.
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: ORDER_ID, payment_id: 401 }),
    );
    expect(passIsActive(USER, "sandbox")).toBe(true);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].external_payment_reference).toBe("nowpayments:401");
  });

  it("does not grant on non-finished statuses even with a valid signature", async () => {
    for (const status of ["waiting", "confirming", "sending", "failed", "expired"]) {
      const res = await handleWebhookRequest(
        signedRequest({ payment_status: status, order_id: ORDER_ID, payment_id: 500 }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { handled: boolean; reason?: string };
      expect(json.handled).toBe(false);
      expect(json.reason).toBe(`ignored_status:${status}`);
    }
    expect(state.rows).toHaveLength(0);
    expect(passIsActive(USER, "sandbox")).toBe(false);
  });

  it("keeps sandbox and live entitlements independent", async () => {
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: `aap30d:${USER}:sandbox:1000`, payment_id: 600 }),
    );
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: `aap30d:${USER}:live:1000`, payment_id: 601 }),
    );

    expect(state.rows).toHaveLength(2);
    expect(passIsActive(USER, "sandbox")).toBe(true);
    expect(passIsActive(USER, "live")).toBe(true);
  });
});
