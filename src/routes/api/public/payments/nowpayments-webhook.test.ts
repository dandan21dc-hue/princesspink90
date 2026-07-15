import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin BEFORE importing the webhook module. The webhook loads
// it via dynamic import inside processIpn, so vi.mock's hoisting still applies.
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client.server", () => {
  const ledger = new Map<string, { handled: boolean; reason: string | null; received_count: number }>();
  const from = (table: string) => {
    if (table !== "nowpayments_ipn_events") {
      throw new Error(`unexpected table: ${table}`);
    }
    let pendingInsert: { payment_id: string } | null = null;
    let pendingPid: string | null = null;
    const api = {
      insert(row: { payment_id: string }) { pendingInsert = row; return api; },
      update(_patch: unknown) { return api; },
      select(_cols?: string) { return api; },
      eq(_col: string, val: string) { pendingPid = val; return api; },
      maybeSingle: () => {
        if (pendingInsert) {
          const pid = pendingInsert.payment_id;
          if (ledger.has(pid)) {
            return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } });
          }
          ledger.set(pid, { handled: false, reason: null, received_count: 1 });
          return Promise.resolve({ data: { payment_id: pid }, error: null });
        }
        const row = pendingPid ? ledger.get(pendingPid) ?? null : null;
        return Promise.resolve({ data: row, error: null });
      },
      then: (resolve: (v: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return api;
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
