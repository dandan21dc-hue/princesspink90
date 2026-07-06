/**
 * Minimal Resend send helper for app-triggered emails (dunning, trial
 * ending). Renders a React Email component to HTML and POSTs through the
 * Lovable connector gateway. Server-only.
 */
import { render } from "@react-email/render";
import type { ReactElement } from "react";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export async function sendAppEmail(opts: {
  from: string;
  to: string;
  subject: string;
  react: ReactElement;
}): Promise<{ id: string } | { error: string }> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" };
  if (!LOVABLE_API_KEY) return { error: "LOVABLE_API_KEY not configured" };

  const html = await render(opts.react);

  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": RESEND_API_KEY,
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html,
    }),
  });

  const body = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) {
    return { error: body?.message ?? `Resend error ${response.status}` };
  }
  return { id: body?.id ?? "" };
}
