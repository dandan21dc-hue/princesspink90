/**
 * End-to-end webhook coverage for every entitlement kind: HMAC signature
 * verification (accept/reject/replay), plus stateful fakes for the three
 * grant paths (lifetime, panty, booking) that mirror the real database
 * contracts closely enough to prove Supabase user access flips correctly.
 *
 * The 30-day pass path is already exercised in `nowpayments-webhook.e2e.test.ts`;
 * this file focuses on the newer NOWPayments-only flows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { stableStringify } from "@/lib/nowpayments.server";

// ---- fake Supabase state -------------------------------------------------

type LifetimeRow = {
  id: string;
  user_id: string;
  environment: "sandbox" | "live";
  kind: "lifetime";
  amount_cents: number | null;
  expires_at: null;
  external_payment_reference: string | null;
};

type PantyOrderRow = {
  id: string;
  user_id: string;
  panty_listing_id: string;
  environment: "sandbox" | "live";
  amount_cents: number | null;
  status: "paid";
  external_payment_reference: string | null;
};

type PantyListingRow = {
  id: string;
  title: string;
  price_cents: number;
  currency: "aud";
  published: boolean;
  sold: boolean;
};

type BookingRow = {
  id: string;
  user_id: string;
  status: "pending" | "confirmed" | "cancelled";
  environment: "sandbox" | "live";
  amount_cents: number | null;
  external_payment_reference: string | null;
};

const state = {
  memberships: [] as LifetimeRow[],
  panty_orders: [] as PantyOrderRow[],
  panty_listings: [] as PantyListingRow[],
  bookings: [] as BookingRow[],
  nowMs: 0,
};

// Reproduces `grant_lifetime_membership`: idempotent per external ref, one row
// per (user, env, kind='lifetime'), no expiry.
function fakeGrantLifetime(args: {
  _user_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number | null;
  _external_payment_reference: string | null;
}) {
  if (args._external_payment_reference) {
    const dup = state.memberships.find(
      (r) => r.external_payment_reference === args._external_payment_reference,
    );
    if (dup) return { data: dup, error: null };
  }
  const existing = state.memberships.find(
    (r) => r.user_id === args._user_id && r.environment === args._environment,
  );
  if (existing) {
    if (args._amount_cents != null) existing.amount_cents = args._amount_cents;
    if (!existing.external_payment_reference) {
      existing.external_payment_reference = args._external_payment_reference;
    }
    return { data: existing, error: null };
  }
  const row: LifetimeRow = {
    id: `mem_${state.memberships.length + 1}`,
    user_id: args._user_id,
    environment: args._environment,
    kind: "lifetime",
    amount_cents: args._amount_cents,
    expires_at: null,
    external_payment_reference: args._external_payment_reference,
  };
  state.memberships.push(row);
  return { data: row, error: null };
}

// Reproduces `grant_panty_listing_order`: idempotent per external ref,
// inserts a paid order, marks listing as sold.
function fakeGrantPanty(args: {
  _user_id: string;
  _panty_listing_id: string;
  _environment: "sandbox" | "live";
  _amount_cents: number | null;
  _external_payment_reference: string | null;
}) {
  if (args._external_payment_reference) {
    const dup = state.panty_orders.find(
      (r) => r.external_payment_reference === args._external_payment_reference,
    );
    if (dup) return { data: dup, error: null };
  }
  const listing = state.panty_listings.find((l) => l.id === args._panty_listing_id);
  if (!listing) {
    return {
      data: null,
      error: { message: `panty listing ${args._panty_listing_id} not found` },
    };
  }
  const row: PantyOrderRow = {
    id: `po_${state.panty_orders.length + 1}`,
    user_id: args._user_id,
    panty_listing_id: args._panty_listing_id,
    environment: args._environment,
    amount_cents: args._amount_cents,
    status: "paid",
    external_payment_reference: args._external_payment_reference,
  };
  state.panty_orders.push(row);
  listing.sold = true;
  return { data: row, error: null };
}

// ---- supabaseAdmin fake --------------------------------------------------

function bookingsFrom() {
  // Only the two shapes the webhook actually calls are supported:
  //   .from('private_room_bookings').select(...).eq('id', id).maybeSingle()
  //   .from('private_room_bookings').update({...}).eq('id', id)
  return {
    select: (_cols: string) => ({
      eq: (col: "id", value: string) => ({
        maybeSingle: () => {
          if (col !== "id") throw new Error("unexpected eq column");
          const row = state.bookings.find((b) => b.id === value) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      }),
    }),
    update: (patch: Partial<BookingRow>) => ({
      eq: (col: "id", value: string) => {
        if (col !== "id") throw new Error("unexpected eq column");
        const row = state.bookings.find((b) => b.id === value);
        if (row) Object.assign(row, patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

const ipnLedger = new Map<string, { handled: boolean; reason: string | null; received_count: number }>();
function ipnLedgerFrom() {
  let pendingInsert: { payment_id: string } | null = null;
  let pendingPid: string | null = null;
  const api = {
    insert(row: { payment_id: string }) { pendingInsert = row; return api; },
    update(patch: Record<string, unknown>) {
      return {
        eq: (_c: string, v: string) => {
          const row = ipnLedger.get(v);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    select(_c?: string) { return api; },
    eq(_c: string, v: string) { pendingPid = v; return api; },
    maybeSingle: () => {
      if (pendingInsert) {
        const pid = pendingInsert.payment_id;
        if (ipnLedger.has(pid)) return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } });
        ipnLedger.set(pid, { handled: false, reason: null, received_count: 1 });
        return Promise.resolve({ data: { payment_id: pid }, error: null });
      }
      const r = pendingPid ? ipnLedger.get(pendingPid) ?? null : null;
      return Promise.resolve({ data: r, error: null });
    },
    then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "grant_lifetime_membership") {
        return Promise.resolve(fakeGrantLifetime(args as Parameters<typeof fakeGrantLifetime>[0]));
      }
      if (name === "grant_panty_listing_order") {
        return Promise.resolve(fakeGrantPanty(args as Parameters<typeof fakeGrantPanty>[0]));
      }
      if (name === "grant_all_access_pass_30d") {
        // Not exercised in this file — see nowpayments-webhook.e2e.test.ts.
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unexpected rpc: ${name}` },
      });
    },
    from: (table: string) => {
      if (table === "private_room_bookings") return bookingsFrom();
      if (table === "nowpayments_ipn_events") return ipnLedgerFrom();
      throw new Error(`unexpected from(${table})`);
    },
  },
}));

import { handleWebhookRequest, processIpn } from "./nowpayments-webhook";

// ---- helpers -------------------------------------------------------------

const SECRET = "e2e-ipn-secret-access";
const USER = "22222222-2222-2222-2222-222222222222";
const OTHER_USER = "33333333-3333-3333-3333-333333333333";
const LISTING = "44444444-4444-4444-4444-444444444444";
const BOOKING = "55555555-5555-5555-5555-555555555555";

function signedRequest(body: unknown, opts: { badSig?: boolean; noSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const canonical = stableStringify(JSON.parse(raw));
  const sig = createHmac("sha512", SECRET).update(canonical).digest("hex");
  const headers = new Headers({ "content-type": "application/json" });
  if (!opts.noSig) {
    headers.set("x-nowpayments-sig", opts.badSig ? "deadbeef".repeat(16) : sig);
  }
  return new Request("https://example.test/api/public/payments/nowpayments-webhook", {
    method: "POST",
    headers,
    body: raw,
  });
}

// Access predicates that mirror what production code checks when deciding
// whether the buyer can consume the entitlement.
function hasLifetime(userId: string, env: "sandbox" | "live") {
  return state.memberships.some(
    (r) => r.user_id === userId && r.environment === env && r.kind === "lifetime",
  );
}
function ownsListing(userId: string, listingId: string, env: "sandbox" | "live") {
  return state.panty_orders.some(
    (o) =>
      o.user_id === userId &&
      o.panty_listing_id === listingId &&
      o.environment === env &&
      o.status === "paid",
  );
}
function bookingConfirmed(bookingId: string) {
  return state.bookings.find((b) => b.id === bookingId)?.status === "confirmed";
}

beforeEach(() => {
  process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
  state.memberships = [];
  state.panty_orders = [];
  state.panty_listings = [
    { id: LISTING, title: "Silk pair", price_cents: 4500, currency: "aud", published: true, sold: false },
  ];
  state.bookings = [
    {
      id: BOOKING,
      user_id: USER,
      status: "pending",
      environment: "sandbox",
      amount_cents: null,
      external_payment_reference: null,
    },
  ];
  state.nowMs = new Date("2026-06-01T00:00:00Z").getTime();
});

// ---- HMAC signature verification (cross-cutting) -------------------------

describe("NOWPayments webhook — HMAC verification across kinds", () => {
  const kinds = [
    { name: "lifetime", order: `lifetime:${USER}:sandbox:49900` },
    { name: "panty", order: `panty:${LISTING}:${USER}:sandbox:4500` },
    { name: "booking", order: `booking:${BOOKING}:${USER}:sandbox:27500` },
  ] as const;

  it.each(kinds)("rejects an unsigned $name event (401, no state change)", async ({ order }) => {
    const res = await handleWebhookRequest(
      signedRequest(
        { payment_status: "finished", order_id: order, payment_id: 900 },
        { noSig: true },
      ),
    );
    expect(res.status).toBe(401);
    expect(state.memberships).toHaveLength(0);
    expect(state.panty_orders).toHaveLength(0);
    expect(state.bookings[0].status).toBe("pending");
    expect(state.panty_listings[0].sold).toBe(false);
  });

  it.each(kinds)("rejects a $name event with a wrong signature (401)", async ({ order }) => {
    const res = await handleWebhookRequest(
      signedRequest(
        { payment_status: "finished", order_id: order, payment_id: 901 },
        { badSig: true },
      ),
    );
    expect(res.status).toBe(401);
    expect(state.memberships).toHaveLength(0);
    expect(state.panty_orders).toHaveLength(0);
    expect(state.bookings[0].status).toBe("pending");
  });

  it.each(kinds)("accepts a correctly signed $name event (200)", async ({ order }) => {
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: order, payment_id: 902 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
  });

  it("returns 500 when NOWPAYMENTS_IPN_SECRET is not configured", async () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    const res = await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: kinds[0].order,
        payment_id: 903,
      }),
    );
    expect(res.status).toBe(500);
    expect(state.memberships).toHaveLength(0);
  });

  it("body-tamper: swapping order_id after signing invalidates the signature", async () => {
    // Sign with the "aap30d" order but send with "lifetime" — server rejects.
    const originalBody = JSON.stringify({
      payment_status: "finished",
      order_id: `aap30d:${USER}:sandbox:1000`,
      payment_id: 904,
    });
    const sig = createHmac("sha512", SECRET)
      .update(stableStringify(JSON.parse(originalBody)))
      .digest("hex");
    const tamperedBody = JSON.stringify({
      payment_status: "finished",
      order_id: `lifetime:${USER}:sandbox:49900`,
      payment_id: 904,
    });
    const req = new Request("https://example.test/api/public/payments/nowpayments-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: tamperedBody,
    });
    const res = await handleWebhookRequest(req);
    expect(res.status).toBe(401);
    expect(hasLifetime(USER, "sandbox")).toBe(false);
  });
});

// ---- Lifetime membership --------------------------------------------------

describe("NOWPayments webhook — lifetime membership access", () => {
  const orderId = `lifetime:${USER}:sandbox:49900`;

  it("grants lifetime access on a finished payment", async () => {
    expect(hasLifetime(USER, "sandbox")).toBe(false);
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 1000 }),
    );
    expect(res.status).toBe(200);
    expect(hasLifetime(USER, "sandbox")).toBe(true);
    expect(state.memberships[0].external_payment_reference).toBe("nowpayments:1000");
    expect(state.memberships[0].amount_cents).toBe(49900);
  });

  it("is idempotent: replayed finished webhook for the same payment_id yields one row", async () => {
    const body = { payment_status: "finished", order_id: orderId, payment_id: 1001 };
    await handleWebhookRequest(signedRequest(body));
    await handleWebhookRequest(signedRequest(body));
    expect(state.memberships).toHaveLength(1);
    expect(hasLifetime(USER, "sandbox")).toBe(true);
  });

  it("does not grant on non-finished statuses", async () => {
    for (const status of ["waiting", "confirming", "failed", "expired", "refunded"]) {
      const res = await handleWebhookRequest(
        signedRequest({ payment_status: status, order_id: orderId, payment_id: 1010 }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { handled: boolean; reason?: string };
      expect(json.handled).toBe(false);
    }
    expect(hasLifetime(USER, "sandbox")).toBe(false);
  });

  it("keeps sandbox and live lifetime access independent", async () => {
    await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `lifetime:${USER}:sandbox:49900`,
        payment_id: 1020,
      }),
    );
    await handleWebhookRequest(
      signedRequest({
        payment_status: "finished",
        order_id: `lifetime:${USER}:live:49900`,
        payment_id: 1021,
      }),
    );
    expect(hasLifetime(USER, "sandbox")).toBe(true);
    expect(hasLifetime(USER, "live")).toBe(true);
    expect(state.memberships).toHaveLength(2);
  });
});

// ---- Panty listing order -------------------------------------------------

describe("NOWPayments webhook — panty listing access", () => {
  const orderId = `panty:${LISTING}:${USER}:sandbox:4500`;

  it("grants a paid order and marks the listing sold", async () => {
    expect(ownsListing(USER, LISTING, "sandbox")).toBe(false);
    expect(state.panty_listings[0].sold).toBe(false);

    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 2000 }),
    );
    expect(res.status).toBe(200);
    expect(ownsListing(USER, LISTING, "sandbox")).toBe(true);
    expect(state.panty_listings[0].sold).toBe(true);
  });

  it("is idempotent: a redelivered webhook does not create a duplicate order", async () => {
    const body = { payment_status: "finished", order_id: orderId, payment_id: 2001 };
    await handleWebhookRequest(signedRequest(body));
    await handleWebhookRequest(signedRequest(body));
    expect(state.panty_orders).toHaveLength(1);
  });

  it("does not grant access to a different user just because the listing is sold", async () => {
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 2002 }),
    );
    expect(ownsListing(USER, LISTING, "sandbox")).toBe(true);
    expect(ownsListing(OTHER_USER, LISTING, "sandbox")).toBe(false);
  });
});

// ---- Booking confirmation ------------------------------------------------

describe("NOWPayments webhook — booking confirmation access", () => {
  const orderId = `booking:${BOOKING}:${USER}:sandbox:27500`;

  it("flips a pending booking to confirmed and stamps the payment reference", async () => {
    expect(bookingConfirmed(BOOKING)).toBe(false);
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 3000 }),
    );
    expect(res.status).toBe(200);
    expect(bookingConfirmed(BOOKING)).toBe(true);
    expect(state.bookings[0].external_payment_reference).toBe("nowpayments:3000");
    expect(state.bookings[0].amount_cents).toBe(27500);
  });

  it("is idempotent: replay of the same payment leaves the booking confirmed", async () => {
    const body = { payment_status: "finished", order_id: orderId, payment_id: 3001 };
    await handleWebhookRequest(signedRequest(body));
    await handleWebhookRequest(signedRequest(body));
    expect(state.bookings[0].status).toBe("confirmed");
    expect(state.bookings[0].external_payment_reference).toBe("nowpayments:3001");
  });

  it("rejects a payment whose order_id claims a different user (200, not handled)", async () => {
    // orderId encodes OTHER_USER but the booking row belongs to USER — the
    // webhook must refuse to confirm rather than silently grant access.
    const spoofed = `booking:${BOOKING}:${OTHER_USER}:sandbox:27500`;
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: spoofed, payment_id: 3002 }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { handled: boolean; reason?: string };
    expect(json.handled).toBe(false);
    expect(json.reason).toBe("booking_user_mismatch");
    expect(bookingConfirmed(BOOKING)).toBe(false);
  });

  it("does not overwrite a booking already paid by a different payment", async () => {
    await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 3010 }),
    );
    expect(bookingConfirmed(BOOKING)).toBe(true);
    // A rogue second payment with a different id must not steal the row.
    const res = await handleWebhookRequest(
      signedRequest({ payment_status: "finished", order_id: orderId, payment_id: 3011 }),
    );
    const json = (await res.json()) as { handled: boolean; reason?: string };
    expect(json.handled).toBe(false);
    expect(json.reason).toBe("booking_already_paid");
    expect(state.bookings[0].external_payment_reference).toBe("nowpayments:3010");
  });

  it("returns 'booking_not_found' when the referenced booking does not exist", async () => {
    const missing = "66666666-6666-6666-6666-666666666666";
    const res = await processIpn({
      payment_status: "finished",
      order_id: `booking:${missing}:${USER}:sandbox:27500`,
      payment_id: 3020,
    });
    expect(res).toEqual({ handled: false, reason: "booking_not_found" });
  });
});
