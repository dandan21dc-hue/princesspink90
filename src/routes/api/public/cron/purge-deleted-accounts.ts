import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily cron endpoint that permanently purges accounts whose 30-day
 * soft-delete window has elapsed. Protected by a shared secret in
 * `ACCOUNT_PURGE_CRON_SECRET`, sent as `Authorization: Bearer <secret>`.
 *
 * Suggested pg_cron schedule (installed manually once):
 *
 *   select cron.schedule(
 *     'purge-deleted-accounts',
 *     '15 3 * * *',
 *     $$ select net.http_post(
 *          url := 'https://project--<id>.lovable.app/api/public/cron/purge-deleted-accounts',
 *          headers := jsonb_build_object('Authorization', 'Bearer ' || (
 *            select decrypted_secret from vault.decrypted_secrets
 *            where name = 'account_purge_cron_secret'))
 *        ); $$
 *   );
 */
export const Route = createFileRoute("/api/public/cron/purge-deleted-accounts")({
  server: {
    handlers: {
      POST: async ({ request }) => runPurge(request),
      GET: async ({ request }) => runPurge(request),
    },
  },
});

async function runPurge(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.ACCOUNT_PURGE_CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("list_accounts_to_purge");
    if (error) throw error;
    let purged = 0;
    for (const row of (rows ?? []) as Array<{ user_id: string }>) {
      const { error: rowErr } = await supabaseAdmin.rpc("purge_account_rows", {
        _user_id: row.user_id,
      });
      if (rowErr) {
        console.error("purge_account_rows failed for", row.user_id, rowErr);
        continue;
      }
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(row.user_id);
      if (delErr) {
        console.error("auth.admin.deleteUser failed for", row.user_id, delErr);
        continue;
      }
      purged += 1;
    }
    return Response.json({ ok: true, purged });
  } catch (err) {
    console.error("purge cron error:", err);
    return new Response("Purge error", { status: 500 });
  }
}
