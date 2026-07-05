import { describe, expect, it } from 'vitest'
import {
  assertSafeLogPayload,
  redactLogPayload,
  SENSITIVE_QUERY_PARAMS,
} from './log-redaction'

describe('redactLogPayload — emails', () => {
  it('masks an email in a free-form string value', () => {
    const out = redactLogPayload({ message: 'sent to alice@example.com successfully' }) as {
      message: string
    }
    expect(out.message).toBe('sent to a***@example.com successfully')
  })

  it('masks emails inside arrays and nested objects', () => {
    const out = redactLogPayload({
      recipients_note: ['ping bob@example.org', 'and carol@example.net'],
      meta: { author: 'dan@example.co' },
    }) as { recipients_note: string[]; meta: { author: string } }
    expect(out.recipients_note).toEqual([
      'ping b***@example.org',
      'and c***@example.net',
    ])
    expect(out.meta.author).toBe('d***@example.co')
  })

  it('masks a value under a sensitive key (email/to/recipient) wholesale', () => {
    const out = redactLogPayload({
      email: 'alice@example.com',
      to: 'bob@example.org',
      recipient_email: 'carol@example.net',
      cc: ['x@y.co', 'z@y.co'],
    }) as Record<string, unknown>
    expect(out.email).toBe('***@example.com')
    expect(out.to).toBe('***@example.org')
    expect(out.recipient_email).toBe('***@example.net')
    expect(out.cc).toEqual(['***', '***'])
  })
})

describe('redactLogPayload — tokens', () => {
  it('masks Bearer authorization headers', () => {
    const out = redactLogPayload({
      note: 'called api with Bearer sk_live_abcdef1234567890abcdef1234567890',
    }) as { note: string }
    expect(out.note).toBe('called api with Bearer ***')
  })

  it('masks JWT-shaped tokens anywhere in a string', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const out = redactLogPayload({ trace: `session=${jwt} continue` }) as {
      trace: string
    }
    expect(out.trace).toBe('session=*** continue')
  })

  it('masks entire value under sensitive keys (authorization/token/secret)', () => {
    const out = redactLogPayload({
      authorization: 'Bearer sk_live_super_secret_token_value_abcdef123456',
      token: 'plain-token-1234567890abcdef',
      client_secret: 'shh',
      password: 'hunter2',
      apikey: 'sk_test_abc',
    }) as Record<string, string>
    expect(out.authorization).toBe('***')
    expect(out.token).toBe('***')
    expect(out.client_secret).toBe('***')
    expect(out.password).toBe('***')
    expect(out.apikey).toBe('***')
  })

  it('leaves UUID tracing IDs (rid/sid/uid) untouched', () => {
    const rid = '11111111-1111-1111-1111-111111111111'
    const out = redactLogPayload({ reminder_id: rid, screening_id: rid, user_id: rid }) as {
      reminder_id: string
      screening_id: string
      user_id: string
    }
    expect(out.reminder_id).toBe(rid)
    expect(out.screening_id).toBe(rid)
    expect(out.user_id).toBe(rid)
  })
})

describe('redactLogPayload — URLs with sensitive query params', () => {
  it('masks known sensitive query params inside a URL string', () => {
    const url =
      'https://app.example.com/reset?token=abc123&email=alice@example.com&rid=safe-id'
    const out = redactLogPayload({ portal_url: url }) as { portal_url: string }
    // token + email params masked; unrelated rid + host kept.
    const parsed = new URL(out.portal_url)
    expect(parsed.searchParams.get('token')).toBe('***')
    expect(parsed.searchParams.get('email')).toBe('***')
    expect(parsed.searchParams.get('rid')).toBe('safe-id')
    expect(parsed.origin).toBe('https://app.example.com')
  })

  it('keeps tracing params (rid/sid/uid/utm_*) intact on real portal URLs', () => {
    const portal =
      'https://app.princesspink90.com/health-screenings?rid=r1&sid=s1&uid=u1' +
      '&utm_source=email&utm_medium=reminder&utm_campaign=health_screening_expiry_7_day'
    const out = redactLogPayload({ portal_url: portal }) as { portal_url: string }
    // URL is untouched (no sensitive params) — same string, or at worst
    // a canonicalized equivalent that parses identically.
    const before = new URL(portal)
    const after = new URL(out.portal_url)
    expect(after.origin).toBe(before.origin)
    expect(after.pathname).toBe(before.pathname)
    for (const key of ['rid', 'sid', 'uid', 'utm_source', 'utm_medium', 'utm_campaign']) {
      expect(after.searchParams.get(key)).toBe(before.searchParams.get(key))
    }
  })

  it('covers every documented sensitive query param', () => {
    for (const param of SENSITIVE_QUERY_PARAMS) {
      const url = `https://example.com/x?${param}=leaked-value-123`
      const out = redactLogPayload({ url }) as { url: string }
      const parsed = new URL(out.url)
      expect(parsed.searchParams.get(param)).toBe('***')
    }
  })

  it('leaves malformed URL-looking strings alone', () => {
    const out = redactLogPayload({ note: 'not a url: https://' }) as {
      note: string
    }
    expect(out.note).toContain('https://')
  })
})

describe('redactLogPayload — structural safety', () => {
  it('bounds recursion depth', () => {
    // 10 levels deep — should terminate cleanly.
    let deep: unknown = 'bottom'
    for (let i = 0; i < 12; i++) deep = { next: deep }
    const out = redactLogPayload(deep) as { next: unknown }
    // Should not throw and should produce something serializable.
    expect(() => JSON.stringify(out)).not.toThrow()
  })

  it('truncates absurdly long strings', () => {
    const huge = 'x'.repeat(20_000)
    const out = redactLogPayload({ blob: huge }) as { blob: string }
    expect(out.blob.length).toBeLessThan(huge.length)
    expect(out.blob.endsWith('[truncated]')).toBe(true)
  })
})

describe('assertSafeLogPayload — reject mode', () => {
  it('throws when a raw email is present in a free-form string', () => {
    expect(() =>
      assertSafeLogPayload({ note: 'contact alice@example.com now' }),
    ).toThrow(/email address/)
  })

  it('throws when a sensitive key is populated', () => {
    expect(() =>
      assertSafeLogPayload({ authorization: 'Bearer whatever-value-here' }),
    ).toThrow(/sensitive key populated/)
  })

  it('throws when a URL contains a sensitive query param', () => {
    expect(() =>
      assertSafeLogPayload({
        portal_url: 'https://app.example.com/x?token=abc',
      }),
    ).toThrow(/sensitive param "token"/)
  })

  it('accepts a masked payload round-tripped through redactLogPayload', () => {
    const raw = {
      event: 'reminder_email_send',
      reminder_id: '11111111-1111-1111-1111-111111111111',
      recipient_masked: 'a***@example.com',
      portal_url:
        'https://app.princesspink90.com/health-screenings?rid=r&sid=s&uid=u' +
        '&utm_source=email&utm_medium=reminder&utm_campaign=health_screening_expiry_7_day',
      status: 'sent',
    }
    const safe = redactLogPayload(raw)
    expect(() => assertSafeLogPayload(safe)).not.toThrow()
  })

  it('accepts a plain, non-sensitive payload', () => {
    expect(() =>
      assertSafeLogPayload({
        event: 'reminder_cron_start',
        run_id: 'run_abc',
        candidates: 3,
        target_date: '2026-08-01',
      }),
    ).not.toThrow()
  })
})
