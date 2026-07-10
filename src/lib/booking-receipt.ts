import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { format } from "date-fns";

export type BookingReceiptInput = {
  bookingId: string;
  status: string;
  starts: Date;
  ends: Date;
  durationMinutes: number;
  partySize: number;
  amountFormatted: string | null;
  notes?: string | null;
};

export async function buildBookingReceiptPdf(input: BookingReceiptInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pink = rgb(0.93, 0.32, 0.6);
  const ink = rgb(0.09, 0.09, 0.12);
  const muted = rgb(0.42, 0.42, 0.48);

  let y = 790;
  page.drawText("MIDNIGHT GLORY", { x: 48, y, size: 10, font: bold, color: pink });
  y -= 14;
  page.drawText("Booking receipt", { x: 48, y, size: 22, font: bold, color: ink });

  y -= 36;
  page.drawRectangle({ x: 48, y: y - 4, width: 499, height: 1, color: rgb(0.9, 0.9, 0.92) });

  y -= 28;
  page.drawText(
    input.durationMinutes === 30 ? "30-minute private room session" : "1-hour private room session",
    { x: 48, y, size: 14, font: bold, color: ink },
  );

  const row = (label: string, value: string) => {
    y -= 22;
    page.drawText(label, { x: 48, y, size: 10, font, color: muted });
    page.drawText(value, { x: 220, y, size: 11, font: bold, color: ink });
  };

  y -= 12;
  row("Booking ID", input.bookingId);
  row("Status", input.status.toUpperCase());
  row("Date", format(input.starts, "EEEE, d MMMM yyyy"));
  row("Time", `${format(input.starts, "h:mm a")} – ${format(input.ends, "h:mm a")}`);
  row("Duration", `${input.durationMinutes} minutes`);
  row("Party size", `${input.partySize} ${input.partySize === 1 ? "guest" : "guests"}`);
  if (input.amountFormatted) row("Amount paid", input.amountFormatted);

  if (input.notes) {
    y -= 28;
    page.drawText("Notes", { x: 48, y, size: 10, font, color: muted });
    const lines = wrap(input.notes, 80);
    for (const line of lines) {
      y -= 14;
      page.drawText(line, { x: 48, y, size: 10, font, color: ink });
    }
  }

  y -= 40;
  page.drawRectangle({ x: 48, y: y - 4, width: 499, height: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 20;
  page.drawText(
    `Receipt generated ${format(new Date(), "d MMM yyyy, h:mm a")}`,
    { x: 48, y, size: 9, font, color: muted },
  );
  y -= 14;
  page.drawText("Thank you for booking with Midnight Glory.", { x: 48, y, size: 9, font, color: muted });

  return await doc.save();
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > width) {
        if (line) out.push(line);
        line = w;
      } else {
        line = (line ? line + " " : "") + w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function downloadPdf(filename: string, bytes: Uint8Array) {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const blob = new Blob([buf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
