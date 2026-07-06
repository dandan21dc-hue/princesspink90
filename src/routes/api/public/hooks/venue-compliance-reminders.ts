import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { checkHooksCronAuth } from '@/lib/hooks-auth.server'

// Daily job: finds venue compliance documents (insurance certs, permits)
// expiring within the next 30 days and sends exactly one reminder per document.
//
// Auth: `Authorization: Bearer <HOOKS_CRON_SECRET>` (server-only secret).

const KIND_LABEL: Record<string, string> = {
  public_liability_insurance: 'Public liability insurance',
  event_permit: 'Event permit',
  other: 'Compliance document',
}

export const Route = createFileRoute('/api/public/hooks/venue-compliance-reminders')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = checkHooksCronAuth(request)
        if (unauth) return unauth

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        )

        // Today (UTC) through +30 days inclusive.
        const today = new Date()
        const start = today.toISOString().slice(0, 10)
        const end = new Date(today)
        end.setUTCDate(end.getUTCDate() + 30)
        const endDate = end.toISOString().slice(0, 10)

        const { data: candidates, error: selErr } = await supabase
          .from('venue_compliance_documents')
          .select('id, kind, title, issuer, reference_number, expires_on')
          .not('expires_on', 'is', null)
          .gte('expires_on', start)
          .lte('expires_on', endDate)
          .is('expiry_reminder_sent_at', null)

        if (selErr) {
          console.error('[venue-compliance-reminders] select failed', selErr)
          return new Response(JSON.stringify({ error: selErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Resolve admin recipients once per run.
        const { data: adminRoles, error: adminErr } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin')
        if (adminErr) {
          console.error('[venue-compliance-reminders] admin lookup failed', adminErr)
          return new Response(JSON.stringify({ error: adminErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const adminIds = (adminRoles ?? []).map((r) => r.user_id)

        let sent = 0
        let skipped = 0
        const failures: Array<{ id: string; error: string }> = []

        for (const row of candidates ?? []) {
          const idempotencyKey = `expiry_30_day:${row.id}:${row.expires_on}`
          const channels: string[] = ['in_app']
          const daysUntil = Math.max(
            0,
            Math.round(
              (new Date(row.expires_on as string).getTime() -
                new Date(start).getTime()) /
                86_400_000,
            ),
          )
          const kindLabel = KIND_LABEL[row.kind] ?? 'Compliance document'

          // 1) Claim via unique log insert.
          const { data: logRow, error: logErr } = await supabase
            .from('venue_compliance_reminder_log')
            .insert({
              document_id: row.id,
              kind: row.kind,
              reminder_type: 'expiry_30_day',
              expires_on: row.expires_on,
              recipients: adminIds,
              channels,
              status: 'sent',
              idempotency_key: idempotencyKey,
            })
            .select('id')
            .single()

          if (logErr) {
            const code = (logErr as { code?: string }).code
            if (code === '23505') {
              skipped += 1
              continue
            }
            failures.push({ id: row.id, error: logErr.message })
            continue
          }

          // 2) Fan out in-app notifications to all admins.
          const notifRows = adminIds.map((uid) => ({
            user_id: uid,
            kind: 'venue_compliance_expiring',
            title: `${kindLabel} expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
            body: `${row.title}${row.issuer ? ` (${row.issuer})` : ''} expires on ${row.expires_on}. Please upload a renewed copy before it lapses.`,
            link_url: '/venue-compliance',
            metadata: {
              document_id: row.id,
              kind: row.kind,
              expires_on: row.expires_on,
              days_until_expiry: daysUntil,
              idempotency_key: idempotencyKey,
            },
          }))

          const notifResult =
            notifRows.length > 0
              ? await supabase.from('notifications').insert(notifRows)
              : { error: null as null | { message: string } }

          if (notifResult.error) {
            const { computeNextRetryAt } = await import('@/lib/reminder-retry')
            await supabase
              .from('venue_compliance_reminder_log')
              .update({
                status: 'failed',
                error_message: notifResult.error.message,
                last_attempt_at: new Date().toISOString(),
                next_retry_at: computeNextRetryAt(1)?.toISOString() ?? null,
              })
              .eq('id', logRow.id)
            failures.push({ id: row.id, error: notifResult.error.message })
            continue
          }

          // 3) Flip marker so future scans skip fast.
          await supabase
            .from('venue_compliance_documents')
            .update({ expiry_reminder_sent_at: new Date().toISOString() })
            .eq('id', row.id)

          sent += 1
        }

        return new Response(
          JSON.stringify({
            success: true,
            window: { start, end: endDate },
            candidates: candidates?.length ?? 0,
            admins_notified: adminIds.length,
            sent,
            skipped,
            failures,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
