import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  head: () => ({
    meta: [
      { title: 'Unsubscribe — Midnight Glory' },
      { name: 'description', content: 'Unsubscribe from Midnight Glory emails.' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: UnsubscribePage,
})

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'already' }
  | { kind: 'confirm' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (!t) {
      setState({ kind: 'invalid', message: 'Missing unsubscribe token.' })
      return
    }
    setToken(t)
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setState({ kind: 'invalid', message: body.error || 'Invalid or expired link.' })
          return
        }
        if (body.valid === false && body.reason === 'already_unsubscribed') {
          setState({ kind: 'already' })
          return
        }
        setState({ kind: 'confirm' })
      })
      .catch(() => setState({ kind: 'invalid', message: 'Could not validate link.' }))
  }, [])

  async function confirm() {
    if (!token) return
    setState({ kind: 'submitting' })
    try {
      const res = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState({ kind: 'error', message: body.error || 'Failed to unsubscribe.' })
        return
      }
      if (body.success === false && body.reason === 'already_unsubscribed') {
        setState({ kind: 'already' })
        return
      }
      setState({ kind: 'done' })
    } catch {
      setState({ kind: 'error', message: 'Network error.' })
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-5 py-16">
      <div className="w-full rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
        <div className="text-xs uppercase tracking-[0.3em] text-neon">Email preferences</div>
        <h1 className="mt-2 font-display text-2xl font-bold">Unsubscribe</h1>
        <div className="mt-6 text-sm text-muted-foreground">
          {state.kind === 'loading' && <p>Checking your link…</p>}
          {state.kind === 'invalid' && <p>{state.message}</p>}
          {state.kind === 'already' && <p>You're already unsubscribed. No further emails will be sent.</p>}
          {state.kind === 'confirm' && (
            <>
              <p>Click below to unsubscribe from all Midnight Glory emails.</p>
              <button
                onClick={confirm}
                className="mt-6 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:brightness-110"
              >
                Confirm unsubscribe
              </button>
            </>
          )}
          {state.kind === 'submitting' && <p>Working…</p>}
          {state.kind === 'done' && <p>Done — you've been unsubscribed.</p>}
          {state.kind === 'error' && <p className="text-red-400">{state.message}</p>}
        </div>
      </div>
    </div>
  )
}
