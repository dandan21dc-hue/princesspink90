import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RESEND_BASE = "https://api.resend.com";
export const RESEND_TARGET_DOMAIN = "princesspink90.com";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

export type ResendDnsRecord = {
  record: string; // SPF | DKIM | DMARC | MX (Resend labels)
  name: string;
  type: string; // TXT | CNAME | MX
  value: string;
  ttl?: string | number | null;
  priority?: number | null;
  status?: string | null; // verified | pending | failed | not_started
};

export type ResendDomainStatus = {
  configured: boolean; // RESEND_API_KEY present
  found: boolean; // domain exists in Resend
  id?: string | null;
  name?: string | null;
  status?: string | null; // pending | verified | failed | not_started | temporary_failure
  region?: string | null;
  createdAt?: string | null;
  records: ResendDnsRecord[];
  fetchedAt: string;
  error?: string | null;
};

// Admin-only: look up princesspink90.com in Resend and return its verification
// state plus the exact DNS records the user must paste at their registrar.
export const getResendDomainStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResendDomainStatus> => {
    await assertAdmin(context.supabase, context.userId);

    const apiKey = process.env.RESEND_API_KEY;
    const fetchedAt = new Date().toISOString();
    if (!apiKey) {
      return { configured: false, found: false, records: [], fetchedAt };
    }

    // 1) List domains and find ours by name.
    const listRes = await fetch(`${RESEND_BASE}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!listRes.ok) {
      return {
        configured: true,
        found: false,
        records: [],
        fetchedAt,
        error: `Resend list failed: HTTP ${listRes.status}`,
      };
    }
    const listBody = (await listRes.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name: string; status?: string; region?: string; created_at?: string }>;
    };
    const match = (listBody.data ?? []).find(
      (d) => d.name?.toLowerCase() === RESEND_TARGET_DOMAIN,
    );
    if (!match) {
      return { configured: true, found: false, records: [], fetchedAt };
    }

    // 2) Fetch full detail (records live on the single-domain endpoint).
    const detailRes = await fetch(`${RESEND_BASE}/domains/${match.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!detailRes.ok) {
      return {
        configured: true,
        found: true,
        id: match.id,
        name: match.name,
        status: match.status ?? null,
        region: match.region ?? null,
        createdAt: match.created_at ?? null,
        records: [],
        fetchedAt,
        error: `Resend detail failed: HTTP ${detailRes.status}`,
      };
    }
    const detail = (await detailRes.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      status?: string;
      region?: string;
      created_at?: string;
      records?: Array<{
        record?: string;
        name?: string;
        type?: string;
        value?: string;
        ttl?: string | number;
        priority?: number;
        status?: string;
      }>;
    };

    return {
      configured: true,
      found: true,
      id: detail.id ?? match.id,
      name: detail.name ?? match.name,
      status: detail.status ?? match.status ?? null,
      region: detail.region ?? match.region ?? null,
      createdAt: detail.created_at ?? match.created_at ?? null,
      records: (detail.records ?? []).map((r) => ({
        record: r.record ?? "",
        name: r.name ?? "",
        type: r.type ?? "",
        value: r.value ?? "",
        ttl: r.ttl ?? null,
        priority: r.priority ?? null,
        status: r.status ?? null,
      })),
      fetchedAt,
    };
  });

// Admin-only: trigger Resend to re-check DNS records for our domain.
export const verifyResendDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; error?: string }> => {
    await assertAdmin(context.supabase, context.userId);
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

    // Need the domain id first.
    const listRes = await fetch(`${RESEND_BASE}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!listRes.ok) return { ok: false, error: `HTTP ${listRes.status}` };
    const listBody = (await listRes.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name: string }>;
    };
    const match = (listBody.data ?? []).find(
      (d) => d.name?.toLowerCase() === RESEND_TARGET_DOMAIN,
    );
    if (!match) return { ok: false, error: "Domain not found in Resend" };

    const verifyRes = await fetch(`${RESEND_BASE}/domains/${match.id}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!verifyRes.ok) {
      const body = (await verifyRes.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: body.message ?? `HTTP ${verifyRes.status}` };
    }
    return { ok: true };
  });
