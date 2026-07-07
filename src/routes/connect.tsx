import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/connect')({
  head: () => ({
    meta: [
      { title: 'Connect an AI assistant to Princess Pink' },
      {
        name: 'description',
        content:
          'Paste one URL into ChatGPT or Claude to let it look up Princess Pink venue info and submit partnership inquiries on your behalf.',
      },
      { property: 'og:title', content: 'Connect an AI assistant to Princess Pink' },
      {
        property: 'og:description',
        content: 'Use Princess Pink as a connector inside ChatGPT or Claude.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: ConnectPage,
})

const STORAGE_KEY = 'princess-pink:mcp-url'
const AUTH_STORAGE_KEY = 'princess-pink:mcp-auth'

type AuthConfig = {
  bearer: string
  headers: string // raw text: "Key: value" per line
}

function parseHeaderLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function ConnectPage() {
  const [defaultUrl, setDefaultUrl] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [auth, setAuth] = useState<AuthConfig>({ bearer: '', headers: '' })
  const [authSaved, setAuthSaved] = useState(false)

  useEffect(() => {
    const derived = new URL('/mcp', window.location.origin).toString()
    setDefaultUrl(derived)
    const stored = window.localStorage.getItem(STORAGE_KEY)
    setMcpUrl(stored && stored.trim() ? stored.trim() : derived)
    if (stored && stored.trim()) setSaved(true)
    const storedAuth = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth) as Partial<AuthConfig>
        setAuth({ bearer: parsed.bearer ?? '', headers: parsed.headers ?? '' })
        setAuthSaved(true)
      } catch {
        /* ignore */
      }
    }
  }, [])

  function updateAuth(next: AuthConfig) {
    setAuth(next)
    const hasValue = next.bearer.trim() !== '' || next.headers.trim() !== ''
    if (hasValue) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
      setAuthSaved(true)
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      setAuthSaved(false)
    }
    setStatus('idle')
    setStatusDetail('')
  }

  function clearAuth() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setAuth({ bearer: '', headers: '' })
    setAuthSaved(false)
    setStatus('idle')
    setStatusDetail('')
  }

  function saveUrl(next: string) {
    const trimmed = next.trim()
    setMcpUrl(trimmed)
    if (trimmed && trimmed !== defaultUrl) {
      window.localStorage.setItem(STORAGE_KEY, trimmed)
      setSaved(true)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
      setSaved(false)
    }
    setStatus('idle')
    setStatusDetail('')
  }

  function resetUrl() {
    window.localStorage.removeItem(STORAGE_KEY)
    setMcpUrl(defaultUrl)
    setSaved(false)
    setStatus('idle')
    setStatusDetail('')
  }

  async function copy() {
    if (!mcpUrl) return
    try {
      await navigator.clipboard.writeText(mcpUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }


  async function testConnection() {
    if (!mcpUrl) return
    setStatus('testing')
    setStatusDetail('')
    try {
      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'princess-pink-connect-page', version: '1.0.0' },
          },
        }),
      })
      if (!res.ok) {
        setStatus('error')
        setStatusDetail(`HTTP ${res.status}`)
        return
      }
      const text = await res.text()
      if (text.includes('"result"') && text.includes('serverInfo')) {
        setStatus('ok')
        setStatusDetail('Server responded to initialize')
      } else if (text.includes('"error"')) {
        setStatus('error')
        setStatusDetail('Server returned a JSON-RPC error')
      } else {
        setStatus('ok')
        setStatusDetail('Server reachable')
      }
    } catch (err) {
      setStatus('error')
      setStatusDetail(err instanceof Error ? err.message : 'Network error')
    }
  }

  const dotClass =
    status === 'ok'
      ? 'bg-emerald-500'
      : status === 'error'
        ? 'bg-red-500'
        : status === 'testing'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-muted-foreground/40'
  const statusLabel =
    status === 'ok'
      ? 'Online'
      : status === 'error'
        ? 'Unreachable'
        : status === 'testing'
          ? 'Testing…'
          : 'Not tested'


  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-neon">Agent integrations</div>
      <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
        Connect an <span className="text-neon">AI assistant</span>
      </h1>
      <p className="mt-5 text-muted-foreground leading-relaxed">
        Add Princess Pink to ChatGPT or Claude as a connector. Once connected, the
        assistant can look up public venue info and file partnership inquiries for you.
      </p>

      <section className="mt-10 rounded-3xl border border-primary/30 bg-card/40 p-6 sm:p-8">
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
          MCP server URL
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="url"
            value={mcpUrl}
            onChange={(e) => saveUrl(e.target.value)}
            placeholder={defaultUrl || 'https://…/mcp'}
            spellCheck={false}
            className="flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!mcpUrl}
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-wider hover:bg-secondary/50 transition disabled:opacity-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            {saved
              ? 'Saved to this browser — reused automatically next visit.'
              : 'Paste a custom URL to override the default, or leave as-is.'}
          </span>
          {saved && (
            <button
              type="button"
              onClick={resetUrl}
              className="rounded border border-border px-2 py-1 uppercase tracking-wider hover:bg-secondary/50 transition"
            >
              Reset to default
            </button>
          )}
        </div>


        <div className="mt-6 flex flex-col gap-3 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} aria-hidden />
            <div className="text-sm">
              <div className="font-medium">{statusLabel}</div>
              {statusDetail && (
                <div className="text-xs text-muted-foreground">{statusDetail}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={testConnection}
            disabled={!mcpUrl || status === 'testing'}
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-wider hover:bg-secondary/50 transition disabled:opacity-50"
          >
            {status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </section>


      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">ChatGPT</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-6 text-muted-foreground leading-relaxed">
          <li>
            Open{' '}
            <a
              className="text-neon underline"
              href="https://chatgpt.com/#settings/Connectors/Advanced"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT → Settings → Connectors → Advanced
            </a>{' '}
            and enable <strong>Developer mode</strong> (read the risk notice shown there).
          </li>
          <li>
            In the chat composer's <strong>+</strong> menu, turn on Developer mode.
          </li>
          <li>
            Click <strong>Add sources</strong>, then <strong>Connect more</strong>.
          </li>
          <li>Name the connector “Princess Pink” and paste the MCP URL above.</li>
          <li>Ask ChatGPT to use Princess Pink — e.g. “What are the house principles?”</li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">Claude</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-6 text-muted-foreground leading-relaxed">
          <li>
            Open{' '}
            <a
              className="text-neon underline"
              href="https://claude.ai/customize/connectors?modal=add-custom-connector"
              target="_blank"
              rel="noreferrer"
            >
              Claude → Custom connectors
            </a>
            .
          </li>
          <li>Name the connector “Princess Pink” and paste the MCP URL above.</li>
          <li>
            Enable the connector from the chat composer, then ask Claude to use Princess Pink.
          </li>
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold">Troubleshooting</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Common issues when connecting an assistant to the Princess Pink MCP server.
        </p>

        <div className="mt-6 space-y-5">
          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              “Test connection” shows Unreachable / network error
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                The browser could not reach <code>/mcp</code>. Refresh the page so the URL is
                re-derived from the live origin, then retry. If it still fails, the deployment
                may be mid-restart — wait a moment and test again.
              </p>
              <p>Confirm the URL ends with <code>/mcp</code> and uses <code>https://</code>.</p>
            </div>
          </details>

          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              HTTP 406 “Not Acceptable” from the assistant
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                The MCP spec requires clients to send{' '}
                <code>Accept: application/json, text/event-stream</code>. ChatGPT and Claude do
                this automatically. If you're wiring a custom client or proxy (for example a
                Supabase edge function), add that <code>Accept</code> header to every POST.
              </p>
            </div>
          </details>

          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              HTTP 405 “Method Not Allowed”
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                The MCP endpoint only accepts <strong>POST</strong> with a JSON-RPC body. A
                plain browser visit to <code>/mcp</code> returns 405 — that's expected, not a
                bug. Use the Test connection button above instead.
              </p>
            </div>
          </details>

          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              CORS error (“No 'Access-Control-Allow-Origin' header”)
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Real MCP clients (ChatGPT, Claude, Cursor) call the server from their own
                backend, so CORS never applies to them. You'll only see CORS errors when
                calling <code>/mcp</code> from a browser on a different origin.
              </p>
              <p>
                Fix: call from the same origin as the app, or proxy through your own server
                and forward the request with the correct <code>Content-Type</code> and{' '}
                <code>Accept</code> headers.
              </p>
            </div>
          </details>

          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              Assistant says it can't see the tools
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Make sure the connector is toggled on <em>inside the chat composer</em> for
                the current conversation, not just added in settings. In ChatGPT, also confirm
                Developer mode is enabled both globally and in the composer's <strong>+</strong>{' '}
                menu.
              </p>
              <p>Then start a new message so the assistant re-reads the tool list.</p>
            </div>
          </details>

          <details className="rounded-2xl border border-border/60 bg-card/40 p-5">
            <summary className="cursor-pointer font-medium">
              HTTP 401 / 403 Unauthorized
            </summary>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                The Princess Pink MCP server is public — no token is required. A 401 or 403
                means the request went to a different URL. Re-copy the URL above and paste it
                into the connector settings.
              </p>
            </div>
          </details>
        </div>
      </section>

      <p className="mt-10 text-sm text-muted-foreground">
        The assistant discovers the available tools automatically once connected.
      </p>

    </main>
  )
}
