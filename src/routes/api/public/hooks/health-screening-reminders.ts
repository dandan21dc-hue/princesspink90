import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'

// Daily job: finds admin-approved health screenings expiring in exactly 7 days
// and creates exactly one in-app reminder notification per screening.
// Exactness is enforced via the expiry_reminder_sent_at column (updated atomically).
export const Route = createFileRoute('/api/public/hooks/health-screening-reminders')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get('apikey') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
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

        // Compute the target date: exactly 7 days from today (UTC).
        const target = new Date()
        target.setUTCDate(target.getUTCDate() + 7)
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
        const failures: Array<{ id: string; error: string }> = []

        for (const row of candidates ?? []) {
          // Claim the reminder atomically: only proceed if we successfully flip
          // expiry_reminder_sent_at from NULL to now(). Prevents duplicate sends
          // if the job runs concurrently or retries after a partial failure.
          const claimedAt = new Date().toISOString()
          const { data: claimed, error: claimErr } = await supabase
            .from('health_screenings')
            .update({ expiry_reminder_sent_at: claimedAt })
            .eq('id', row.id)
            .is('expiry_reminder_sent_at', null)
            .select('id')
            .maybeSingle()

          if (claimErr || !claimed) {
            if (claimErr) failures.push({ id: row.id, error: claimErr.message })
            continue
          }

          const { error: notifErr } = await supabase.from('notifications').insert({
            user_id: row.user_id,
            kind: 'health_screening_expiring',
            title: 'Your health screening expires in 7 days',
            body: `Your approved health screening is valid until ${row.valid_until}. Please upload a renewed certificate before it expires to keep your access active.`,
            link_url: '/health-screenings',
            metadata: {
              screening_id: row.id,
              valid_until: row.valid_until,
              days_until_expiry: 7,
            },
          })

          if (notifErr) {
            // Roll back the claim so a future run can retry this screening.
            await supabase
              .from('health_screenings')
              .update({ expiry_reminder_sent_at: null })
              .eq('id', row.id)
              .eq('expiry_reminder_sent_at', claimedAt)
            failures.push({ id: row.id, error: notifErr.message })
            continue
          }

          sent += 1
        }

        return new Response(
          JSON.stringify({
            success: true,
            target_date: targetDate,
            candidates: candidates?.length ?? 0,
            sent,
            failures,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
