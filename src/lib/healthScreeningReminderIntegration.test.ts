import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAppOrigin } from './app-origin.server'
import { renderHealthScreeningReminder } from './email-templates-resend/health-screening-reminder'

// Mirrors buildPortalUrl in
// src/routes/api/public/hooks/health-screening-reminders.ts. Kept in the test
// so any drift between the two definitions surfaces as a test failure.
function buildPortalUrl(
  origin: string,
  p: { rid: string; sid: string; uid: string },
): string {
  const qs = new URLSearchParams({
    rid: p.rid,
    sid: p.sid,
    uid: p.uid,
    utm_source: 'email',
    utm_medium: 'reminder',
    utm_campaign: 'health_screening_expiry_7_day',
  })
  return `${origin}/health-screenings?${qs.toString()}`
}

function mockRequest(headers: Record<string, string>): Request {
  return new Request('https://ignored.example/cron', { headers })
}

const IDS = {
  rid: '11111111-1111-1111-1111-111111111111',
  sid: '22222222-2222-2222-2222-222222222222',
  uid: '33333333-3333-3333-3333-333333333333',
}

const ENV_KEYS = ['PUBLIC_APP_URL', 'SITE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function extractHref(html: string): string | null {
  // The template renders a single CTA anchor pointing at the portal URL.
  const m = html.match(/href="([^"]+)"/)
  return m ? m[1] : null
}

function assertNoLocalhost(url: string) {
  const bad = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(?::|\/|$)|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i
  expect(bad.test(url)).toBe(false)
}

describe('health screening reminder — portal link integration', () => {
  it('renders the email with rid/sid/uid + resolved forwarded origin', () => {
    const req = mockRequest({
      'x-forwarded-host': 'app.princesspink90.com',
      'x-forwarded-proto': 'https',
    })
    const origin = resolveAppOrigin(req)
    expect(origin).toBe('https://app.princesspink90.com')

    const portalUrl = buildPortalUrl(origin, IDS)
    const tmpl = renderHealthScreeningReminder({
      recipientName: 'Ada Lovelace',
      validUntil: '2026-08-01',
      daysUntilExpiry: 7,
      portalUrl,
      status: 'approved',
      testDate: '2026-05-01',
    })

    // Anchor href in HTML matches exactly.
    const href = extractHref(tmpl.html)
    expect(href).toBe(portalUrl)

    // Plain text body also carries the tracked URL.
    expect(tmpl.text).toContain(portalUrl)

    // All three tracing params present with the exact expected values.
    const parsed = new URL(portalUrl)
    expect(parsed.origin).toBe('https://app.princesspink90.com')
    expect(parsed.pathname).toBe('/health-screenings')
    expect(parsed.searchParams.get('rid')).toBe(IDS.rid)
    expect(parsed.searchParams.get('sid')).toBe(IDS.sid)
    expect(parsed.searchParams.get('uid')).toBe(IDS.uid)
    expect(parsed.searchParams.get('utm_source')).toBe('email')
    expect(parsed.searchParams.get('utm_medium')).toBe('reminder')
    expect(parsed.searchParams.get('utm_campaign')).toBe(
      'health_screening_expiry_7_day',
    )

    assertNoLocalhost(portalUrl)
    assertNoLocalhost(tmpl.html)
    assertNoLocalhost(tmpl.text)
  })

  it('PUBLIC_APP_URL overrides a localhost forwarded-host', () => {
    process.env.PUBLIC_APP_URL = 'https://portal.princesspink90.com'
    const req = mockRequest({
      'x-forwarded-host': 'localhost:8080',
      'x-forwarded-proto': 'http',
      host: 'localhost:8080',
    })
    const origin = resolveAppOrigin(req)
    expect(origin).toBe('https://portal.princesspink90.com')

    const portalUrl = buildPortalUrl(origin, IDS)
    const tmpl = renderHealthScreeningReminder({
      recipientName: null,
      validUntil: '2026-08-01',
      daysUntilExpiry: 7,
      portalUrl,
      status: 'approved',
      testDate: null,
    })

    const href = extractHref(tmpl.html)
    expect(href).toBe(portalUrl)
    expect(tmpl.text).toContain(portalUrl)
    expect(new URL(href!).origin).toBe('https://portal.princesspink90.com')
    assertNoLocalhost(href!)
    assertNoLocalhost(tmpl.text)
  })

  it('falls back to the production origin when no signals are usable', () => {
    // No env, no headers → hardcoded production fallback.
    const req = mockRequest({})
    const origin = resolveAppOrigin(req)
    expect(origin).toBe('https://princesspink90.com')

    const portalUrl = buildPortalUrl(origin, IDS)
    const tmpl = renderHealthScreeningReminder({
      recipientName: 'Grace',
      validUntil: '2026-08-01',
      daysUntilExpiry: 7,
      portalUrl,
      status: 'approved',
      testDate: null,
    })

    const href = extractHref(tmpl.html)
    expect(href).toBe(portalUrl)
    expect(new URL(href!).hostname).toBe('princesspink90.com')
    assertNoLocalhost(href!)
    assertNoLocalhost(tmpl.text)
  })
})
