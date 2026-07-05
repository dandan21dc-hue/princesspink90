import { createFileRoute } from '@tanstack/react-router'
import { sendResendEmail } from '@/lib/resend.server'
import { renderHealthScreeningReminder } from '@/lib/email-templates-resend/health-screening-reminder'
import { resolveAppOrigin } from '@/lib/app-origin.server'

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

        let body: {
          to?: string
          name?: string
          status?: string
          testDate?: string
          validUntil?: string
          days?: number
          portalUrl?: string
          portalPath?: string
        } = {}
        try {
          body = (await request.json()) as typeof body
        } catch {
          /* allow empty body */
        }
        const to = body.to?.trim()
        if (!to) return json({ error: 'missing "to" in body' }, 400)

        const origin = resolveAppOrigin(request)
        // Portal destination precedence:
        // 1. Explicit full URL (`portalUrl`) — must be http(s), used verbatim.
        // 2. Explicit path (`portalPath`) — joined onto the resolved origin.
        // 3. Default `/health-screenings` on the resolved origin.
        let portalUrl: string
        let portalSource: 'override_url' | 'override_path' | 'default' = 'default'
        if (body.portalUrl?.trim()) {
          const raw = body.portalUrl.trim()
          let parsed: URL
          try {
            parsed = new URL(raw)
          } catch {
            return json({ error: 'invalid "portalUrl" — must be an absolute URL' }, 400)
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return json({ error: 'invalid "portalUrl" — must be http or https' }, 400)
          }
          portalUrl = parsed.toString()
          portalSource = 'override_url'
        } else if (body.portalPath?.trim()) {
          const path = body.portalPath.trim()
          const normalized = path.startsWith('/') ? path : `/${path}`
          portalUrl = `${origin}${normalized}`
          portalSource = 'override_path'
        } else {
          portalUrl = `${origin}/health-screenings`
        }

        const days = body.days ?? 7
        const validUntil =
          body.validUntil ?? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
        const tmpl = renderHealthScreeningReminder({
          recipientName: body.name ?? null,
          validUntil,
          daysUntilExpiry: days,
          portalUrl,
          status: body.status ?? 'approved',
          testDate: body.testDate ?? null,
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
