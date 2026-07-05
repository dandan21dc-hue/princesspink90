import { createFileRoute } from '@tanstack/react-router'
import { sendResendEmail } from '@/lib/resend.server'
import { renderHealthScreeningReminder } from '@/lib/email-templates-resend/health-screening-reminder'

// Admin-only test endpoint: renders the 7-day reminder template and sends via
// Resend so you can verify branding, layout, and the portal link.
//
// Auth: pass the Supabase publishable/anon key as `apikey` header (same pattern
// as the other public hook routes). This keeps casual traffic out; only the
// project owner has that key.
export const Route = createFileRoute('/api/public/hooks/test-reminder-email')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get('apikey') ??
          request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY
        if (!apikey || !expected || apikey !== expected) {
          return json({ error: 'unauthorized' }, 401)
        }

        let body: { to?: string; name?: string } = {}
        try {
          body = (await request.json()) as { to?: string; name?: string }
        } catch {
          /* allow empty body */
        }
        const to = body.to?.trim()
        if (!to) return json({ error: 'missing "to" in body' }, 400)

        const origin =
          process.env.PUBLIC_APP_URL ??
          process.env.SITE_URL ??
          request.headers.get('origin') ??
          `https://${request.headers.get('host') ?? 'princesspink90.com'}`
        const portalUrl = `${origin.replace(/\/$/, '')}/health-screenings`

        const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
        const tmpl = renderHealthScreeningReminder({
          recipientName: body.name ?? null,
          validUntil,
          daysUntilExpiry: 7,
          portalUrl,
        })

        const result = await sendResendEmail({
          to,
          subject: `[TEST] ${tmpl.subject}`,
          html: tmpl.html,
          text: tmpl.text,
          idempotencyKey: `test-reminder:${to}:${Date.now()}`,
          tags: [{ name: 'template', value: 'health_screening_expiry_7_day_test' }],
        })

        return json(
          { ok: result.ok, id: result.id, status: result.status, error: result.error, portalUrl },
          result.ok ? 200 : 502,
        )
      },
    },
  },
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
