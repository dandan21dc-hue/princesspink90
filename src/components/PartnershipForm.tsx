import { useState } from 'react'
import { toast } from 'sonner'

const TYPES = [
  { value: 'venue', label: 'Venue / space' },
  { value: 'sponsor', label: 'Sponsorship' },
  { value: 'collab', label: 'Collaboration' },
  { value: 'media', label: 'Media / press' },
  { value: 'other', label: 'Something else' },
] as const

export function PartnershipForm() {
  const [state, setState] = useState({
    name: '',
    email: '',
    organization: '',
    inquiryType: 'venue' as (typeof TYPES)[number]['value'],
    message: '',
    website: '', // honeypot
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/partnership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Something went wrong.')
      }
      setDone(true)
      toast.success("Got it — I'll be in touch.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="py-6 text-center">
        <h2 className="font-display text-2xl font-bold">Thanks — message received.</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          A confirmation is on the way to <strong>{state.email}</strong>. I read every
          partnership enquiry personally and reply within a few days.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required>
          <input
            id="partnership-name"
            required maxLength={200}
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            className={inputClass}
          />
        </Field>
        <Field label="Email" required>
          <input
            required type="email" maxLength={320}
            value={state.email}
            onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Organization (optional)">
        <input
          maxLength={200}
          value={state.organization}
          onChange={(e) => setState((s) => ({ ...s, organization: e.target.value }))}
          className={inputClass}
        />
      </Field>
      <Field label="What kind of partnership?" required>
        <select
          value={state.inquiryType}
          onChange={(e) => setState((s) => ({ ...s, inquiryType: e.target.value as any }))}
          className={inputClass}
        >
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Tell me more" required>
        <textarea
          required maxLength={5000} rows={6}
          value={state.message}
          onChange={(e) => setState((s) => ({ ...s, message: e.target.value }))}
          className={`${inputClass} resize-y`}
          placeholder="What are you proposing, and roughly when?"
        />
      </Field>
      {/* Honeypot — hidden from users, only bots fill it */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input
            type="text" tabIndex={-1} autoComplete="off"
            value={state.website}
            onChange={(e) => setState((s) => ({ ...s, website: e.target.value }))}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-neon px-6 py-3 text-sm font-semibold uppercase tracking-widest text-background shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send enquiry'}
      </button>
      <p className="text-xs text-muted-foreground">
        By sending, you consent to Midnight Glory emailing you a reply. We never share
        your details.
      </p>
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}{required && <span className="text-neon"> *</span>}
      </span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-neon transition'
