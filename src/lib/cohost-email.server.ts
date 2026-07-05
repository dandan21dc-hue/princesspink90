// Server-only helper to notify admins when a new co-host application is submitted.
// Uses Lovable Emails infrastructure when configured; safely no-ops otherwise.

export async function sendCohostApplicationAdminEmail(args: {
  adminEmails: string[];
  applicantName: string;
  applicantCity: string;
}) {
  const { adminEmails, applicantName, applicantCity } = args;
  if (adminEmails.length === 0) return;

  // The scaffolded transactional email route lives at /lovable/email/transactional/send.
  // If email infrastructure has not been set up yet, we simply log and return.
  const origin = process.env.PUBLIC_APP_URL ?? process.env.SITE_URL ?? "";
  const url = origin
    ? `${origin.replace(/\/$/, "")}/lovable/email/transactional/send`
    : "/lovable/email/transactional/send";

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  for (const email of adminEmails) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
        },
        body: JSON.stringify({
          templateName: "cohost-application-received",
          recipientEmail: email,
          idempotencyKey: `cohost-app-${applicantName}-${Date.now()}`,
          templateData: { applicantName, applicantCity },
        }),
      });
      if (!res.ok) {
        console.warn("[cohost-email] send failed", res.status, await res.text());
      }
    } catch (e) {
      console.warn("[cohost-email] send error", (e as Error).message);
    }
  }
}
