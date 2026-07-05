import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TestReminderResult = {
  ok: boolean;
  recipient_email: string;
  sent_at: string;
  message_id: string;
  template: string;
  error?: string | null;
};

/**
 * Admin-only diagnostic: sends a single health-screening reminder email to
 * the caller's own address using the real Resend send path + email_send_log
 * insert. Deliberately does NOT touch health_screening_reminder_log so it
 * cannot interfere with the production cron's idempotency keys.
 */
export const sendTestReminderEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TestReminderResult> => {
    // 1. Admin gate.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc(
      "has_role",
      { _user_id: context.userId, _role: "admin" },
    );
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    // 2. Resolve caller's email from the auth session.
    const email =
      (context.claims?.email as string | undefined) ??
      (context.claims?.user_metadata?.email as string | undefined) ??
      null;
    if (!email) throw new Error("No email on the current session");

    // 3. Render + send via the same helpers the cron uses.
    const [{ sendResendEmail }, { renderHealthScreeningReminder }, { supabaseAdmin }] =
      await Promise.all([
        import("@/lib/resend.server"),
        import("@/lib/email-templates-resend/health-screening-reminder"),
        import("@/integrations/supabase/client.server"),
      ]);

    const today = new Date();
    const validUntil = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const tmpl = renderHealthScreeningReminder({
      recipientName: "Admin (test)",
      validUntil,
      daysUntilExpiry: 7,
      portalUrl: "https://app.princesspink90.com/health-screenings?utm_source=admin_test",
      status: "approved",
      testDate: today.toISOString().slice(0, 10),
    });

    const messageId = `admin-test-reminder:${context.userId}:${Date.now()}`;
    const subject = `[TEST] ${tmpl.subject}`;

    const result = await sendResendEmail({
      to: email,
      subject,
      html: tmpl.html,
      text: tmpl.text,
      idempotencyKey: messageId,
      tags: [
        { name: "template", value: "health_screening_expiry_7_day" },
        { name: "trigger", value: "admin_test" },
      ],
    });

    // 4. Log to email_send_log so the go-live view + email delivery admin
    //    surface can see the test send. Uses the admin client because
    //    email_send_log inserts are gated to service role.
    const sentAt = new Date().toISOString();
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "health_screening_expiry_7_day",
      recipient_email: email,
      status: result.ok ? "sent" : "failed",
      error_message: result.ok ? null : result.error?.slice(0, 1000) ?? null,
    });

    if (!result.ok) {
      return {
        ok: false,
        recipient_email: email,
        sent_at: sentAt,
        message_id: messageId,
        template: "health_screening_expiry_7_day",
        error: result.error ?? "Send failed",
      };
    }

    return {
      ok: true,
      recipient_email: email,
      sent_at: sentAt,
      message_id: messageId,
      template: "health_screening_expiry_7_day",
      error: null,
    };
  });
