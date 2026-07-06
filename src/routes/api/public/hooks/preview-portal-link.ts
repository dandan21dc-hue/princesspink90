import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { resolveAppOrigin } from '@/lib/app-origin.server'
import { checkHooksCronAuth } from '@/lib/hooks-auth.server'

// Preview-only endpoint: echoes what resolveAppOrigin + the reminder email's
// buildPortalUrl would produce for a given set of request headers. Handy for
// verifying that PUBLIC_APP_URL / forwarded headers / host fallbacks all
// resolve to the correct public origin without actually sending an email.
//
// Two modes:
//   1. GET  — uses the incoming request's real headers.
//   2. POST — accepts `{ headers?: Record<string,string>, params?: {...} }`
//             and simulates resolveAppOrigin against those synthetic headers,
//             so you can test forwarded-host / proto / origin combos with curl.
//
// Never sends email, never touches the DB. Safe on /api/public/*.

const HeadersRecord = z
  .record(z.string(), z.string().max(512))
  .refine((h) => Object.keys(h).length <= 32, {
    message: 'Too many headers (max 32).',
  })

const ParamsSchema = z
  .object({
    rid: z.string().max(128).optional(),
    sid: z.string().max(128).optional(),
    uid: z.string().max(128).optional(),
  })
  .optional()

const BodySchema = z.object({
  headers: HeadersRecord.optional(),
  params: ParamsSchema,
})

const DEFAULT_PARAMS = {
  rid: 'preview-reminder-id',
  sid: 'preview-screening-id',
  uid: 'preview-user-id',
}

function buildPortalUrl(
  origin: string,
  params: { rid: string; sid: string; uid: string },
): string {
  const qs = new URLSearchParams({
    rid: params.rid,
    sid: params.sid,
    uid: params.uid,
    utm_source: 'email',
    utm_medium: 'reminder',
    utm_campaign: 'health_screening_expiry_7_day',
  })
  return `${origin}/health-screenings?${qs.toString()}`
}

function summarize(request: Request, origin: string, portalUrl: string) {
  return {
    resolved_origin: origin,
    portal_url: portalUrl,
    request_headers_seen: {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      'x-forwarded-host': request.headers.get('x-forwarded-host'),
      'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
    },
    env: {
      public_app_url_set: Boolean(process.env.PUBLIC_APP_URL),
      site_url_set: Boolean(process.env.SITE_URL),
    },
  }
}

function checkApikey(request: Request): Response | null {
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
  return null
}

export const Route = createFileRoute('/api/public/hooks/preview-portal-link')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauth = checkApikey(request)
        if (unauth) return unauth
        const origin = resolveAppOrigin(request)
        const portalUrl = buildPortalUrl(origin, DEFAULT_PARAMS)
        return Response.json(summarize(request, origin, portalUrl))
      },
      POST: async ({ request }) => {
        let json: unknown = {}
        try {
          const raw = await request.text()
          json = raw ? JSON.parse(raw) : {}
        } catch {
          return new Response(
            JSON.stringify({ error: 'invalid_json' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const parsed = BodySchema.safeParse(json)
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: 'invalid_body', issues: parsed.error.issues }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Build a synthetic Request whose headers are the caller-supplied ones,
        // so resolveAppOrigin's behavior can be observed for arbitrary inputs.
        // Header values are already length-bounded by Zod; Headers itself
        // rejects CRLF / null bytes, which is exactly the validation we want.
        const overrides = parsed.data.headers
        let syntheticRequest: Request = request
        if (overrides) {
          try {
            syntheticRequest = new Request('https://simulated.local/preview', {
              headers: overrides,
            })
          } catch (e) {
            return new Response(
              JSON.stringify({
                error: 'invalid_header_value',
                detail: (e as Error).message,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            )
          }
        }

        const origin = resolveAppOrigin(syntheticRequest)
        const params = { ...DEFAULT_PARAMS, ...(parsed.data.params ?? {}) }
        const portalUrl = buildPortalUrl(origin, params)
        return Response.json({
          ...summarize(syntheticRequest, origin, portalUrl),
          simulated: Boolean(overrides),
          params,
        })
      },
    },
  },
})
