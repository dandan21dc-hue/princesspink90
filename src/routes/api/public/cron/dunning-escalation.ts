/**
 * Daily cron: walks dunning_schedule for rows whose next_email_at has
 * passed, sends the next escalation email, and either advances the stage
 * (day_3 → day_7 → day_14) or marks it done. Called by pg_cron via
 * net.http_post with the anon `apikey` header — `/api/public/*` bypasses
 * auth on published sites; the anon key adds an extra check.
 */
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendAppEmail } from "@/lib/send-app-email.server";
import { PaymentFailedRetryEmail } from "@/lib/email-templates/payment-failed-retry";
import { PaymentFailedUrgentEmail } from "@/lib/email-templates/payment-failed-urgent";
import { PaymentFailedFinalEmail } from "@/lib/email-templates/payment-failed-final";

const SITE_NAME = "Princess Pink";
const SITE_URL = "https://princesspink90.lovable.app";
const BILLING_URL = `${SITE_URL}/account/billing`;
const FROM = "Princess Pink <notify@princesspink90.lovable.app>";

type Stage = "day_3" | "day_7" | "day_14" | "done" | "canceled";
const NEXT_STAGE: Record<Stage, { stage: Stage; hours: number } | null> = {
  day_3: { stage: "day_7", hours: 96 },   // +4 days
  day_7: { stage: "day_14", hours: 168 }, // +7 days
  day_14: { stage: "done", hours: 0 },
  done: null,
  canceled: null,
};

async function processDunning() {
  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await (supabase as any)
    .from("dunning_schedule")
    .select("id,user_id,stripe_invoice_id,stripe_subscription_id,environment,stage,next_email_at")
    .lte("next_email_at", nowIso)
    .not("stage", "in", "(done,canceled)")
    .limit(100);
  if (error) throw new Error(error.message);
  if (!rows?.length) return { processed: 0 };

  let processed = 0;
  for (const row of rows) {
    // Fetch the recipient email
    const { data: userInfo } = await (supabase as any).auth.admin.getUserById(row.user_id);
    const email = userInfo?.user?.email;
    if (!email) {
      await (supabase as any).from("dunning_schedule").update({
        stage: "canceled", updated_at: nowIso,
      }).eq("id", row.id);
      continue;
    }

    const stage = row.stage as Stage;
    let subject = "";
    let react: React.ReactElement | null = null;
    if (stage === "day_3") {
      subject = "Your last payment didn't go through";
      react = React.createElement(PaymentFailedRetryEmail, {
        siteName: SITE_NAME, siteUrl: SITE_URL, billingUrl: BILLING_URL,
      });
    } else if (stage === "day_7") {
      subject = "Second attempt on your card failed";
      react = React.createElement(PaymentFailedUrgentEmail, {
        siteName: SITE_NAME, siteUrl: SITE_URL, billingUrl: BILLING_URL,
      });
    } else if (stage === "day_14") {
      subject = "Final notice — your subscription is about to end";
      react = React.createElement(PaymentFailedFinalEmail, {
        siteName: SITE_NAME, siteUrl: SITE_URL, billingUrl: BILLING_URL,
      });
    } else {
      continue;
    }

    const sendResult = await sendAppEmail({ from: FROM, to: email, subject, react });
    if ("error" in sendResult) {
      console.error("dunning email send failed:", sendResult.error, row.id);
      continue;
    }

    const next = NEXT_STAGE[stage];
    const updates: any = {
      last_sent_stage: stage,
      last_sent_at: nowIso,
      updated_at: nowIso,
    };
    if (!next || next.stage === "done") {
      updates.stage = "done";
    } else {
      updates.stage = next.stage;
      updates.next_email_at = new Date(Date.now() + next.hours * 60 * 60 * 1000).toISOString();
    }
    await (supabase as any).from("dunning_schedule").update(updates).eq("id", row.id);
    processed++;
  }
  return { processed };
}

export const Route = createFileRoute("/api/public/cron/dunning-escalation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Shared secret pattern (same as purge-deleted-accounts) — the
        // publishable key is public bundle content and is NOT sufficient
        // auth for cron endpoints.
        const auth = request.headers.get("authorization") ?? "";
        const secret = process.env.ACCOUNT_PURGE_CRON_SECRET;
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await processDunning();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("dunning-escalation error:", e);
          return new Response("Error", { status: 500 });
        }
      },
    },
  },
});

