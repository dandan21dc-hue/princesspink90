import { generateWaiverPdf } from "@/lib/waiver-pdf.functions";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

export function useWaiverPdfDownload() {
  const gen = useServerFn(generateWaiverPdf);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const download = async (rsvpId: string) => {
    setPendingId(rsvpId);
    try {
      const { base64, filename, contentType } = await gen({ data: { rsvpId } });
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (e) {
      toast.error((e as Error).message ?? "Could not generate waiver PDF.");
    } finally {
      setPendingId(null);
    }
  };

  return { download, pendingId, isPending: (id: string) => pendingId === id };
}
