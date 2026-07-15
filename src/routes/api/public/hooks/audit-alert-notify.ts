import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { enqueueTemplateEmail } from '@/lib/email/enqueue.server'

// Called by the AFTER INSERT trigger on public.admin_activity_audit_alerts
// (see migration notify_admin_activity_audit_alert). Sends ONE admin email
// per alert row and stamps notified_at so retries are idempotent.
//
// Auth: `Authorization: Bearer <admin_audit_alert_webhook_secret>` — a
// per-project random value stored in Postgres vault.

const REVIEW_URL =
  'https://princesspink90.com/admin/activity-audit'

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    db: { schema: 'public' },
  })
}

export const Route = createFileRoute('/api/public/hooks/audit-alert-notify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = getServiceClient()
        if (!supabase) return json({ error: 'server_misconfigured' }, 500)

        // Read the expected secret from vault via a service-role RPC-free query.
        const { data: secretRow, error: secretErr } = await supabase
          .schema('vault' as never)
          .from('decrypted_secrets' as never)
          .select('decrypted_secret')
          .eq('name', 'admin_audit_alert_webhook_secret')
          .maybeSingle()

        if (secretErr || !secretRow) {
          console.error('audit-alert-notify: vault secret unavailable', secretErr)
          return json({ error: 'server_misconfigured' }, 500)
        }

        const expected = (secretRow as { decrypted_secret?: string }).decrypted_secret ?? ''
        const authHeader = request.headers.get('authorization') ?? ''
        const provided = authHeader.replace(/^Bearer\s+/i, '')
        if (!provided || !expected || !timingSafeEqual(provided, expected)) {
          return json({ error: 'unauthorized' }, 401)
        }

        let alertId: string | null = null
        try {
          const body = (await request.json()) as { alert_id?: unknown }
          if (typeof body.alert_id === 'string') alertId = body.alert_id
        } catch {
          return json({ error: 'invalid_body' }, 400)
        }
        if (!alertId) return json({ error: 'missing_alert_id' }, 400)

        const { data: alert, error: fetchErr } = await supabase
          .from('admin_activity_audit_alerts')
          .select('id, severity, kind, detail, detected_at, notified_at')
          .eq('id', alertId)
          .maybeSingle()

        if (fetchErr) {
          console.error('audit-alert-notify: fetch failed', fetchErr)
          return json({ error: 'fetch_failed' }, 500)
        }
        if (!alert) return json({ error: 'not_found' }, 404)
        if (alert.notified_at) {
          return json({ ok: true, skipped: 'already_notified' }, 200)
        }

        const detail = alert.detail as Record<string, unknown> | null
        const count =
          detail && typeof detail === 'object' && typeof detail['count'] === 'number'
            ? (detail['count'] as number)
            : undefined

        const result = await enqueueTemplateEmail({
          templateName: 'audit-alert',
          idempotencyKey: `audit-alert-${alert.id}`,
          templateData: {
            severity: alert.severity,
            kind: alert.kind,
            count,
            detectedAt: alert.detected_at,
            detailJson: detail ? JSON.stringify(detail, null, 2) : undefined,
            reviewUrl: REVIEW_URL,
          },
        })

        if (!result.success) {
          console.error('audit-alert-notify: enqueue failed', {
            alertId: alert.id,
            reason: result.reason,
          })
          return json({ error: 'enqueue_failed', reason: result.reason }, 502)
        }

        const { error: markErr } = await supabase
          .from('admin_activity_audit_alerts')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', alert.id)
          .is('notified_at', null)

        if (markErr) {
          // Email was enqueued; log but return success.
          console.warn('audit-alert-notify: notified_at mark failed', markErr)
        }

        return json({ ok: true, message_id: result.messageId }, 200)
      },
    },
  },
})
