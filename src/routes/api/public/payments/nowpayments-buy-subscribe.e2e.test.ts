// @vitest-environment jsdom
/**
 * End-to-end coverage for the two shipping NOWPayments flows:
 *
 *   Buy       — one-off purchase of a panty listing (order_id `panty:...`)
 *   Subscribe — Lifetime Membership priceId (order_id `lifetime:...`)
 *
 * Each flow exercises the full seam that a real buyer touches:
 *
 *   1. `createNowpaymentsInvoice` server function mints a hosted invoice
 *      with the correct amount / currency / description / order_id.
 *   2. The `nowpaymentsProvider.useCheckout` hook redirects the browser
 *      to `invoice_url` (verified via a stubbed `window.location`).
 *   3. NOWPayments POSTs a signed IPN back to `handleWebhookRequest`,
 *      which grants the right entitlement idempotently.
 *
 * The `aap30d` upgrade round-trip lives in
 * `nowpayments-aap30d-upgrade.e2e.test.ts`; signature / grant edge cases
 * live in the `-webhook.e2e.test.ts` files. This file specifically
 * covers the "invoice → redirect → webhook grant" chain for the Buy and
 * Subscribe surfaces that ship in the UI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { renderHook, act } from "@testing-library/react";
import { stableStringify } from "@/lib/nowpayments.server";

// ---- test identities -------------------------------------------------------

const BUYER = "11111111-1111-1111-1111-111111111111";
const SUBSCRIBER = "22222222-2222-2222-2222-222222222222";
const PANTY_LISTING = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// The provider reads `window.location.origin` and writes to
// `window.location.href` to perform the redirect. Test-local userId is
// swapped between Buy and Subscribe by mutating this ref before invoking
// the server fn.
let CURRENT_USER = BUYER;

// ---- fake supabaseAdmin ----------------------------------------------------

type PantyRow = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  published: boolean;
  sold: boolean;
};

type LifetimeMembership = {
  user_id: string;
  environment: "sandbox" | "live";
  amount_cents: number;
  external_payment_reference: string;
};

type PantyOrder = {
  user_id: string;
  panty_listing_id: string;
  environment: "sandbox" | "live";
  amount_cents: number;
  external_payment_reference: string;
};

const state: {
  listings: PantyRow[];
  lifetime: LifetimeMembership[];
  pantyOrders: PantyOrder[];
} = { listings: [], lifetime: [], pantyOrders: [] };

function fakeGrantLifetime(args: {
  _user_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number;
  _external_payment_reference: string;
}) {
  const dup = state.lifetime.find(
    (r) => r.external_payment_reference === args._external_payment_reference,
  );
  if (dup) return { data: dup, error: null };
  const row: LifetimeMembership = {
    user_id: args._user_id,
    environment: args._environment,
    amount_cents: args._amount_cents,
    external_payment_reference: args._external_payment_reference,
  };
  state.lifetime.push(row);
  return { data: row, error: null };
}

function fakeGrantPantyOrder(args: {
  _user_id: string;
  _panty_listing_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number;
  _external_payment_reference: string;
}) {
  const dup = state.pantyOrders.find(
    (r) => r.external_payment_reference === args._external_payment_reference,
  );
  if (dup) return { data: dup, error: null };
  const row: PantyOrder = {
    user_id: args._user_id,
    panty_listing_id: args._panty_listing_id,
    environment: args._environment,
    amount_cents: args._amount_cents,
    external_payment_reference: args._external_payment_reference,
  };
  state.pantyOrders.push(row);
  // Real RPC also marks the listing sold; mirror that so a second Buy
  // attempt against the same listing would fail invoice creation.
  const listing = state.listings.find((l) => l.id === args._panty_listing_id);
  if (listing) listing.sold = true;
  return { data: row, error: null };
}

vi.mock("@/integrations/supabase/client.server", () => {
  type LedgerRow = { handled: boolean; reason: string | null; received_count: number };
  const ledger = new Map<string, LedgerRow>();
  const ledgerKey = (pid: string, st: string) => `${pid}|${st}`;
  type HistoryRow = { last_status: string; handled: boolean; processed_at: string | null };

  function ipnLedgerFrom() {
    return {
      insert(row: { payment_id: string; last_status: string }) {
        const k = ledgerKey(row.payment_id, row.last_status);
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
        const eqFilters: Record<string, string> = {};
        const neqFilters: Record<string, string> = {};
        const rd = {
          eq: (c: string, v: string) => { eqFilters[c] = v; return rd; },
          neq: (c: string, v: string) => { neqFilters[c] = v; return rd; },
          maybeSingle: () => Promise.resolve({
            data: ledger.get(ledgerKey(eqFilters.payment_id, eqFilters.last_status)) ?? null,
            error: null,
          }),
          then(
            resolve: (v: { data: HistoryRow[]; error: null }) => unknown,
            reject?: (e: unknown) => unknown,
          ) {
            const rows: HistoryRow[] = [];
            for (const [k, row] of ledger.entries()) {
              const [pid, st] = k.split("|");
              if (eqFilters.payment_id !== undefined && pid !== eqFilters.payment_id) continue;
              if (eqFilters.last_status !== undefined && st !== eqFilters.last_status) continue;
              if (neqFilters.last_status !== undefined && st === neqFilters.last_status) continue;
              rows.push({ last_status: st, handled: row.handled, processed_at: null });
            }
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return rd;
      },
      update(patch: Record<string, unknown>) {
        const f: Record<string, string> = {};
        const upd = {
          eq: (c: string, v: string) => { f[c] = v; return upd; },
          then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
            const row = ledger.get(ledgerKey(f.payment_id, f.last_status));
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return upd;
      },
    };
  }

  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table === "panty_listings") {
          return {
            select: () => ({
              eq: (_col: string, id: string) => ({
                maybeSingle: () => {
                  const row = state.listings.find((l) => l.id === id) ?? null;
                  return Promise.resolve({ data: row, error: null });
                },
              }),
            }),
          };
        }
        if (table === "nowpayments_ipn_events") return ipnLedgerFrom();
        throw new Error(`unexpected table: ${table}`);
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "grant_lifetime_membership") {
          return Promise.resolve(
            fakeGrantLifetime(args as Parameters<typeof fakeGrantLifetime>[0]),
          );
        }
        if (name === "grant_panty_listing_order") {
          return Promise.resolve(
            fakeGrantPantyOrder(args as Parameters<typeof fakeGrantPantyOrder>[0]),
          );
        }
        // grant_purchase_reward_points and other helpers are no-ops in tests.
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

// ---- fake NOWPayments hosted invoice API ----------------------------------

const captured: {
  orderId?: string;
  description?: string;
  amount?: number;
  currency?: string;
  ipnCallbackUrl?: string;
} = {};

vi.mock("@/lib/nowpayments.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nowpayments.server")>();
  return {
    ...actual,
    createInvoice: vi.fn(async (input: {
      priceAmount: number;
      priceCurrency: string;
      orderId: string;
      orderDescription: string;
      ipnCallbackUrl: string;
    }) => {
      captured.orderId = input.orderId;
      captured.description = input.orderDescription;
      captured.amount = input.priceAmount;
      captured.currency = input.priceCurrency;
      captured.ipnCallbackUrl = input.ipnCallbackUrl;
      return {
        id: "np_inv_buysub",
        invoice_url: `https://nowpayments.io/payment/?iid=${encodeURIComponent(input.orderId)}`,
        order_id: input.orderId,
      };
    }),
  };
});

// Bypass account-restriction and maintenance guards so the handler body
// can be exercised without a live Supabase session in the context.
vi.mock("@/lib/account-restriction", () => ({
  assertAccountNotRestricted: () => Promise.resolve(),
  assertProfileVerified: () => Promise.resolve(),
}));
vi.mock("@/lib/maintenance.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/maintenance.functions")>();
  return { ...actual, assertNotInMaintenance: () => Promise.resolve() };
});
// Resolve app origin deterministically — no real HTTP request in tests.
vi.mock("@/lib/app-origin.server", () => ({
  resolveAppOrigin: () => "https://example.test",
}));

// Bypass the auth middleware — inject `context.userId` from CURRENT_USER
// so the invoice server fn can run without a live Supabase session.
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
            return chain._handler!({ data: validated, context: { userId: CURRENT_USER } });
          };
        },
      };
      return chain;
    },
  };
});

// Imports must come AFTER mocks so they pick up the fakes.
import { nowpaymentsProvider } from "@/lib/payments/providers/nowpayments";
import { handleWebhookRequest } from "./nowpayments-webhook";

// ---- helpers ---------------------------------------------------------------

const IPN_SECRET = "e2e-buy-subscribe-secret";

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

/** Replace `window.location` with a mutable stub so the provider's
 *  `window.location.href = invoiceUrl` assignment doesn't throw the
 *  jsdom "not implemented: navigation" error, and we can assert on it. */
