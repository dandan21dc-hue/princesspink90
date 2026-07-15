import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "compliance-archives";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

/**
 * Build a simple, professional PDF containing the waiver / policy text,
 * the user's ID, and the acceptance timestamp. Returns the raw bytes.
 */
async function buildCompliancePdf(args: {
  userId: string;
  displayName: string | null;
  policyVersion: string;
  policySummary: string | null;
  policyBody: string;
  acceptedAtIso: string;
  agreementId: string;
  ipAddress: string | null;
  userAgent: string | null;
  eventTitle: string | null;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Compliance agreement · v${args.policyVersion}`);
  pdf.setAuthor("AFTERDARK");
  pdf.setSubject("Signed compliance / conduct waiver — archive copy");
  pdf.setCreationDate(new Date());

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const contentWidth = pageWidth - margin * 2;
  const ink = rgb(0.08, 0.08, 0.1);
  const dim = rgb(0.42, 0.42, 0.48);
  const accent = rgb(0.72, 0.15, 0.42);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;

  const drawWrapped = (
    text: string,
    opts: { font: any; size: number; color?: any; lineHeight?: number },
  ) => {
    const { font, size, color = ink, lineHeight = 1.35 } = opts;
    const lh = size * lineHeight;
    const paragraphs = text.split(/\n/);
    for (const para of paragraphs) {
      if (para.trim() === "") {
        cursor -= lh * 0.7;
        continue;
      }
      const words = para.split(/\s+/);
      let line = "";
      for (const word of words) {
        const attempt = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(attempt, size) <= contentWidth) {
          line = attempt;
        } else {
          if (cursor < margin + lh) {
            page = pdf.addPage([pageWidth, pageHeight]);
            cursor = pageHeight - margin;
          }
          page.drawText(line, { x: margin, y: cursor - size, size, font, color });
          cursor -= lh;
          line = word;
        }
      }
      if (line) {
        if (cursor < margin + lh) {
          page = pdf.addPage([pageWidth, pageHeight]);
          cursor = pageHeight - margin;
        }
        page.drawText(line, { x: margin, y: cursor - size, size, font, color });
        cursor -= lh;
      }
    }
  };

  const hr = () => {
    cursor -= 6;
    page.drawLine({
      start: { x: margin, y: cursor },
      end: { x: pageWidth - margin, y: cursor },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.9),
    });
    cursor -= 10;
  };

  drawWrapped("AFTERDARK", { font: bold, size: 10, color: accent });
  cursor -= 4;
  drawWrapped("Compliance & Conduct Waiver", { font: bold, size: 18 });
  cursor -= 4;
  drawWrapped("Signed record — for compliance archive", {
    font: italic,
    size: 10,
    color: dim,
  });
  hr();

  const acceptedAt = new Date(args.acceptedAtIso).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });

  const field = (label: string, value: string, opts?: { fontFam?: any }) => {
    drawWrapped(label, { font: bold, size: 9, color: dim });
    cursor += 4;
    drawWrapped(value, { font: opts?.fontFam ?? body, size: 11 });
    cursor -= 2;
  };

  field("Signed by", args.displayName?.trim() || "Member");
  field("User ID", args.userId, { fontFam: mono });
  field("Policy version", `v${args.policyVersion}`);
  if (args.eventTitle) field("Event", args.eventTitle);
  field("Accepted at", acceptedAt);
  field("Agreement ID", args.agreementId, { fontFam: mono });
  if (args.ipAddress) field("IP address", args.ipAddress, { fontFam: mono });
  if (args.userAgent) field("User agent", args.userAgent);

  hr();

  if (args.policySummary) {
    drawWrapped("Summary", { font: bold, size: 11, color: dim });
    cursor -= 2;
    drawWrapped(args.policySummary, { font: body, size: 10, lineHeight: 1.45 });
    cursor -= 6;
  }

  drawWrapped("Policy text", { font: bold, size: 11, color: dim });
  cursor -= 2;
  drawWrapped(args.policyBody, { font: body, size: 10, lineHeight: 1.45 });

  hr();
  drawWrapped(
    "This document was generated automatically from the platform's compliance record at the moment of acceptance. It is stored in a private archive and can be produced on request as evidence of consent.",
    { font: italic, size: 8, color: dim },
  );

  return await pdf.save();
}

function safeFileName(input: string, fallback = "agreement"): string {
  const trimmed = (input ?? "")
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return trimmed || fallback;
}

/**
 * Generate a signed-waiver PDF for a compliance_policy_agreements row and
 * upload it to the private compliance-archives bucket. Idempotent — if
 * the row already has archive_path, returns it unchanged. Never throws
 * on generation failure; logs and returns null so the acceptance flow
 * never breaks over an archiving problem.
 */
export async function archiveComplianceAgreement(
  agreementId: string,
): Promise<{ path: string | null; regenerated: boolean }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: agreement, error: agErr } = await supabaseAdmin
      .from("compliance_policy_agreements")
      .select(
        "id, accepted_by_user_id, policy_version_id, policy_version_label, event_id, accepted_at, ip_address, user_agent, archive_path",
      )
      .eq("id", agreementId)
      .maybeSingle();
    if (agErr || !agreement) {
      console.warn("archiveComplianceAgreement: agreement not found", { agreementId, agErr });
      return { path: null, regenerated: false };
    }
    if (agreement.archive_path) {
      return { path: agreement.archive_path as string, regenerated: false };
    }

    const [pvRes, profileRes, eventRes] = await Promise.all([
      supabaseAdmin
        .from("compliance_policy_versions")
        .select("version, summary, body")
        .eq("id", (agreement as any).policy_version_id)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("user_id", (agreement as any).accepted_by_user_id)
        .maybeSingle(),
      (agreement as any).event_id
        ? supabaseAdmin
            .from("events")
            .select("title")
            .eq("id", (agreement as any).event_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (pvRes.error || !pvRes.data) {
      console.warn("archiveComplianceAgreement: policy version missing", pvRes.error);
      return { path: null, regenerated: false };
    }

    const bytes = await buildCompliancePdf({
      userId: (agreement as any).accepted_by_user_id,
      displayName: (profileRes.data as any)?.display_name ?? null,
      policyVersion: (pvRes.data as any).version,
      policySummary: (pvRes.data as any).summary ?? null,
      policyBody: (pvRes.data as any).body ?? "",
      acceptedAtIso: (agreement as any).accepted_at,
      agreementId: agreement.id as string,
      ipAddress: (agreement as any).ip_address ?? null,
      userAgent: (agreement as any).user_agent ?? null,
      eventTitle: (eventRes.data as any)?.title ?? null,
    });

    const version = safeFileName((pvRes.data as any).version, "v");
    const path = `${(agreement as any).accepted_by_user_id}/${agreement.id}-v${version}.pdf`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) {
      console.error("archiveComplianceAgreement: upload failed", upErr);
      return { path: null, regenerated: false };
    }

    const { error: updErr } = await supabaseAdmin
      .from("compliance_policy_agreements")
      .update({ archive_path: path })
      .eq("id", agreement.id);
    if (updErr) {
      console.warn("archiveComplianceAgreement: could not persist archive_path", updErr);
    }

    return { path, regenerated: true };
  } catch (err) {
    console.error("archiveComplianceAgreement: unexpected failure", err);
    return { path: null, regenerated: false };
  }
}

// ─── Admin server functions ──────────────────────────────────────────────

export const listUserComplianceArchives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("compliance_policy_agreements")
      .select(
        "id, policy_version_id, policy_version_label, event_id, accepted_at, archive_path",
      )
      .eq("accepted_by_user_id", data.user_id)
      .order("accepted_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      policy_version_id: string;
      policy_version_label: string | null;
      event_id: string | null;
      accepted_at: string;
      archive_path: string | null;
    }>;
  });

export const getUserComplianceArchiveDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; agreement_id?: string | null }) =>
    z.object({
      user_id: z.string().uuid(),
      agreement_id: z.string().uuid().optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pick the agreement: explicit id if given, else latest for the user.
    let query = supabaseAdmin
      .from("compliance_policy_agreements")
      .select("id, archive_path, policy_version_label, accepted_at")
      .eq("accepted_by_user_id", data.user_id)
      .order("accepted_at", { ascending: false })
      .limit(1);
    if (data.agreement_id) {
      query = supabaseAdmin
        .from("compliance_policy_agreements")
        .select("id, archive_path, policy_version_label, accepted_at")
        .eq("id", data.agreement_id)
        .eq("accepted_by_user_id", data.user_id)
        .limit(1);
    }
    const { data: rows, error } = await query;
    if (error) throw error;
    const agreement = (rows ?? [])[0] as
      | { id: string; archive_path: string | null; policy_version_label: string | null; accepted_at: string }
      | undefined;
    if (!agreement) throw new Error("No signed compliance agreement found for this user.");

    // Regenerate on the fly if missing (older agreements from before archiving existed).
    let path = agreement.archive_path;
    if (!path) {
      const res = await archiveComplianceAgreement(agreement.id);
      path = res.path;
    }
    if (!path) throw new Error("Could not produce a signed PDF for this agreement.");

    const { data: signed, error: sigErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 5, {
        download: `compliance-${data.user_id}-v${agreement.policy_version_label ?? "current"}.pdf`,
      });
    if (sigErr || !signed?.signedUrl) {
      throw new Error(sigErr?.message ?? "Failed to create download link");
    }

    return {
      url: signed.signedUrl,
      agreement_id: agreement.id,
      policy_version_label: agreement.policy_version_label,
      accepted_at: agreement.accepted_at,
    };
  });
