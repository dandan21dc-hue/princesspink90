import { createFileRoute } from '@tanstack/react-router'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { computeNextRetryAt, DEFAULT_MAX_ATTEMPTS } from '@/lib/reminder-retry'
import { checkHooksCronAuth } from '@/lib/hooks-auth.server'

// Retry runner for failed reminder deliveries.
//
// Idempotency: reruns the delivery side-effect for rows already claimed via
// the unique idempotency_key in the log. It never inserts a new log row and
// guards the downstream notification insert with the same key so retries
// cannot produce duplicate in-app notifications.
//
// Backoff: `computeNextRetryAt(attemptCount)` returns 1min, 2min, 4min, 8min
// (capped at 60min) with ±20% jitter. After DEFAULT_MAX_ATTEMPTS the row
// stays 'failed' with next_retry_at cleared, remaining visible in the admin
// reminder log for manual follow-up.

const BATCH_LIMIT = 50

type LogTable =
  | 'health_screening_reminder_log'
  | 'venue_compliance_reminder_log'

async function notificationExists(
  supabase: SupabaseClient,
  userId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .contains('metadata', { idempotency_key: idempotencyKey })
    .limit(1)
    .maybeSingle()
  return !!data
}

async function markRetryOutcome(
  supabase: SupabaseClient,
  table: LogTable,
  id: string,
  nextAttempt: number,
  maxAttempts: number,
  ok: boolean,
  errorMessage: string | null,
) {
  const now = new Date().toISOString()
  if (ok) {
    await supabase
      .from(table)
      .update({
        status: 'sent',
        error_message: null,
        attempt_count: nextAttempt,
        last_attempt_at: now,
        next_retry_at: null,
      })
      .eq('id', id)
    return
  }
  const scheduled =
    nextAttempt < maxAttempts ? computeNextRetryAt(nextAttempt) : null
  await supabase
    .from(table)
    .update({
      status: 'failed',
      error_message: errorMessage,
      attempt_count: nextAttempt,
      last_attempt_at: now,
      next_retry_at: scheduled?.toISOString() ?? null,
    })
    .eq('id', id)
}

