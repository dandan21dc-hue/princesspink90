// Runtime guard for log payloads.
//
// Two entry points:
//   redactLogPayload(payload)  → deep-clone with emails, tokens, and
//                                sensitive URL query params masked.
//   assertSafeLogPayload(payload) → throws if any unredacted sensitive
//                                value is present. Use in tests / dev to
//                                catch accidental PII/secrets before they
//                                land in a log store.
//
// Rules:
//   - Keys named like credentials (authorization, apikey, token, password,
//     secret, email, recipient, cookie, ...) are masked wholesale.
//   - String values containing email addresses are masked in place
//     (`alice@example.com` → `a***@example.com`).
//   - Bearer prefixes and JWT-shaped tokens are replaced with `***`.
//   - Long high-entropy tokens (≥32 base64/hex chars) are replaced with `***`.
//   - URL query params in the SENSITIVE_QUERY_PARAMS set are replaced with
//     `***` (host/path/tracing params kept intact).

export const SENSITIVE_KEYS = new Set(
  [
    'authorization',
    'auth',
    'apikey',
    'api_key',
    'x-api-key',
    'access_token',
    'refresh_token',
    'id_token',
    'token',
    'password',
    'passwd',
    'pwd',
    'secret',
    'client_secret',
    'private_key',
    'cookie',
    'set-cookie',
    'session',
    'email',
    'to',
    'from',
    'cc',
    'bcc',
    'recipient',
    'recipient_email',
    'recipients',
  ].map((k) => k.toLowerCase()),
)

export const SENSITIVE_QUERY_PARAMS = new Set(
  [
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'apikey',
    'api_key',
    'key',
    'secret',
    'password',
    'code',
    'session',
    'sid_token',
    'sig',
    'signature',
    'auth',
    'authorization',
    'email',
  ].map((p) => p.toLowerCase()),
)

const EMAIL_RE = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{4,}/gi
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const LONG_TOKEN_RE = /\b[A-Za-z0-9_\-+/]{32,}={0,2}\b/g
// Preserve UUIDs (used as tracing IDs like rid/sid/uid) — they're not secrets.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_DEPTH = 8
const MAX_STRING = 4096

export function redactLogPayload(input: unknown): unknown {
  return walk(input, 0, null)
}

export function assertSafeLogPayload(input: unknown): void {
  const problems: string[] = []
  scan(input, 0, [], problems)
  if (problems.length > 0) {
    throw new Error(
      `Unsafe log payload: ${problems.slice(0, 5).join('; ')}${
        problems.length > 5 ? ` (+${problems.length - 5} more)` : ''
      }`,
    )
  }
}

/* ─── internals ───────────────────────────────────────────────────────── */

function walk(v: unknown, depth: number, keyHint: string | null): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (v == null) return v
  if (typeof v === 'string') return redactString(v, keyHint)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v
  if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1, keyHint))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const lower = k.toLowerCase()
      if (SENSITIVE_KEYS.has(lower)) {
        out[k] = maskWholeValue(val)
      } else {
        out[k] = walk(val, depth + 1, lower)
      }
    }
    return out
  }
  // Functions / symbols / other exotics — drop them.
  return `[${typeof v}]`
}

function maskWholeValue(v: unknown): unknown {
  if (v == null) return v
  if (Array.isArray(v)) return v.map(() => '***')
  if (typeof v === 'string') {
    // Preserve just enough shape to correlate: length + email domain if any.
    const m = v.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/)
    if (m) return `***@${m[1]}`
    return '***'
  }
  if (typeof v === 'object') return '***'
  return '***'
}

function redactString(s: string, keyHint: string | null): string {
  if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + '…[truncated]'

  // Don't mangle UUIDs used as tracing IDs.
  if (UUID_RE.test(s)) return s

  let out = s

  // 1. Redact sensitive URL query params.
  out = redactUrlsInString(out)

  // 2. Mask emails.
  out = out.replace(EMAIL_RE, (_m, first, domain) => `${first}***${domain}`)

  // 3. Redact Bearer/Basic/Token prefixes.
  out = out.replace(BEARER_RE, (_m, scheme) => `${scheme} ***`)

  // 4. Redact JWT-shaped tokens.
  out = out.replace(JWT_RE, '***')

  // 5. Redact long high-entropy tokens — but only when the surrounding key
  //    suggests a credential, to avoid clobbering hashes/IDs used for tracing.
  if (keyHint && /(token|secret|key|sig|password|auth)/.test(keyHint)) {
    out = out.replace(LONG_TOKEN_RE, '***')
  }

  return out
}

function redactUrlsInString(s: string): string {
  // Match http(s) URLs including query string; stop at whitespace or common
  // punctuation that never appears inside a URL query.
  return s.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
    try {
      const url = new URL(raw)
      let mutated = false
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
          url.searchParams.set(key, '***')
          mutated = true
        }
      }
      return mutated ? url.toString() : raw
    } catch {
      return raw
    }
  })
}

function scan(v: unknown, depth: number, path: string[], out: string[]) {
  if (depth > MAX_DEPTH || v == null) return
  if (typeof v === 'string') {
    const where = path.join('.') || '<root>'
    if (EMAIL_RE.test(v)) out.push(`${where}: email address`)
    EMAIL_RE.lastIndex = 0
    if (BEARER_RE.test(v)) out.push(`${where}: bearer/basic token`)
    BEARER_RE.lastIndex = 0
    if (JWT_RE.test(v)) out.push(`${where}: JWT`)
    JWT_RE.lastIndex = 0
    // Sensitive query params in a URL.
    const urlMatches = v.match(/https?:\/\/[^\s"'<>]+/g) ?? []
    for (const raw of urlMatches) {
      try {
        const url = new URL(raw)
        for (const key of url.searchParams.keys()) {
          if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
            out.push(`${where}: URL contains sensitive param "${key}"`)
          }
        }
      } catch {
        /* ignore */
      }
    }
    return
  }
  if (Array.isArray(v)) {
    v.forEach((item, i) => scan(item, depth + 1, [...path, String(i)], out))
    return
  }
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        // Any non-empty value under a sensitive key is a violation.
        if (val != null && val !== '' && val !== '***' && !isMaskedEmail(val)) {
          out.push(`${[...path, k].join('.')}: sensitive key populated`)
        }
        continue
      }
      scan(val, depth + 1, [...path, k], out)
    }
  }
}

function isMaskedEmail(v: unknown): boolean {
  return typeof v === 'string' && /^\*\*\*@/.test(v)
}
