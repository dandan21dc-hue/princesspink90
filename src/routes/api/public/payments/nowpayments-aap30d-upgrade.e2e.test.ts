/**
 * End-to-end All-Access Pass upgrade test.
 *
 * Simulates the full hosted-invoice purchase round-trip:
 *   1. User (no active membership) triggers `createNowpaymentsInvoice` — we
 *      mock NOWPayments' HTTP API to capture the exact `order_id` that
 *      would be encoded into the hosted invoice.
 *   2. NOWPayments "finishes" the payment and POSTs a signed IPN to our
 *      webhook. We build that request using the captured `order_id` and
 *      the real HMAC-SHA512 signer.
 *   3. We assert the webhook granted the 30-day term pass and the
 *      `useSubscription`-shaped predicate (`hasMembership` / `isActive`)
 *      flips from false → true for that user in that environment.
 *
 * The existing `nowpayments-webhook.e2e.test.ts` covers grant idempotency
 * and expiry rules in isolation; this file covers the invoice → webhook →
 * entitlement seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { stableStringify } from "@/lib/nowpayments.server";

// ---- fake `memberships` state ----------------------------------------------

type MembershipRow = {
  id: string;
  user_id: string;
  environment: "sandbox" | "live";
  kind: "term_pass_all_access_30d" | "lifetime";
  amount_cents: number | null;
  expires_at: Date | null;
  external_payment_reference: string | null;
};

const state: { rows: MembershipRow[]; nowMs: number } = { rows: [], nowMs: 0 };

// Reproduces `grant_all_access_pass_30d` semantically: one row per
// (user, env), idempotent by external ref, 30-day window from now().
function fakeGrantAllAccessPass30d(args: {
  _user_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number | null;
  _external_payment_reference: string | null;
}) {
  if (args._external_payment_reference) {
    const dup = state.rows.find(
      (r) => r.external_payment_reference === args._external_payment_reference,
    );
    if (dup) return { data: dup, error: null };
  }
  const existing = state.rows.find(
    (r) =>
      r.user_id === args._user_id &&
      r.environment === args._environment &&
      r.kind === "term_pass_all_access_30d",
  );
  const newExpiry = new Date(state.nowMs + 30 * 24 * 60 * 60 * 1000);
  if (existing) {
    existing.expires_at = newExpiry;
    if (args._amount_cents != null) existing.amount_cents = args._amount_cents;
    if (args._external_payment_reference) {
      existing.external_payment_reference = args._external_payment_reference;
    }
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

vi.mock("@/integrations/supabase/client.server", () => {
  const ledger = new Map<string, { handled: boolean; reason: string | null; received_count: number }>();
  const from = (table: string) => {
    if (table !== "nowpayments_ipn_events") throw new Error(`unexpected table: ${table}`);
    let pendingInsert: { payment_id: string } | null = null;
    let pendingPid: string | null = null;
    const api = {
      insert(row: { payment_id: string }) { pendingInsert = row; return api; },
      update(_p: unknown) { return api; },
      select(_c?: string) { return api; },
      eq(_c: string, v: string) { pendingPid = v; return api; },
      maybeSingle: () => {
        if (pendingInsert) {
          const pid = pendingInsert.payment_id;
          if (ledger.has(pid)) return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } });
          ledger.set(pid, { handled: false, reason: null, received_count: 1 });
          return Promise.resolve({ data: { payment_id: pid }, error: null });
        }
        const r = pendingPid ? ledger.get(pendingPid) ?? null : null;
        return Promise.resolve({ data: r, error: null });
      },
      then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return api;
  };
  return {
    supabaseAdmin: {
      rpc: (name: string, args: Parameters<typeof fakeGrantAllAccessPass30d>[0]) => {
        if (name === "grant_all_access_pass_30d") return Promise.resolve(fakeGrantAllAccessPass30d(args));
        return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
      },
      from,
    },
  };
});

// ---- fake NOWPayments hosted-invoice API -----------------------------------

const captured: { orderId?: string; description?: string; amount?: number; currency?: string } =
  {};

vi.mock("@/lib/nowpayments.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nowpayments.server")>();
  return {
    ...actual, // keep the real HMAC signer + stableStringify
    createInvoice: vi.fn(async (input: {
      priceAmount: number;
      priceCurrency: string;
      orderId: string;
      orderDescription: string;
      ipnCallbackUrl: string;
      successUrl?: string;
      cancelUrl?: string;
    }) => {
      captured.orderId = input.orderId;
      captured.description = input.orderDescription;
      captured.amount = input.priceAmount;
      captured.currency = input.priceCurrency;
      return {
        id: "np_inv_test",
        invoice_url: "https://nowpayments.io/payment/?iid=np_inv_test",
        order_id: input.orderId,
      };
    }),
  };
});

// Mock TanStack's createServerFn so the auth middleware is not required in
// tests — we inject a synthetic `context.userId`, run the input validator,
// then hand off to the handler. This lets us exercise the real handler
// body without spinning up a live Supabase session.
const UPGRADER = "77777777-7777-7777-7777-777777777777";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    createServerFn: () => {
      const chain = {
        _validator: (d: unknown) => d,
        _handler: null as null | ((c: { data: unknown; context: { userId: string } }) => unknown),
        middleware() {
          return chain;
        },
        inputValidator(fn: (d: unknown) => unknown) {
          chain._validator = fn;
          return chain;
        },
        handler(fn: (c: { data: unknown; context: { userId: string } }) => unknown) {
          chain._handler = fn;
          return async ({ data }: { data: unknown }) => {
            const validated = chain._validator(data);
            return chain._handler!({ data: validated, context: { userId: UPGRADER } });
          };
        },
      };
      return chain;
    },
  };
});

// These imports must come AFTER the mocks so they pick up the fakes.
import { createNowpaymentsInvoice } from "@/lib/nowpayments.functions";
import { handleWebhookRequest } from "./nowpayments-webhook";

// ---- helpers ---------------------------------------------------------------

const IPN_SECRET = "e2e-ipn-upgrade-secret";

function signedIpn(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha512", IPN_SECRET)
    .update(stableStringify(JSON.parse(raw)))
    .digest("hex");
  return new Request("https://example.test/api/public/payments/nowpayments-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
    body: raw,
  });
}

// Mirrors the `useSubscription` predicate: lifetime OR unexpired term pass.
function hasActiveMembership(userId: string, env: "sandbox" | "live", nowMs: number) {
  return state.rows.some(
    (m) =>
      m.user_id === userId &&
      m.environment === env &&
      (m.kind === "lifetime" ||
        (String(m.kind).startsWith("term_pass_") &&
          m.expires_at !== null &&
          m.expires_at.getTime() > nowMs)),
  );
}

beforeEach(() => {
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  state.rows = [];
  state.nowMs = new Date("2026-07-15T00:00:00Z").getTime();
  captured.orderId = undefined;
  captured.description = undefined;
  captured.amount = undefined;
  captured.currency = undefined;
});

// ---- the round-trip -------------------------------------------------------

describe("Subscription upgrade → All-Access Pass entitlement (end-to-end)", () => {
  it("grants access after the hosted invoice is paid and the webhook fires", async () => {
    // 0. Baseline: brand-new user has no membership.
    expect(hasActiveMembership(UPGRADER, "sandbox", state.nowMs)).toBe(false);

    // 1. User clicks "Upgrade" → server creates a hosted NOWPayments invoice.
    //    No priceId / pantyListingId → fallback aap30d flow (A$10.00).
    const invoice = await createNowpaymentsInvoice({
      data: { environment: "sandbox", returnOrigin: "https://example.test" },
    });
    expect(invoice).toEqual({ invoiceUrl: "https://nowpayments.io/payment/?iid=np_inv_test" });

    // Sanity: the invoice we would show the user encodes what the webhook
    // needs (kind, user, env, amount) so the grant is deterministic on payment.
    expect(captured.amount).toBe(10);
    expect(captured.currency).toBe("aud");
    expect(captured.description).toMatch(/All-Access Pass/);
    expect(captured.orderId).toBe(`aap30d:${UPGRADER}:sandbox:1000`);

    // 2. Simulate NOWPayments finishing the payment and POSTing the IPN back
    //    to our public webhook using the exact order_id from the invoice.
    const res = await handleWebhookRequest(
      signedIpn({
        payment_id: 9001,
        payment_status: "finished",
        order_id: captured.orderId,
        price_amount: 10,
        price_currency: "aud",
      }),
    );

    // 3. Webhook must ack (so NOWPayments stops retrying) and mark handled.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });

    // 4. The user's entitlement predicate has flipped: they now have access.
    expect(hasActiveMembership(UPGRADER, "sandbox", state.nowMs)).toBe(true);
    const row = state.rows[0];
    expect(row.kind).toBe("term_pass_all_access_30d");
    expect(row.amount_cents).toBe(1000);
    expect(row.external_payment_reference).toBe("nowpayments:9001");
    // 30-day window from "now".
    expect(row.expires_at!.getTime() - state.nowMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("does not grant access when the hosted invoice was created but never paid", async () => {
    await createNowpaymentsInvoice({
      data: { environment: "sandbox", returnOrigin: "https://example.test" },
    });
    // NOWPayments only ever sends waiting/confirming — the buyer abandons.
    for (const status of ["waiting", "confirming", "expired", "failed"]) {
      const res = await handleWebhookRequest(
        signedIpn({ payment_id: 9002, payment_status: status, order_id: captured.orderId }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { handled: boolean };
      expect(json.handled).toBe(false);
    }
    expect(hasActiveMembership(UPGRADER, "sandbox", state.nowMs)).toBe(false);
    expect(state.rows).toHaveLength(0);
  });

  it("rejects a forged IPN whose signature does not match the payload", async () => {
    await createNowpaymentsInvoice({
      data: { environment: "sandbox", returnOrigin: "https://example.test" },
    });
    const raw = JSON.stringify({
      payment_id: 9003,
      payment_status: "finished",
      order_id: captured.orderId,
    });
    const req = new Request("https://example.test/api/public/payments/nowpayments-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nowpayments-sig": "deadbeef".repeat(16), // wrong sig
      },
      body: raw,
    });
    const res = await handleWebhookRequest(req);
    expect(res.status).toBe(401);
    expect(hasActiveMembership(UPGRADER, "sandbox", state.nowMs)).toBe(false);
  });

  it("is idempotent: NOWPayments redelivering the finished IPN only grants once", async () => {
    await createNowpaymentsInvoice({
      data: { environment: "sandbox", returnOrigin: "https://example.test" },
    });
    const body = {
      payment_id: 9004,
      payment_status: "finished",
      order_id: captured.orderId,
    };
    await handleWebhookRequest(signedIpn(body));
    await handleWebhookRequest(signedIpn(body));
    await handleWebhookRequest(signedIpn(body));
    expect(state.rows).toHaveLength(1);
    expect(hasActiveMembership(UPGRADER, "sandbox", state.nowMs)).toBe(true);
  });
});
