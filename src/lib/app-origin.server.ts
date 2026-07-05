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
// Localhost/private hosts are treated as dev and yield to the production
// fallback so emails sent from a preview build or a curl smoke test never
// leak a `localhost:8080` link into a real inbox.

const PRODUCTION_FALLBACK = 'https://princesspink90.com'

export function resolveAppOrigin(request: Request): string {
  // 1. Explicit override always wins — but ignore a dev-host value so a
  //    misconfigured local `.env` can't poison a production send.
  const envOverride = (process.env.PUBLIC_APP_URL ?? process.env.SITE_URL ?? '').trim()
  if (envOverride && !isDevHost(envOverride)) return normalize(envOverride)

  const fromForwarded = fromForwardedHeaders(request)
  if (fromForwarded && !isDevHost(fromForwarded)) return normalize(fromForwarded)

  const host = request.headers.get('host')
  if (host && !isDevHost(host)) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    return normalize(`${proto}://${host}`)
  }

  const origin = request.headers.get('origin')
  if (origin && !isDevHost(origin)) return normalize(origin)

  // Dev-only signals still populate as a last resort so local `curl` smoke
  // tests can render a preview link. Env override is honored here even when
  // it points at a dev host, since there's no better signal to fall back on.
  if (envOverride) return normalize(envOverride)
  if (fromForwarded) return normalize(fromForwarded)
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'http'
    return normalize(`${proto}://${host}`)
  }
  if (origin) return normalize(origin)

  return PRODUCTION_FALLBACK
}

function fromForwardedHeaders(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host')
  if (!forwardedHost) return null
  // Take the first host in a comma-separated chain (client-facing proxy).
  const host = forwardedHost.split(',')[0]!.trim()
  if (!host) return null
  const proto = (request.headers.get('x-forwarded-proto') ?? 'https').split(',')[0]!.trim()
  return `${proto}://${host}`
}

function isDevHost(input: string): boolean {
  try {
    const url = input.includes('://') ? new URL(input) : new URL(`http://${input}`)
    const h = url.hostname.toLowerCase()
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h.endsWith('.local') ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    )
  } catch {
    return false
  }
}

function normalize(origin: string): string {
  return origin.replace(/\/+$/, '')
}
