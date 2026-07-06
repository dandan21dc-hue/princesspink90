import { createFileRoute } from '@tanstack/react-router'
import { renderHealthScreeningReminder } from '@/lib/email-templates-resend/health-screening-reminder'
import { resolveAppOrigin } from '@/lib/app-origin.server'
import { checkHooksCronAuth } from '@/lib/hooks-auth.server'

// Admin-only preview endpoint: renders the 7-day reminder template and returns
// the HTML + plain text WITHOUT sending anything through Resend. Useful for
// iterating on copy/layout, diffing variants, or embedding in a browser tab
// via `?format=html`.
//
// Auth: same pattern as the other public hook routes — pass the Supabase
// publishable/anon key as `apikey` header (or `Authorization: Bearer <key>`).
//
// GET  → reads query params (?to, ?name, ?status, ?days, ?portalPath,
//        ?portalUrl, ?testDate, ?validUntil, ?format=json|html|text).
// POST → reads the same fields as a JSON body (matches test-reminder-email).
export const Route = createFileRoute('/api/public/hooks/preview-reminder-email')({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request, 'query'),
      POST: async ({ request }) => handle(request, 'body'),
    },
  },
})

type PreviewInput = {
  to?: string
  name?: string
  status?: string
  testDate?: string
  validUntil?: string
  days?: number
  portalUrl?: string
  portalPath?: string
  format?: string
}

async function handle(request: Request, source: 'query' | 'body'): Promise<Response> {
  const unauth = checkHooksCronAuth(request)
  if (unauth) return unauth

  let input: PreviewInput = {}
  if (source === 'body') {
    try {
      input = ((await request.json()) as PreviewInput) ?? {}
    } catch {
      /* allow empty body */
    }
  } else {
    const url = new URL(request.url)
    const g = (k: string) => url.searchParams.get(k) ?? undefined
    const daysRaw = g('days')
    input = {
      to: g('to'),
      name: g('name'),
      status: g('status'),
      testDate: g('testDate'),
      validUntil: g('validUntil'),
      days: daysRaw ? Number(daysRaw) : undefined,
      portalUrl: g('portalUrl'),
      portalPath: g('portalPath'),
      format: g('format'),
    }
  }

  const origin = resolveAppOrigin(request)
  let portalUrl: string
  let portalSource: 'override_url' | 'override_path' | 'default' = 'default'
  if (input.portalUrl?.trim()) {
    const raw = input.portalUrl.trim()
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
  } else if (input.portalPath?.trim()) {
    const path = input.portalPath.trim()
    portalUrl = `${origin}${path.startsWith('/') ? path : `/${path}`}`
    portalSource = 'override_path'
  } else {
    portalUrl = `${origin}/health-screenings`
  }

  const days = Number.isFinite(input.days) ? Number(input.days) : 7
  const validUntil =
    input.validUntil ??
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  const tmpl = renderHealthScreeningReminder({
    recipientName: input.name ?? null,
    validUntil,
    daysUntilExpiry: days,
    portalUrl,
    status: input.status ?? 'approved',
    testDate: input.testDate ?? null,
  })

  const format = (input.format ?? 'json').toLowerCase()
  if (format === 'html') {
    return new Response(tmpl.html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if (format === 'text' || format === 'txt') {
    return new Response(tmpl.text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return json({
    ok: true,
    preview: true,
    subject: tmpl.subject,
    html: tmpl.html,
    text: tmpl.text,
    portalUrl,
    portalSource,
    inputs: {
      to: input.to ?? null,
      name: input.name ?? null,
      status: input.status ?? 'approved',
      testDate: input.testDate ?? null,
      validUntil,
      days,
    },
  })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
