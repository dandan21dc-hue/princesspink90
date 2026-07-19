import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin BEFORE importing the webhook module. The webhook loads
// it via dynamic import inside processIpn, so vi.mock's hoisting still applies.
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client.server", () => {
  type Row = {
    handled: boolean;
    reason: string | null;
    received_count: number;
    processed_at?: string | null;
  };
  type HistorySelectResult = {
    data: Array<{ last_status: string; handled: boolean; processed_at: string | null }>;
    error: null;
  };
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
        const filters: Record<string, string> = {};
        const notEqFilters: Record<string, string> = {};
        const entries = () =>
          [...ledger.entries()].map(([k, row]) => {
            const [payment_id, last_status] = k.split("|");
            return { payment_id, last_status, ...row };
          });
        const matches = (
          row: Record<string, unknown>,
          selectedFilters: Record<string, string>,
          comparator: "eq" | "neq",
        ) =>
          Object.entries(selectedFilters).every(([c, v]) =>
            comparator === "eq"
              ? String(row[c]) === v
              : String(row[c]) !== v,
          );
        const rd = {
          eq: (c: string, v: string) => { filters[c] = v; return rd; },
          neq: (c: string, v: string) => { notEqFilters[c] = v; return rd; },
          maybeSingle: () => Promise.resolve({
            data: ledger.get(keyOf(filters.payment_id, filters.last_status)) ?? null,
            error: null,
          }),
          then: <TResult1 = HistorySelectResult, TResult2 = never>(
            onfulfilled?:
              | ((value: HistorySelectResult) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?:
              | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
              | null,
          ): Promise<TResult1 | TResult2> => {
            const data = entries()
              .filter((row) => matches(row as Record<string, unknown>, filters, "eq"))
              .filter((row) => matches(row as Record<string, unknown>, notEqFilters, "neq"))
              .map((row) => ({
                last_status: row.last_status,
                handled: row.handled,
                processed_at: row.processed_at ?? null,
              }));
            return Promise.resolve({ data, error: null }).then(
              onfulfilled ?? undefined,
              onrejected ?? undefined,
            );
          },
        };
        return rd;
      },
      update(patch: Partial<Row> & Record<string, unknown>) {
        const filters: Record<string, string> = {};
        const upd = {
          eq: (c: string, v: string) => { filters[c] = v; return upd; },
          then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
            const row = ledger.get(keyOf(filters.payment_id, filters.last_status));
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return upd;
      },
    };
  };
  return { supabaseAdmin: { rpc: rpcMock, from } };
});

import { parseOrderId, processIpn } from "./nowpayments-webhook";

beforeEach(() => {
  rpcMock.mockClear();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("parseOrderId", () => {
  it("parses a well-formed aap30d order id", () => {
    expect(parseOrderId("aap30d:11111111-1111-1111-1111-111111111111:sandbox:1000")).toEqual({
      kind: "aap30d",
      userId: "11111111-1111-1111-1111-111111111111",
      environment: "sandbox",
      amountCents: 1000,
    });
  });

  it("rejects unknown kinds, bad uuids, bad envs, bad amounts, and undefined", () => {
    expect(parseOrderId(undefined)).toBeNull();
    expect(parseOrderId("foo:11111111-1111-1111-1111-111111111111:sandbox:1000")).toBeNull();
    expect(parseOrderId("aap30d:not-a-uuid:sandbox:1000")).toBeNull();
    expect(parseOrderId("aap30d:11111111-1111-1111-1111-111111111111:prod:1000")).toBeNull();
    expect(parseOrderId("aap30d:11111111-1111-1111-1111-111111111111:sandbox:-1")).toBeNull();
    expect(parseOrderId("aap30d:11111111-1111-1111-1111-111111111111:sandbox:abc")).toBeNull();
  });
});

describe("processIpn", () => {
  const validOrderId = "aap30d:11111111-1111-1111-1111-111111111111:sandbox:1000";

  it("ignores non-finished statuses without touching the RPC", async () => {
    const statuses = ["waiting", "confirming", "sending", "partially_paid", "failed"];
    for (const [i, status] of statuses.entries()) {
      const res = await processIpn({ payment_status: status, order_id: validOrderId, payment_id: 1000 + i });
      expect(res.handled).toBe(false);
      expect(res.reason).toBe(`ignored_status:${status}`);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects finished events with an unrecognised order_id", async () => {
    const res = await processIpn({ payment_status: "finished", order_id: "garbage", payment_id: 2001 });
    expect(res).toEqual({ handled: false, reason: "unrecognised_order_id" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects finished events with no payment_id", async () => {
    const res = await processIpn({ payment_status: "finished", order_id: validOrderId });
    expect(res).toEqual({ handled: false, reason: "missing_payment_id" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls grant_all_access_pass_30d with a namespaced payment reference on finished aap30d", async () => {
    const res = await processIpn({
      payment_status: "finished",
      order_id: validOrderId,
      payment_id: 987654,
    });
    expect(res.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("grant_all_access_pass_30d", {
      _user_id: "11111111-1111-1111-1111-111111111111",
      _environment: "sandbox",
      _amount_cents: 1000,
      _external_payment_reference: "nowpayments:987654",
    });
  });

  it("short-circuits on redelivered payment_id without re-invoking the RPC", async () => {
    const evt = { payment_status: "finished", order_id: validOrderId, payment_id: 3003 };
    const first = await processIpn(evt);
    expect(first.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const second = await processIpn(evt);
    expect(second).toMatchObject({ handled: true, duplicate: true });
    // No additional RPC call on redelivery.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the RPC fails so the webhook returns 5xx and NOWPayments retries", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(
      processIpn({ payment_status: "finished", order_id: validOrderId, payment_id: 4004 }),
    ).rejects.toThrow(/grant_all_access_pass_30d failed: db down/);
  });
});
