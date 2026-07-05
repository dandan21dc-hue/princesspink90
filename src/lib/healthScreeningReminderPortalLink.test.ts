import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveAppOrigin } from './app-origin.server'
import { renderHealthScreeningReminder } from './email-templates-resend/health-screening-reminder'

// Build a Request with only the header signals the origin resolver reads.
function mockRequest(headers: Record<string, string> = {}, url = 'http://internal/'): Request {
  return new Request(url, { headers })
}

function renderPortalLink(request: Request, extras: Record<string, string> = {}) {
  const origin = resolveAppOrigin(request)
  const qs = new URLSearchParams({
    rid: 'rem_test_123',
    sid: 'scr_test_456',
    uid: 'usr_test_789',
    utm_source: 'email',
    utm_medium: 'reminder',
    utm_campaign: 'health_screening_expiry_7_day',
    ...extras,
  })
  const portalUrl = `${origin}/health-screenings?${qs.toString()}`
  const tmpl = renderHealthScreeningReminder({
    recipientName: 'Dana Test',
    validUntil: '2026-07-12',
    daysUntilExpiry: 7,
    portalUrl,
    status: 'approved',
    testDate: '2026-06-08',
  })
  return { portalUrl, tmpl, origin }
}

const LOCAL_HOST_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /192\.168\./,
  /10\.\d+\.\d+\.\d+/,
  /172\.(1[6-9]|2\d|3[01])\./,
  /\.local(:|\/|$)/i,
]

function assertNoLocalhost(value: string) {
  for (const p of LOCAL_HOST_PATTERNS) {
    expect(value, `unexpected local host ref matching ${p}`).not.toMatch(p)
  }
}

describe('health screening reminder — portal link', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.PUBLIC_APP_URL
    delete process.env.SITE_URL
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  it('uses PUBLIC_APP_URL when the secret is set, even for a localhost request', () => {
    process.env.PUBLIC_APP_URL = 'https://princesspink90.com'
    const req = mockRequest({ host: 'localhost:8080' })
    const { portalUrl, tmpl } = renderPortalLink(req)

    expect(portalUrl.startsWith('https://princesspink90.com/health-screenings?')).toBe(true)
    assertNoLocalhost(portalUrl)
    assertNoLocalhost(tmpl.html)
    assertNoLocalhost(tmpl.text)

    // Tracing params survive into both html and text output.
    for (const output of [tmpl.html, tmpl.text]) {
      expect(output).toContain('rid=rem_test_123')
      expect(output).toContain('sid=scr_test_456')
      expect(output).toContain('uid=usr_test_789')
    }
  })

  it('honors x-forwarded-host from a production proxy when no env override is set', () => {
    const req = mockRequest({
      'x-forwarded-host': 'app.princesspink90.com',
      'x-forwarded-proto': 'https',
      host: 'internal-worker.local',
    })
    const { portalUrl, tmpl } = renderPortalLink(req)
    expect(portalUrl.startsWith('https://app.princesspink90.com/health-screenings?')).toBe(true)
    assertNoLocalhost(portalUrl)
    assertNoLocalhost(tmpl.html)
    assertNoLocalhost(tmpl.text)
  })

  it('falls back to the production URL when no host signals and no env override are present', () => {
    // No headers at all — mirrors a pg_cron-style invocation with no proxy info.
    const req = mockRequest({})
    const { portalUrl, tmpl } = renderPortalLink(req)
    expect(portalUrl.startsWith('https://princesspink90.com/health-screenings?')).toBe(true)
    assertNoLocalhost(portalUrl)
    assertNoLocalhost(tmpl.html)
    assertNoLocalhost(tmpl.text)
  })

  it('ignores a dev PUBLIC_APP_URL when a real production proxy header is present', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:3000'
    const req = mockRequest({
      'x-forwarded-host': 'app.princesspink90.com',
      'x-forwarded-proto': 'https',
    })
    const { portalUrl, tmpl } = renderPortalLink(req)
    expect(portalUrl.startsWith('https://app.princesspink90.com/health-screenings?')).toBe(true)
    assertNoLocalhost(portalUrl)
    assertNoLocalhost(tmpl.html)
    assertNoLocalhost(tmpl.text)
  })

  it('renders both an anchor href and a bare tracked URL in the html', () => {
    process.env.PUBLIC_APP_URL = 'https://princesspink90.com'
    const req = mockRequest()
    const { portalUrl, tmpl } = renderPortalLink(req)
    // HTML escapes `&` inside attribute values, so compare against the escaped form.
    const escapedPortalUrl = portalUrl.replace(/&/g, '&amp;')
    expect(tmpl.html).toContain(`href="${escapedPortalUrl}"`)
    expect(tmpl.text).toContain(portalUrl)
  })
})
