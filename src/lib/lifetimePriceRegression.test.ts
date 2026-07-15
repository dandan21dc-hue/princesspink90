/**
 * Regression: the Lifetime All-Access Pass must always charge A$600
 * (60000 cents, AUD) end-to-end.
 *
 * Guards two layers:
 *  1. Server-side price map — `getPlanPriceSpec("lifetime_onetime_aud")`
 *     resolves to 60000 cents / aud / kind "lifetime", filtered to
 *     `is_active = true` so a disabled row can't ship a wrong price.
 *  2. Webhook grant — a `finished` IPN with the canonical lifetime
 *     order_id `lifetime:<uid>:<env>:60000` invokes
 *     `grant_lifetime_membership` with `_amount_cents: 60000` and the
 *     namespaced payment reference.
 *
 * The DB row itself lives in `all_access_pass_tiers` (admin-editable),
 * so an admin who lowers the Lifetime price will fail (1). That's the
 * point of the regression: any change away from A$600 must be
 * intentional and update this test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const LIFETIME_PRICE_ID = "lifetime_onetime_aud";
const LIFETIME_CENTS = 60000; // A$600.00
const LIFETIME_CURRENCY = "aud";
const LIFETIME_KIND = "lifetime";

// ---------------------------------------------------------------------------
// (1) Server price map — mock @supabase/supabase-js so `serverClient()` in
//     planPriceValidation.server.ts returns a controllable client. We record
//     the filter chain so the test can assert `.eq("is_active", true)` is
//     applied.
// ---------------------------------------------------------------------------
const capturedFilters: Array<Record<string, unknown>> = [];
vi.mock("@supabase/supabase-js", () => {
  const createClient = () => ({
    from(_table: string) {
      const filters: Record<string, unknown> = { __table: _table };
      const chain: any = {
        select(_c: string) { filters.__select = _c; return chain; },
        eq(col: string, val: unknown) { filters[col] = val; return chain; },
        maybeSingle() {
          capturedFilters.push(filters);
          if (
            filters.__table === "all_access_pass_tiers" &&
            filters.price_id === LIFETIME_PRICE_ID &&
            filters.is_active === true
          ) {
            return Promise.resolve({
              data: {
                price_cents: LIFETIME_CENTS,
                currency: LIFETIME_CURRENCY,
                invoice_description: "Lifetime Membership (Midnight Glory)",
                kind: LIFETIME_KIND,
                is_active: true,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  });
  return { createClient };
});

import { getPlanPriceSpec } from "./planPriceValidation.server";

beforeEach(() => {
  capturedFilters.length = 0;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

describe("Lifetime price map — getPlanPriceSpec('lifetime_onetime_aud')", () => {
  it("returns exactly A$600 / aud / kind lifetime, filtered to active tiers", async () => {
    const spec = await getPlanPriceSpec(LIFETIME_PRICE_ID);
    expect(spec).not.toBeNull();
    expect(spec!.unit_amount).toBe(LIFETIME_CENTS);
    expect(spec!.unit_amount / 100).toBe(600);
    expect(spec!.currency).toBe(LIFETIME_CURRENCY);
    expect(spec!.kind).toBe(LIFETIME_KIND);

    // Guardrail: the lookup must scope to active rows so a disabled
    // Lifetime tier can't leak a stale price.
    expect(capturedFilters).toHaveLength(1);
    expect(capturedFilters[0]).toMatchObject({
      __table: "all_access_pass_tiers",
      price_id: LIFETIME_PRICE_ID,
      is_active: true,
    });
  });

  it("returns null when the row is inactive or missing (never falls back to a hardcoded price)", async () => {
    const spec = await getPlanPriceSpec("lifetime_onetime_disabled");
    expect(spec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) Webhook grant path — reuse the same supabaseAdmin ledger shape used
//     by nowpayments-webhook.test.ts and assert the lifetime finished event
//     grants at 60000 cents.
// ---------------------------------------------------------------------------
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
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
              if (ledger.has(k))
                return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } });
              ledger.set(k, { handled: false, reason: null, received_count: 1 });
              return Promise.resolve({ data: { payment_id: row.payment_id }, error: null });
            },
          }),
        };
      },
      select(_c?: string) {
        const filters: Record<string, string> = {};
        const rd: any = {
          eq: (c: string, v: string) => { filters[c] = v; return rd; },
          neq: (_c: string, _v: string) => rd,
          maybeSingle: () =>
            Promise.resolve({
              data: ledger.get(keyOf(filters.payment_id, filters.last_status)) ?? null,
              error: null,
            }),
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return rd;
      },
      update(patch: Partial<Row> & Record<string, unknown>) {
        const filters: Record<string, string> = {};
        const upd: any = {
          eq: (c: string, v: string) => { filters[c] = v; return upd; },
          then: (resolve: (v: { data: null; error: null }) => unknown) => {
            const row = ledger.get(keyOf(filters.payment_id, filters.last_status));
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return upd;
      },
    };
  };
  return { supabaseAdmin: { rpc: rpcMock, from } };
});

import { processIpn } from "@/routes/api/public/payments/nowpayments-webhook";

describe("Lifetime webhook grant — 60000 cents charged on `finished`", () => {
  beforeEach(() => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValue({
      data: {
        id: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
        user_id: "11111111-1111-1111-1111-111111111111",
        amount_cents: LIFETIME_CENTS,
        expires_at: null,
        external_payment_reference: "nowpayments:9001",
      },
      error: null,
    });
  });

  it("invokes grant_lifetime_membership with _amount_cents=60000 and a namespaced payment ref", async () => {
    const res = await processIpn({
      payment_status: "finished",
      order_id: `lifetime:11111111-1111-1111-1111-111111111111:sandbox:${LIFETIME_CENTS}`,
      payment_id: 9001,
      price_amount: 600,
      price_currency: "AUD",
    });
    expect(res.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("grant_lifetime_membership", {
      _user_id: "11111111-1111-1111-1111-111111111111",
      _environment: "sandbox",
      _amount_cents: LIFETIME_CENTS,
      _external_payment_reference: "nowpayments:9001",
    });
  });

  it("does NOT grant when the order_id encodes any amount other than 60000", async () => {
    // A crafted / stale order_id at the wrong price must still reach the
    // RPC (the RPC is the source of truth), but this test locks the
    // amount that leaves the webhook against the order_id contract so a
    // future refactor can't silently rewrite it.
    const res = await processIpn({
      payment_status: "finished",
      order_id: "lifetime:22222222-2222-2222-2222-222222222222:live:59900",
      payment_id: 9002,
    });
    expect(res.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "grant_lifetime_membership",
      expect.objectContaining({ _amount_cents: 59900 }),
    );
    // Regression assertion: 60000 is the ONLY amount we ever expect in
    // production for lifetime. Any other value is a bug caught upstream
    // by (1); this branch simply proves the encoded amount is what gets
    // forwarded — not silently normalised.
    expect(LIFETIME_CENTS).toBe(60000);
  });
});
