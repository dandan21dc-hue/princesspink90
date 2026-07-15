import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const findingSchema = z.object({
  internal_id: z.string().min(1).max(200),
  scanner_name: z.string().max(200).default(""),
  name: z.string().max(500).default(""),
  category: z.string().max(200).default(""),
  level: z.string().max(50).default(""),
  state: z.string().max(50).default(""),
  description: z.string().max(20000).default(""),
  details: z.string().max(20000).default(""),
});

const createScanInput = z.object({
  note: z.string().max(500).optional(),
  findings: z.array(findingSchema).max(2000),
});

async function assertAdmin(
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => PromiseLike<{ data: boolean | null; error: { message: string } | null }> },
  userId: string,
) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error("Failed to verify admin role");
  if (!data) throw new Error("Admin access required");
}

export const listSecurityScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("security_scans")
      .select("id, scanned_at, note, finding_count, created_by")
      .order("scanned_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSecurityScanFindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("security_scan_findings")
      .select(
        "id, scan_id, scanned_at, internal_id, scanner_name, name, category, level, state, description, details",
      )
      .order("scanned_at", { ascending: false })
      .limit(10000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSecurityScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createScanInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: scan, error: scanError } = await context.supabase
      .from("security_scans")
      .insert({
        created_by: context.userId,
        note: data.note ?? null,
        finding_count: data.findings.length,
      })
      .select("id, scanned_at")
      .single();
    if (scanError || !scan) throw new Error(scanError?.message ?? "Failed to create scan");

    if (data.findings.length > 0) {
      const rows = data.findings.map((f) => ({
        scan_id: scan.id,
        scanned_at: scan.scanned_at,
        internal_id: f.internal_id,
        scanner_name: f.scanner_name,
        name: f.name,
        category: f.category,
        level: f.level,
        state: f.state,
        description: f.description,
        details: f.details,
      }));
      const { error: rowsError } = await context.supabase
        .from("security_scan_findings")
        .insert(rows);
      if (rowsError) {
        await context.supabase.from("security_scans").delete().eq("id", scan.id);
        throw new Error(rowsError.message);
      }
    }
    return { id: scan.id, scanned_at: scan.scanned_at };
  });

export const deleteSecurityScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("security_scans")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
