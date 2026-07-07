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

function ConnectPage() {
  const [mcpUrl, setMcpUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')

  useEffect(() => {
    setMcpUrl(new URL('/mcp', window.location.origin).toString())
  }, [])

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
          <code className="flex-1 truncate rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
            {mcpUrl || 'Loading…'}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={!mcpUrl}
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-wider hover:bg-secondary/50 transition disabled:opacity-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Paste this URL into the connector setup in your assistant.
        </p>
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

      <p className="mt-10 text-sm text-muted-foreground">
        The assistant discovers the available tools automatically once connected.
      </p>
    </main>
  )
}
