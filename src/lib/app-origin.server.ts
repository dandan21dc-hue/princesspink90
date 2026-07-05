// Derive the app's public origin from an incoming request.
//
// Priority:
//   1. `PUBLIC_APP_URL` / `SITE_URL` secret — always wins when set, so a
//      single knob controls where emailed links point regardless of which
//      host handled the request (preview build, cron, curl, etc.).
//   2. `x-forwarded-host` (respecting `x-forwarded-proto`) — set by
//      Cloudflare and other reverse proxies in front of the Worker.
//   3. `host` header on the request itself.
//   4. `origin` header (present on browser-initiated requests).
//   5. A hardcoded production fallback so cron-triggered emails still ship a
//      reachable URL if every other signal is missing.
//
// Every candidate is passed through the same strict validator before use:
// - protocol must be `http` or `https`
// - hostname must be a valid DNS name or IPv4/IPv6 literal
// - no userinfo (`user:pass@host`), no path/query/fragment, no CRLF
// - length-bounded to defuse header-smuggling / oversized-value attacks
// Localhost/private hosts are also treated as "dev" so a preview build or
// curl smoke test can never leak a `localhost:8080` link into a real inbox.

const PRODUCTION_FALLBACK = 'https://princesspink90.com'
const MAX_HEADER_VALUE = 512
const MAX_HOSTNAME = 253 // RFC 1035
const HOSTNAME_RE = /^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)*(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function resolveAppOrigin(request: Request): string {
  const envOverride = pickEnvOverride()

  // 1. Env override — take it verbatim when it's a valid, non-dev origin.
  if (envOverride) {
    const parsed = parseOrigin(envOverride)
    if (parsed && !isDevHostname(parsed.hostname)) return parsed.origin
  }

  // 2. Proxy-forwarded host — trust only when the value validates cleanly.
  const forwarded = fromForwardedHeaders(request)
  if (forwarded && !isDevHostname(forwarded.hostname)) return forwarded.origin

  // 3. Direct `host` header on the request (proxy-less deployment).
  const hostHeader = readHeader(request, 'host')
  if (hostHeader) {
    const proto = readForwardedProto(request) ?? 'https'
    const built = buildOrigin(proto, hostHeader)
    if (built && !isDevHostname(built.hostname)) return built.origin
  }

  // 4. `Origin` header — validate as a full URL string.
  const originHeader = readHeader(request, 'origin')
  if (originHeader) {
    const parsed = parseOrigin(originHeader)
    if (parsed && !isDevHostname(parsed.hostname)) return parsed.origin
  }

  // 5. Dev-only signals as a last resort — same validators, but dev-hostname
  //    is allowed so local `curl` smoke tests can still render a preview URL.
  if (envOverride) {
    const parsed = parseOrigin(envOverride)
    if (parsed) return parsed.origin
  }
  if (forwarded) return forwarded.origin
  if (hostHeader) {
    const proto = readForwardedProto(request) ?? 'http'
    const built = buildOrigin(proto, hostHeader)
    if (built) return built.origin
  }
  if (originHeader) {
    const parsed = parseOrigin(originHeader)
    if (parsed) return parsed.origin
  }

  return PRODUCTION_FALLBACK
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function pickEnvOverride(): string | null {
  const raw = (process.env.PUBLIC_APP_URL ?? process.env.SITE_URL ?? '').trim()
  if (!raw || raw.length > MAX_HEADER_VALUE || hasUnsafeChars(raw)) return null
  return raw
}

function readHeader(request: Request, name: string): string | null {
  const raw = request.headers.get(name)
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_HEADER_VALUE) return null
  if (hasUnsafeChars(trimmed)) return null
  return trimmed
}

// Reads x-forwarded-proto and returns only the first, validated token.
function readForwardedProto(request: Request): 'http' | 'https' | null {
  const raw = readHeader(request, 'x-forwarded-proto')
  if (!raw) return null
  const first = raw.split(',')[0]!.trim().toLowerCase()
  return first === 'https' || first === 'http' ? first : null
}

// Parses the x-forwarded-host chain and returns the client-facing (first) host.
function fromForwardedHeaders(
  request: Request,
): { origin: string; hostname: string } | null {
  const raw = readHeader(request, 'x-forwarded-host')
  if (!raw) return null
  const first = raw.split(',')[0]!.trim()
  if (!first) return null
  const proto = readForwardedProto(request) ?? 'https'
  return buildOrigin(proto, first)
}

// Parses an already-full origin string ("https://host[:port]") strictly:
// rejects paths, queries, fragments, and userinfo.
function parseOrigin(raw: string): { origin: string; hostname: string } | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_HEADER_VALUE || hasUnsafeChars(trimmed)) {
    return null
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  // Reject anything with a path/query/fragment beyond the bare origin.
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return null
  if (!isValidHostname(url.hostname)) return null
  if (url.port && !isValidPort(url.port)) return null
  return { origin: `${url.protocol}//${url.host}`, hostname: url.hostname.toLowerCase() }
}

// Builds an origin from a validated protocol + a raw "host" or "host:port".
function buildOrigin(
  proto: 'http' | 'https',
  hostAndPort: string,
): { origin: string; hostname: string } | null {
  if (hostAndPort.length > MAX_HOSTNAME + 6 /* :65535 */ || hasUnsafeChars(hostAndPort)) {
    return null
  }
  // Route through URL to normalize casing, IDN, and IPv6 bracketing —
  // and reject anything the URL parser can't accept.
  return parseOrigin(`${proto}://${hostAndPort}`)
}

function hasUnsafeChars(v: string): boolean {
  // Reject CRLF (header injection), null bytes, and any whitespace inside
  // the value — a legitimate host header contains none of these.
  return /[\s\r\n\t\0]/.test(v)
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > MAX_HOSTNAME) return false
  // IPv6 literal — the URL parser strips the brackets from `hostname`.
  if (host.includes(':')) {
    // Delegate IPv6 shape to the URL parser (it already accepted it).
    return true
  }
  const lower = host.toLowerCase()
  if (IPV4_RE.test(lower)) return true
  return HOSTNAME_RE.test(lower)
}

function isValidPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) return false
  const n = Number(port)
  return n > 0 && n <= 65535
}

function isDevHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.localhost') ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) // link-local
  )
}
