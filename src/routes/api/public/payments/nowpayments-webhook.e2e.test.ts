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
vi.mock("@/integrations/supabase/client.server", () => {
  type Row = { handled: boolean; reason: string | null; received_count: number };
  const ledger = new Map<string, Row>();
  const keyOf = (pid: string, status: string) => `${pid}|${status}`;
  const from = (table: string) => {
    if (table !== "nowpayments_ipn_events") throw new Error(`unexpected table: ${table}`);
    return {
      insert(row: { payment_id: string; last_status: string }) {
        const k = keyOf(row.payment_id, row.last_status);
        return {
          select: (_c?: string) => ({
            maybeSingle: () => {
              if (ledger.has(k)) return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } });
              ledger.set(k, { handled: false, reason: null, received_count: 1 });
              return Promise.resolve({ data: { payment_id: row.payment_id }, error: null });
            },
          }),
        };
      },
      select(_c?: string) {
        const f: Record<string, string> = {};
        const rd = {
          eq: (c: string, v: string) => { f[c] = v; return rd; },
          maybeSingle: () => Promise.resolve({
            data: ledger.get(keyOf(f.payment_id, f.last_status)) ?? null,
            error: null,
          }),
        };
        return rd;
      },
      update(patch: Record<string, unknown>) {
        const f: Record<string, string> = {};
        const upd = {
          eq: (c: string, v: string) => { f[c] = v; return upd; },
          then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
            const row = ledger.get(keyOf(f.payment_id, f.last_status));
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return upd;
      },
    };
  };
  return {
    supabaseAdmin: {
      rpc: (name: string, args: Parameters<typeof fakeGrantAllAccessPass30d>[0]) => {
        if (name !== "grant_all_access_pass_30d") {
          return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
        }
        return Promise.resolve(fakeGrantAllAccessPass30d(args));
      },
      from,
    },
  };
});

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

// ---- duplicate delivery across different order IDs ---------------------
//
// NOWPayments retries an IPN until it gets a 2xx (up to several days), and
// operators occasionally reissue an invoice with a rewritten order_id for
// the same on-chain payment. The webhook must be idempotent *by payment*,
// not by order — two `finished` deliveries for the same `payment_id` must
// grant exactly one entitlement, even when the second delivery advertises
// a different `order_id`.
describe("NOWPayments webhook — duplicate delivery across different order IDs", () => {
  const USER_A = "22222222-2222-2222-2222-222222222222";

  it("same payment_id delivered twice with different order IDs grants only once", async () => {
    const paymentId = 700;

    // First delivery: legitimate order for USER.
    const first = await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER}:sandbox:1000`,
        payment_id: paymentId,
      }),
    );
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { handled: boolean; reason?: string };
    expect(firstJson.handled).toBe(true);
    expect(firstJson.reason).toBeUndefined();
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].user_id).toBe(USER);
    expect(state.rows[0].external_payment_reference).toBe(`nowpayments:${paymentId}`);

    // Second delivery: same payment_id, different order_id pointing at a
    // different user. The ledger's (payment_id, status) key rejects it as
    // a duplicate before any RPC runs — no new membership, no cross-user
    // grant leakage.
    const second = await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER_A}:sandbox:1000`,
        payment_id: paymentId,
      }),
    );
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { handled: boolean; reason?: string };
    expect(secondJson.reason).toBe("duplicate_ipn");
    // Prior outcome was handled=true, so the replay reports handled=true too.
    expect(secondJson.handled).toBe(true);

    // Critically: still exactly one row, still owned by USER — the rewritten
    // order_id must not create an entitlement for USER_A.
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].user_id).toBe(USER);
    expect(passIsActive(USER_A, "sandbox")).toBe(false);
  });

  it("same payment_id delivered with two different amounts grants only the first", async () => {
    const paymentId = 701;

    // Real amount from the invoice we issued (1000 cents).
    await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER}:sandbox:1000`,
        payment_id: paymentId,
      }),
    );
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].amount_cents).toBe(1000);

    // Redelivery with a tampered amount in the order_id — must not overwrite
    // the row and must not create a second one.
    const replay = await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER}:sandbox:9999999`,
        payment_id: paymentId,
      }),
    );
    const replayJson = (await replay.json()) as { reason?: string };
    expect(replayJson.reason).toBe("duplicate_ipn");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].amount_cents).toBe(1000);
  });

  it("two distinct payment_ids for the same order_id grant per-payment but never stack", async () => {
    // Both invoices reference the same logical order. The ledger keys on
    // payment_id, so each delivery is processed; but the grant RPC's
    // "one active pass per user/env" rule refreshes rather than stacks.
    await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER}:sandbox:1000`,
        payment_id: 800,
      }),
    );
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].external_payment_reference).toBe("nowpayments:800");

    // Second payment, same order_id — either a re-issued invoice or a
    // secondary payment for the same buyer. Should update the same row,
    // not create a second one; entitlement window resets to now()+30d.
    state.nowMs += 3 * 24 * 60 * 60 * 1000;
    await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `aap30d:${USER}:sandbox:1000`,
        payment_id: 801,
      }),
    );
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].external_payment_reference).toBe("nowpayments:801");
    const daysLeft = (state.rows[0].expires_at.getTime() - state.nowMs) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBe(30);
  });

  it("redelivery of an already-handled payment reports duplicate but stays handled=true", async () => {
    const body = {
      payment_status: "finished",
      order_id: `aap30d:${USER}:sandbox:1000`,
      payment_id: 900,
    };
    const first = await handleWebhookRequest(signedRequest(body));
    expect(((await first.json()) as { handled: boolean }).handled).toBe(true);

    for (let i = 0; i < 3; i++) {
      const res = await handleWebhookRequest(signedRequest(body));
      expect(res.status).toBe(200);
      const json = (await res.json()) as { handled: boolean; reason?: string };
      expect(json.reason).toBe("duplicate_ipn");
      expect(json.handled).toBe(true);
    }
    expect(state.rows).toHaveLength(1);
  });
});
