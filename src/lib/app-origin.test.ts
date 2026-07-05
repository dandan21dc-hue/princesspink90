import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAppOrigin } from './app-origin.server'

const PRODUCTION_FALLBACK = 'https://princesspink90.com'

function mockRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://ignored.example/does-not-matter', { headers })
}

const ENV_KEYS = ['PUBLIC_APP_URL', 'SITE_URL'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('resolveAppOrigin — env override (PUBLIC_APP_URL / SITE_URL)', () => {
  it('uses PUBLIC_APP_URL when set to a valid non-dev origin', () => {
    process.env.PUBLIC_APP_URL = 'https://app.princesspink90.com'
    expect(resolveAppOrigin(mockRequest({ host: 'evil.example.com' }))).toBe(
      'https://app.princesspink90.com',
    )
  })

  it('falls back to SITE_URL when PUBLIC_APP_URL is not set', () => {
    process.env.SITE_URL = 'https://site.princesspink90.com'
    expect(resolveAppOrigin(mockRequest())).toBe('https://site.princesspink90.com')
  })

  it('PUBLIC_APP_URL wins over SITE_URL', () => {
    process.env.PUBLIC_APP_URL = 'https://public.princesspink90.com'
    process.env.SITE_URL = 'https://site.princesspink90.com'
    expect(resolveAppOrigin(mockRequest())).toBe('https://public.princesspink90.com')
  })

  it('normalizes the env origin (strips trailing slash / default port)', () => {
    process.env.PUBLIC_APP_URL = 'https://app.princesspink90.com:443/'
    expect(resolveAppOrigin(mockRequest())).toBe('https://app.princesspink90.com')
  })

  it('ignores a dev PUBLIC_APP_URL when a real proxy header is present', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:8080'
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('falls back to a dev PUBLIC_APP_URL when nothing else validates', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:8080'
    expect(resolveAppOrigin(mockRequest())).toBe('http://localhost:8080')
  })

  it('rejects an env override with an unsafe protocol', () => {
    process.env.PUBLIC_APP_URL = 'javascript:alert(1)'
    expect(resolveAppOrigin(mockRequest())).toBe(PRODUCTION_FALLBACK)
  })

  it('rejects an env override with embedded userinfo', () => {
    process.env.PUBLIC_APP_URL = 'https://user:pass@app.princesspink90.com'
    expect(resolveAppOrigin(mockRequest())).toBe(PRODUCTION_FALLBACK)
  })

  it('rejects an env override with CRLF (header-injection attempt)', () => {
    process.env.PUBLIC_APP_URL = 'https://app.princesspink90.com\r\nX-Injected: 1'
    expect(resolveAppOrigin(mockRequest())).toBe(PRODUCTION_FALLBACK)
  })

  it('rejects an env override with a path/query', () => {
    process.env.PUBLIC_APP_URL = 'https://app.princesspink90.com/foo?bar=1'
    expect(resolveAppOrigin(mockRequest())).toBe(PRODUCTION_FALLBACK)
  })
})

describe('resolveAppOrigin — x-forwarded-* headers', () => {
  it('uses x-forwarded-host with x-forwarded-proto=https', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('defaults to https when x-forwarded-proto is missing', () => {
    expect(
      resolveAppOrigin(mockRequest({ 'x-forwarded-host': 'app.princesspink90.com' })),
    ).toBe('https://app.princesspink90.com')
  })

  it('honors x-forwarded-proto=http when explicitly set', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toBe('http://app.princesspink90.com')
  })

  it('takes the first host from a comma-separated x-forwarded-host chain', () => {
    // No spaces inside the value — readHeader rejects any whitespace,
    // which is exactly how the real validator defuses smuggled values.
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com,edge.internal,origin.internal',
          'x-forwarded-proto': 'https,https,http',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('rejects an x-forwarded-host chain that contains whitespace', () => {
    // Whitespace inside the header value is a smuggling signal — reject it
    // entirely rather than trust any of the comma-separated tokens.
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com, edge.internal',
        }),
      ),
    ).toBe(PRODUCTION_FALLBACK)
  })

  it('ignores an invalid x-forwarded-proto value and defaults to https', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com',
          'x-forwarded-proto': 'gopher',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('rejects an oversized x-forwarded-host and falls back', () => {

    expect(
      resolveAppOrigin(
        mockRequest({ 'x-forwarded-host': 'a'.repeat(600) + '.example.com' }),
      ),
    ).toBe(PRODUCTION_FALLBACK)
  })

  it('preserves a non-default port from x-forwarded-host', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'app.princesspink90.com:8443',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://app.princesspink90.com:8443')
  })
})

describe('resolveAppOrigin — host / origin fallback', () => {
  it('uses the host header when no forwarded headers are set', () => {
    expect(resolveAppOrigin(mockRequest({ host: 'app.princesspink90.com' }))).toBe(
      'https://app.princesspink90.com',
    )
  })

  it('respects x-forwarded-proto=http when only host header is set', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          host: 'app.princesspink90.com',
          'x-forwarded-proto': 'http',
        }),
      ),
    ).toBe('http://app.princesspink90.com')
  })

  it('uses the Origin header when host is absent', () => {
    expect(
      resolveAppOrigin(mockRequest({ origin: 'https://app.princesspink90.com' })),
    ).toBe('https://app.princesspink90.com')
  })

  it('prefers x-forwarded-host over the host header', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          host: 'internal.origin.example',
          'x-forwarded-host': 'app.princesspink90.com',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('prefers the host header over the Origin header', () => {
    expect(
      resolveAppOrigin(
        mockRequest({
          host: 'app.princesspink90.com',
          origin: 'https://other.example.com',
        }),
      ),
    ).toBe('https://app.princesspink90.com')
  })

  it('rejects a malformed host header and falls back', () => {
    expect(resolveAppOrigin(mockRequest({ host: 'not a host name' }))).toBe(
      PRODUCTION_FALLBACK,
    )
  })

  it('skips a dev host header for real (non-dev) resolution', () => {
    // Only a localhost host header — falls through the non-dev pass to the
    // dev pass, which then returns the built dev origin.
    expect(resolveAppOrigin(mockRequest({ host: 'localhost:8080' }))).toBe(
      'http://localhost:8080',
    )
  })
})

describe('resolveAppOrigin — fallback behavior', () => {
  it('returns the hardcoded production URL when no signals are present', () => {
    expect(resolveAppOrigin(mockRequest())).toBe(PRODUCTION_FALLBACK)
  })

  it('returns the production fallback when every signal is invalid', () => {
    process.env.PUBLIC_APP_URL = 'not a url'
    expect(
      resolveAppOrigin(
        mockRequest({
          'x-forwarded-host': 'bad host',
          host: '///',
          origin: 'ftp://nope.example',
        }),
      ),
    ).toBe(PRODUCTION_FALLBACK)
  })
})
