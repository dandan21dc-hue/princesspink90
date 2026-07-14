import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin BEFORE importing the webhook module. The webhook loads
// it via dynamic import inside processIpn, so vi.mock's hoisting still applies.
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: rpcMock },
}));

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

  it("ignores non-finished statuses without touching the DB", async () => {
    for (const status of ["waiting", "confirming", "sending", "partially_paid", "failed"]) {
      const res = await processIpn({ payment_status: status, order_id: validOrderId, payment_id: 1 });
      expect(res.handled).toBe(false);
      expect(res.reason).toBe(`ignored_status:${status}`);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects finished events with an unrecognised order_id", async () => {
    const res = await processIpn({ payment_status: "finished", order_id: "garbage", payment_id: 1 });
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
    expect(res).toEqual({ handled: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("grant_all_access_pass_30d", {
      _user_id: "11111111-1111-1111-1111-111111111111",
      _environment: "sandbox",
      _amount_cents: 1000,
      _external_payment_reference: "nowpayments:987654",
    });
  });

  it("throws when the RPC fails so the webhook returns 5xx and NOWPayments retries", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(
      processIpn({ payment_status: "finished", order_id: validOrderId, payment_id: 1 }),
    ).rejects.toThrow(/grant_all_access_pass_30d failed: db down/);
  });
});