function stubLocation(origin = "https://example.test") {
  const loc = { href: origin, origin };
  Object.defineProperty(window, "location", {
    value: loc,
    writable: true,
    configurable: true,
  });
  return loc;
}

beforeEach(() => {
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
  state.listings = [
    {
      id: PANTY_LISTING,
      title: "Lace pair, worn 24h",
      price_cents: 4500,
      currency: "aud",
      published: true,
      sold: false,
    },
  ];
  state.lifetime = [];
  state.pantyOrders = [];
  captured.orderId = undefined;
  captured.description = undefined;
  captured.amount = undefined;
  captured.currency = undefined;
  captured.ipnCallbackUrl = undefined;
});

// ---- the round-trips -------------------------------------------------------

describe("NOWPayments Buy flow — one-off panty listing purchase", () => {
  it("mints an invoice, redirects the browser, and grants the order on IPN", async () => {
    CURRENT_USER = BUYER;
    const location = stubLocation();

    // 1. User clicks Buy on a listing → provider hook opens checkout.
    const { result } = renderHook(() => nowpaymentsProvider.useCheckout("one_time"));

    await act(async () => {
      await result.current.openCheckout({ pantyListingId: PANTY_LISTING });
    });

    // 2. Invoice was created with authoritative price + panty order_id.
    expect(captured.amount).toBe(45); // 4500 cents == A$45.00
    expect(captured.currency).toBe("aud");
    expect(captured.description).toMatch(/Lace pair/);
    expect(captured.orderId).toBe(
      `panty:${PANTY_LISTING}:${BUYER}:sandbox:4500`,
    );
    expect(captured.ipnCallbackUrl).toBe(
      "https://example.test/api/public/payments/nowpayments-webhook",
    );

    // 3. Browser was redirected off-site to the hosted invoice page.
    expect(location.href).toBe(
      `https://nowpayments.io/payment/?iid=${encodeURIComponent(captured.orderId!)}`,
    );

    // 4. NOWPayments settles the payment and POSTs the signed IPN.
    const res = await handleWebhookRequest(
      signedIpn({
        payment_id: 5001,
        payment_status: "finished",
        order_id: captured.orderId,
        price_amount: 45,
        price_currency: "aud",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });

    // 5. The panty listing order was granted to the buyer, once.
    expect(state.pantyOrders).toEqual([
      {
        user_id: BUYER,
        panty_listing_id: PANTY_LISTING,
        environment: "sandbox",
        amount_cents: 4500,
        external_payment_reference: "nowpayments:5001",
      },
    ]);

    // 6. Redelivering the same IPN is a no-op (idempotent by payment_id).
    await handleWebhookRequest(
      signedIpn({
        payment_id: 5001,
        payment_status: "finished",
        order_id: captured.orderId,
      }),
    );
    expect(state.pantyOrders).toHaveLength(1);
  });
});

describe("NOWPayments Subscribe flow — Lifetime Membership", () => {
  it("mints a lifetime invoice, redirects, and grants the membership on IPN", async () => {
    CURRENT_USER = SUBSCRIBER;
    const location = stubLocation();

    const { result } = renderHook(() => nowpaymentsProvider.useCheckout("subscription"));

    await act(async () => {
      await result.current.openCheckout({ priceId: "lifetime_onetime_aud" });
    });

    // Amount + description resolved from EXPECTED_PLAN_PRICES server-side.
    expect(captured.amount).toBe(499); // 49900 cents == A$499.00
    expect(captured.currency).toBe("aud");
    expect(captured.description).toMatch(/Lifetime/i);
    expect(captured.orderId).toBe(`lifetime:${SUBSCRIBER}:sandbox:49900`);

    // Browser redirected to hosted invoice URL.
    expect(location.href).toBe(
      `https://nowpayments.io/payment/?iid=${encodeURIComponent(captured.orderId!)}`,
    );

    // Payment settles → IPN grants the lifetime membership.
    const res = await handleWebhookRequest(
      signedIpn({
        payment_id: 6001,
        payment_status: "finished",
        order_id: captured.orderId,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });

    expect(state.lifetime).toEqual([
      {
        user_id: SUBSCRIBER,
        environment: "sandbox",
        amount_cents: 49900,
        external_payment_reference: "nowpayments:6001",
      },
    ]);

    // Redelivery is idempotent.
    await handleWebhookRequest(
      signedIpn({
        payment_id: 6001,
        payment_status: "finished",
        order_id: captured.orderId,
      }),
    );
    expect(state.lifetime).toHaveLength(1);
  });

  it("does not redirect (or grant) when the server rejects the priceId", async () => {
    CURRENT_USER = SUBSCRIBER;
    const location = stubLocation();

    const { result } = renderHook(() => nowpaymentsProvider.useCheckout("subscription"));

    await act(async () => {
      await result.current.openCheckout({ priceId: "not_a_real_plan" });
    });

    // Provider swallowed the error into a toast + kept the user on-site.
    expect(location.href).toBe("https://example.test");
    expect(captured.orderId).toBeUndefined();
    expect(state.lifetime).toHaveLength(0);
  });
});