async function retryHealthRow(
  supabase: SupabaseClient,
  row: {
    id: string
    screening_id: string
    user_id: string
    valid_until: string
    reminder_type: string
    idempotency_key: string
    attempt_count: number
    max_attempts: number
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const already = await notificationExists(
      supabase,
      row.user_id,
      row.idempotency_key,
    )
    if (!already) {
      const { error } = await supabase.from('notifications').insert({
        user_id: row.user_id,
        kind: 'health_screening_expiring',
        title: `Your health screening expires soon`,
        body: `Your approved health screening is valid until ${row.valid_until}. Please upload a renewed certificate before it expires to keep your access active.`,
        link_url: '/health-screenings',
        metadata: {
          screening_id: row.screening_id,
          valid_until: row.valid_until,
          idempotency_key: row.idempotency_key,
        },
      })
      if (error) return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function retryVenueRow(
  supabase: SupabaseClient,
  row: {
    id: string
    document_id: string
    kind: string
    expires_on: string
    recipients: unknown
    idempotency_key: string
    attempt_count: number
    max_attempts: number
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const recipientIds = Array.isArray(row.recipients)
      ? (row.recipients as string[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : []
    for (const uid of recipientIds) {
      const already = await notificationExists(
        supabase,
        uid,
        row.idempotency_key,
      )
      if (already) continue
      const { error } = await supabase.from('notifications').insert({
        user_id: uid,
        kind: 'venue_compliance_expiring',
        title: `Venue compliance document expires soon`,
        body: `A compliance document expires on ${row.expires_on}. Please upload a renewed copy before it lapses.`,
        link_url: '/venue-compliance',
        metadata: {
          document_id: row.document_id,
          kind: row.kind,
          expires_on: row.expires_on,
          idempotency_key: row.idempotency_key,
        },
      })
      if (error) return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const Route = createFileRoute('/api/public/hooks/reminder-retries')({
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

        const nowIso = new Date().toISOString()
        const stats = {
          health: { attempted: 0, recovered: 0, failed: 0, exhausted: 0 },
          venue: { attempted: 0, recovered: 0, failed: 0, exhausted: 0 },
        }

        // ---- Health screening retries ----
        const { data: healthRows, error: healthSelErr } = await supabase
          .from('health_screening_reminder_log')
          .select(
            'id, screening_id, user_id, valid_until, reminder_type, idempotency_key, attempt_count, max_attempts',
          )
          .eq('status', 'failed')
          .not('next_retry_at', 'is', null)
          .lte('next_retry_at', nowIso)
          .order('next_retry_at', { ascending: true })
          .limit(BATCH_LIMIT)

        if (healthSelErr) {
          console.error('[reminder-retries] health select failed', healthSelErr)
        }

        for (const row of healthRows ?? []) {
          const attemptCount = row.attempt_count ?? 1
          const maxAttempts = row.max_attempts ?? DEFAULT_MAX_ATTEMPTS
          if (attemptCount >= maxAttempts) {
            stats.health.exhausted += 1
            await supabase
              .from('health_screening_reminder_log')
              .update({ next_retry_at: null })
              .eq('id', row.id)
            continue
          }
          stats.health.attempted += 1
          const nextAttempt = attemptCount + 1
          const result = await retryHealthRow(supabase, {
            ...row,
            attempt_count: attemptCount,
            max_attempts: maxAttempts,
          })
          await markRetryOutcome(
            supabase,
            'health_screening_reminder_log',
            row.id,
            nextAttempt,
            maxAttempts,
            result.ok,
            result.ok ? null : (result.error ?? 'unknown error'),
          )
          if (result.ok) {
            stats.health.recovered += 1
            // Flip screening flag on successful recovery.
            await supabase
              .from('health_screenings')
              .update({ expiry_reminder_sent_at: new Date().toISOString() })
              .eq('id', row.screening_id)
          } else if (nextAttempt >= maxAttempts) {
            stats.health.exhausted += 1
          } else {
            stats.health.failed += 1
          }
        }

        // ---- Venue compliance retries ----
        const { data: venueRows, error: venueSelErr } = await supabase
          .from('venue_compliance_reminder_log')
          .select(
            'id, document_id, kind, expires_on, recipients, idempotency_key, attempt_count, max_attempts',
          )
          .eq('status', 'failed')
          .not('next_retry_at', 'is', null)
          .lte('next_retry_at', nowIso)
          .order('next_retry_at', { ascending: true })
          .limit(BATCH_LIMIT)

        if (venueSelErr) {
          console.error('[reminder-retries] venue select failed', venueSelErr)
        }

        for (const row of venueRows ?? []) {
          const attemptCount = row.attempt_count ?? 1
          const maxAttempts = row.max_attempts ?? DEFAULT_MAX_ATTEMPTS
          if (attemptCount >= maxAttempts) {
            stats.venue.exhausted += 1
            await supabase
              .from('venue_compliance_reminder_log')
              .update({ next_retry_at: null })
              .eq('id', row.id)
            continue
          }
          stats.venue.attempted += 1
          const nextAttempt = attemptCount + 1
          const result = await retryVenueRow(supabase, {
            ...row,
            attempt_count: attemptCount,
            max_attempts: maxAttempts,
          })
          await markRetryOutcome(
            supabase,
            'venue_compliance_reminder_log',
            row.id,
            nextAttempt,
            maxAttempts,
            result.ok,
            result.ok ? null : (result.error ?? 'unknown error'),
          )
          if (result.ok) {
            stats.venue.recovered += 1
            await supabase
              .from('venue_compliance_documents')
              .update({ expiry_reminder_sent_at: new Date().toISOString() })
              .eq('id', row.document_id)
          } else if (nextAttempt >= maxAttempts) {
            stats.venue.exhausted += 1
          } else {
            stats.venue.failed += 1
          }
        }

        return new Response(
          JSON.stringify({ success: true, ran_at: nowIso, stats }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
