import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { readReminderJobConfig } from '@/lib/reminder-job-config.functions'
import { sendResendEmail } from '@/lib/resend.server'
import { renderHealthScreeningReminder } from '@/lib/email-templates-resend/health-screening-reminder'

// Daily job: finds admin-approved health screenings expiring in exactly 7 days
// and records exactly one reminder per screening.
//
// Idempotency strategy (defense in depth):
//   1. Deterministic idempotency_key = "expiry_7_day:<screening_id>:<valid_until>"
//   2. UNIQUE constraint on health_screening_reminder_log.idempotency_key —
//      the database rejects any duplicate insert (Postgres error 23505).
//   3. Log insert happens FIRST. Only on successful insert do we create the
//      user notification and update expiry_reminder_sent_at.
//   4. Retries, concurrent runs, and replays are all safe: the second attempt
//      hits the unique violation and is skipped.
export const Route = createFileRoute('/api/public/hooks/health-screening-reminders')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get('apikey') ??
          request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        )

        // Respect the configured daily run time (UTC). If invoked before it,
        // skip so the cron/hosted scheduler stays the source of truth on WHEN,
        // while the config row is the source of truth on the target time.
        const { daily_run_time_utc: dailyRunTime, expiring_within_days: windowDays } =
          await readReminderJobConfig();
        const now = new Date();
        const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const [h, m] = dailyRunTime.split(':').map(Number);
        const configuredMinutes = h * 60 + m;
        if (nowMinutes < configuredMinutes) {
          return new Response(
            JSON.stringify({
              success: true,
              skipped_reason: 'before_configured_run_time',
              configured_run_time_utc: dailyRunTime,
              now_utc: now.toISOString(),
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Target date: exactly `windowDays` from today (UTC).
        const target = new Date()
        target.setUTCDate(target.getUTCDate() + windowDays)
        const targetDate = target.toISOString().slice(0, 10)

        const { data: candidates, error: selErr } = await supabase
          .from('health_screenings')
          .select('id, user_id, valid_until')
          .eq('status', 'approved')
          .eq('valid_until', targetDate)
          .is('expiry_reminder_sent_at', null)

        if (selErr) {
          console.error('[health-screening-reminders] select failed', selErr)
          return new Response(JSON.stringify({ error: selErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        let sent = 0
        let skipped = 0
        const failures: Array<{ id: string; error: string }> = []

        // Resolve app origin for portal links inside the reminder email.
        const origin =
          process.env.PUBLIC_APP_URL ??
          process.env.SITE_URL ??
          request.headers.get('origin') ??
          `https://${request.headers.get('host') ?? 'princesspink90.com'}`
        const portalUrl = `${origin.replace(/\/$/, '')}/health-screenings`

        let emailed = 0
        for (const row of candidates ?? []) {
          const idempotencyKey = `expiry_7_day:${row.id}:${row.valid_until}`
          const channelsAttempted: string[] = ['in_app', 'email']

          // Step 1: claim via unique log insert. Duplicate = already reminded.
          const { data: logRow, error: logErr } = await supabase
            .from('health_screening_reminder_log')
            .insert({
              screening_id: row.id,
              user_id: row.user_id,
              reminder_type: 'expiry_7_day',
              valid_until: row.valid_until,
              channels: channelsAttempted,
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

          // Step 2: create in-app notification.
          const { error: notifErr } = await supabase.from('notifications').insert({
            user_id: row.user_id,
            kind: 'health_screening_expiring',
            title: `Your health screening expires in ${windowDays} day${windowDays === 1 ? '' : 's'}`,
            body: `Your approved health screening is valid until ${row.valid_until}. Please upload a renewed certificate before it expires to keep your access active.`,
            link_url: '/health-screenings',
            metadata: {
              screening_id: row.id,
              valid_until: row.valid_until,
              days_until_expiry: windowDays,
              idempotency_key: idempotencyKey,
            },
          })

          if (notifErr) {
            const { computeNextRetryAt } = await import('@/lib/reminder-retry')
            await supabase
              .from('health_screening_reminder_log')
              .update({
                status: 'failed',
                error_message: notifErr.message,
                last_attempt_at: new Date().toISOString(),
                next_retry_at: computeNextRetryAt(1)?.toISOString() ?? null,
              })
              .eq('id', logRow.id)
            failures.push({ id: row.id, error: notifErr.message })
            continue
          }

          // Step 3: send branded email via Resend. Failure here does NOT block
          // the in-app notification; log the error and continue.
          try {
            const { data: userRow } = await supabase.auth.admin.getUserById(row.user_id)
            const email = userRow?.user?.email
            const displayName =
              (userRow?.user?.user_metadata?.full_name as string | undefined) ??
              (userRow?.user?.user_metadata?.name as string | undefined) ??
              null

            if (email) {
              const tmpl = renderHealthScreeningReminder({
                recipientName: displayName,
                validUntil: row.valid_until,
                daysUntilExpiry: windowDays,
                portalUrl,
              })
              const result = await sendResendEmail({
                to: email,
                subject: tmpl.subject,
                html: tmpl.html,
                text: tmpl.text,
                idempotencyKey,
                tags: [{ name: 'template', value: 'health_screening_expiry_7_day' }],
              })
              await supabase.from('email_send_log').insert({
                message_id: idempotencyKey,
                template_name: 'health_screening_expiry_7_day',
                recipient_email: email,
                status: result.ok ? 'sent' : 'failed',
                error_message: result.ok ? null : result.error?.slice(0, 1000) ?? null,
              })
              if (result.ok) emailed += 1
            }
          } catch (e) {
            console.warn('[health-screening-reminders] email send failed', (e as Error).message)
          }

          // Step 4: flip the screening flag so future scans skip this row fast.
          await supabase
            .from('health_screenings')
            .update({ expiry_reminder_sent_at: new Date().toISOString() })
            .eq('id', row.id)

          sent += 1
        }

        return new Response(
          JSON.stringify({
            success: true,
            target_date: targetDate,
            candidates: candidates?.length ?? 0,
            sent,
            emailed,
            skipped,
            failures,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
