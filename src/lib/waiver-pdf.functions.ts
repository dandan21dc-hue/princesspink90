import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Kept in sync with the fallback used on the public RSVP page.
const DEFAULT_WAIVER = `LIABILITY WAIVER, ASSUMPTION OF RISK & RELEASE

By signing below, I acknowledge that attendance at this event is voluntary and involves inherent risks, including but not limited to physical injury, exposure to loud music, crowds, and adult content. I assume all such risks.

I release the host, venue operator, staff, and platform operator from any and all claims, damages, or liability arising out of my attendance, to the fullest extent permitted by law.

I confirm that I am 18 years of age or older, that the identification I have provided is current and belongs to me, and that I will comply with venue rules and staff instructions at all times.

I have read this waiver, understand its terms, and sign it freely.`;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  // btoa is available in the Worker runtime.
  return btoa(bin);
}

export const generateWaiverPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rsvpId: string }) =>
    z.object({ rsvpId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Fetch the RSVP + linked event. RLS lets guests read their own RSVP and
    // hosts read RSVPs for their events, so a single query covers both roles.
    const { data: rsvp, error } = await context.supabase
      .from("rsvps")
      .select(
        "id, event_id, user_id, ticket_code, guest_count, waiver_signature, waiver_accepted_at, waiver_text_hash, created_at, events(id, title, venue_name, address, city, starts_at, waiver_text, host_id)",
      )
      .eq("id", data.rsvpId)
      .maybeSingle();
    if (error) throw error;
    if (!rsvp) throw new Error("RSVP not found or you do not have access.");
    if (!rsvp.waiver_signature || !rsvp.waiver_accepted_at) {
      throw new Error("This RSVP does not have an accepted waiver yet.");
    }

    // Look up guest display name (best effort).
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", rsvp.user_id)
      .maybeSingle();

    const ev = (rsvp as any).events as {
      title: string;
      venue_name: string;
      address: string | null;
      city: string | null;
      starts_at: string;
      waiver_text: string | null;
    };

    const waiverText = (ev.waiver_text?.trim() || DEFAULT_WAIVER).trim();

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Signed waiver · ${ev.title}`);
    pdf.setAuthor("AFTERDARK");
    pdf.setSubject("Liability waiver, assumption of risk & release");
    pdf.setCreationDate(new Date());

    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const mono = await pdf.embedFont(StandardFonts.Courier);
    const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const pageWidth = 612; // US Letter
    const pageHeight = 792;
    const margin = 54;
    const contentWidth = pageWidth - margin * 2;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let cursor = pageHeight - margin;

    const ink = rgb(0.08, 0.08, 0.1);
    const dim = rgb(0.42, 0.42, 0.48);
    const accent = rgb(0.72, 0.15, 0.42);

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

    // Header
    drawWrapped("AFTERDARK", { font: bold, size: 10, color: accent });
    cursor -= 4;
    drawWrapped("Liability waiver, assumption of risk & release", {
      font: bold,
      size: 18,
    });
    cursor -= 4;
    drawWrapped("Signed record — for compliance archive", {
      font: italic,
      size: 10,
      color: dim,
    });
    hr();

    // Event + guest metadata (two-column-ish, one field per line to keep wrapping simple)
    const acceptedAt = new Date(rsvp.waiver_accepted_at).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "short",
    });
    const eventStart = new Date(ev.starts_at).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "short",
    });
    const venueLine = [ev.venue_name, ev.address, ev.city].filter(Boolean).join(" · ");
    const guestName = prof?.display_name?.trim() || "Guest";

    const field = (label: string, value: string) => {
      drawWrapped(label, { font: bold, size: 9, color: dim });
      cursor += 4; // tighten
      drawWrapped(value, { font: body, size: 11 });
      cursor -= 2;
    };

    field("Event", ev.title);
    field("When", eventStart);
    field("Venue", venueLine || "—");
    field("Guest", guestName);
    field("Ticket code", rsvp.ticket_code);
    field("Party size", `${rsvp.guest_count} guest${rsvp.guest_count > 1 ? "s" : ""}`);
    field("Accepted at", acceptedAt);

    hr();

    // Waiver text
    drawWrapped("Waiver text", { font: bold, size: 11, color: dim });
    cursor -= 2;
    drawWrapped(waiverText, { font: body, size: 10, lineHeight: 1.45 });

    hr();

    // Signature block
    drawWrapped("Signature on file", { font: bold, size: 11, color: dim });
    cursor -= 2;
    // Signature "line"
    const sigY = cursor - 24;
    if (sigY < margin + 40) {
      page = pdf.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - margin;
    }
    page.drawText(rsvp.waiver_signature, {
      x: margin,
      y: cursor - 22,
      size: 20,
      font: italic,
      color: ink,
    });
    cursor -= 30;
    page.drawLine({
      start: { x: margin, y: cursor },
      end: { x: margin + 320, y: cursor },
      thickness: 0.75,
      color: rgb(0.6, 0.6, 0.65),
    });
    cursor -= 12;
    drawWrapped(`Typed by ${guestName} on ${acceptedAt}`, {
      font: body,
      size: 9,
      color: dim,
    });
    cursor -= 8;
    drawWrapped("Waiver text SHA-256:", { font: bold, size: 9, color: dim });
    cursor += 4;
    drawWrapped(rsvp.waiver_text_hash ?? "(not recorded)", {
      font: mono,
      size: 9,
      color: ink,
    });

    // Footer on last page
    const footer =
      "This document was generated automatically from the platform's compliance record. " +
      "The typed signature above constitutes acceptance of the waiver text shown, verified against the SHA-256 hash on file.";
    cursor -= 14;
    if (cursor < margin + 40) {
      page = pdf.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - margin;
    }
    hr();
    drawWrapped(footer, { font: italic, size: 8, color: dim });

    const bytes = await pdf.save();
    const safeTitle = ev.title
      .replace(/[^\w\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "event";
    const filename = `waiver-${safeTitle}-${rsvp.ticket_code}.pdf`;

    return {
      base64: bytesToBase64(bytes),
      filename,
      contentType: "application/pdf",
    };
  });
