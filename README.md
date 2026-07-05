# Princess Pink 90

## Email portal-link origin resolution

Every reminder email contains a portal link that must resolve to the
public app origin — never `localhost`, an internal proxy hostname, or a
smuggled `Host` header. The origin is computed by `resolveAppOrigin` in
[`src/lib/app-origin.server.ts`](src/lib/app-origin.server.ts) and used by
the cron hooks under `src/routes/api/public/hooks/` when they build each
recipient's URL.

### Precedence (highest to lowest)

The resolver walks the following signals in order. The first candidate
that both **validates** and is **not a dev hostname** wins. A candidate
that fails validation is discarded silently; a candidate that validates
but is a dev hostname is skipped in the primary pass and only used as a
last-resort dev fallback (see below).

1. **`PUBLIC_APP_URL` secret** (falls back to `SITE_URL` if unset).
   Single knob that always wins — same URL for cron, preview builds,
   curl smoke tests, and prod. Set this whenever emails should point at
   a fixed public origin regardless of who invoked the request.
2. **`x-forwarded-host`** (proto from `x-forwarded-proto`, default
   `https`). This is the signal Cloudflare and other reverse proxies
   set to the client-facing host. Only the first comma-separated token
   is used.
3. **`host` header** on the request (proto from `x-forwarded-proto` if
   present, default `https`). Used for proxy-less deployments.
4. **`Origin` header** on the request. Present on browser-initiated
   requests; validated as a full URL.
5. **Dev fallback pass.** Same four signals are re-checked with the
   dev-hostname filter disabled, so local `curl` smoke tests still get
   a usable preview URL when nothing production-y is available.
6. **Hardcoded production fallback**: `https://princesspink90.com`. Used
   only when every prior signal is missing or invalid, so cron-triggered
   emails always ship a reachable link.

### Validation rules

Every candidate — env, header, or origin — must pass all of these before
being accepted:

- Protocol is `http` or `https` (rejects `javascript:`, `data:`, `ftp:`, etc.).
- No userinfo (`user:pass@host`).
- No path, query, or fragment beyond the bare origin.
- Length ≤ 512 chars; hostname ≤ 253 chars (RFC 1035).
- Hostname is a valid DNS name, IPv4 literal, or IPv6 literal (via URL parser).
- Port, if present, is a valid 1–65535 integer.
- No CRLF, null bytes, or whitespace anywhere in the value (defuses
  header-smuggling and injection attacks).

The final origin is round-tripped through the WHATWG URL parser so
casing, IDN, IPv6 brackets, and default ports (`:443`, `:80`) are
normalized before it is embedded in an email link.

### "Dev" hostnames (demoted in the primary pass)

`resolveAppOrigin` treats these as dev-only and skips them until the
fallback pass:

- `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`
- Anything ending in `.local` or `.localhost`
- RFC 1918 private ranges: `10.x`, `192.168.x`, `172.16.x`–`172.31.x`
- Link-local `169.254.x.x`

This is why a dev `PUBLIC_APP_URL=http://localhost:8080` is ignored the
moment a real proxy header (e.g. `x-forwarded-host: app.princesspink90.com`)
is present — the proxy wins in the primary pass.

### Proxy configuration checklist

For emails to render the correct public origin behind a proxy:

- Set `PUBLIC_APP_URL` on the production environment when you want a
  single fixed public origin regardless of caller. Recommended for
  cron/webhook-driven mail.
- Ensure the proxy sets **both** `x-forwarded-host` and
  `x-forwarded-proto` (usually `https`). Missing proto defaults to
  `https`, which is the correct assumption in production but silently
  wrong if you're actually serving over `http`.
- Do not send comma-separated `x-forwarded-host` chains that contain
  whitespace — the whole header is rejected as a smuggling signal.
  Chains with no spaces (`a.example,b.internal,c.internal`) are fine;
  the first token is used.
- Never rely on the `Origin` header for cron-triggered mail — it isn't
  set on server-to-server requests. Use `PUBLIC_APP_URL` or trust
  `x-forwarded-host` instead.

### Verifying resolution

Two endpoints are available to sanity-check what the resolver would
produce without sending an email:

- `GET /api/public/hooks/preview-portal-link` — echoes the resolved
  origin and portal URL for the incoming request's real headers.
- `POST /api/public/hooks/preview-portal-link` with
  `{ "headers": { "x-forwarded-host": "...", "x-forwarded-proto": "..." } }`
  — simulates arbitrary header combinations against the same resolver.

Automated coverage lives in
[`src/lib/app-origin.test.ts`](src/lib/app-origin.test.ts) and
[`src/lib/healthScreeningReminderIntegration.test.ts`](src/lib/healthScreeningReminderIntegration.test.ts).
