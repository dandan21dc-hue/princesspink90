import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  listPartnershipEmailEvents,
  listPartnershipInquiries,
  listPartnershipReplies,
  sendPartnershipReply,
  updatePartnershipInquiry,
} from '@/lib/partnership.functions'

export const Route = createFileRoute('/_authenticated/admin/partnerships/$id')({
  head: () => ({ meta: [{ title: 'Partnership enquiry — Admin' }, { name: 'robots', content: 'noindex' }] }),
  component: PartnershipDetailPage,
})

type Inquiry = {
  id: string
  created_at: string
  updated_at: string
  name: string
  email: string
  organization: string | null
  inquiry_type: string | null
  message: string
  status: 'new' | 'contacted' | 'archived'
  notes: string | null
}

type EmailEvent = {
  kind: 'confirmation' | 'notification' | 'reply'
  messageId: string
  status: string | null
  errorMessage: string | null
  createdAt: string
  templateName: string | null
  recipientEmail: string | null
}

const STATUS_LABEL: Record<Inquiry['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  archived: 'Archived',
}

const EMAIL_STATUS_STYLES: Record<string, string> = {
  sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  suppressed: 'bg-muted text-muted-foreground border-border/60',
  dlq: 'bg-red-500/15 text-red-300 border-red-500/30',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
  bounced: 'bg-red-500/15 text-red-300 border-red-500/30',
  complained: 'bg-red-500/15 text-red-300 border-red-500/30',
}

function EmailStatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  const s = status ?? 'unknown'
  const cls = EMAIL_STATUS_STYLES[s] ?? 'bg-muted text-muted-foreground border-border/60'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>
      {label ? `${label}: ${s}` : s}
    </span>
  )
}

function EMAIL_KIND(kind: EmailEvent['kind']) {
  return kind === 'confirmation'
    ? 'Auto-confirmation to sender'
    : kind === 'notification'
      ? 'Internal notification'
      : 'Admin reply'
}

function PartnershipDetailPage() {
  const { id } = Route.useParams()
  const qc = useQueryClient()
  const router = useRouter()
  const listFn = useServerFn(listPartnershipInquiries)
  const listRepliesFn = useServerFn(listPartnershipReplies)
  const sendReplyFn = useServerFn(sendPartnershipReply)
  const updateFn = useServerFn(updatePartnershipInquiry)
  const emailEventsFn = useServerFn(listPartnershipEmailEvents)

  const inquiriesQ = useQuery({ queryKey: ['partnership-inquiries'], queryFn: () => listFn() })
  const inquiry = ((inquiriesQ.data?.inquiries ?? []) as Inquiry[]).find((i) => i.id === id) ?? null

  const repliesQ = useQuery({
    queryKey: ['partnership-replies', id],
    queryFn: () => listRepliesFn({ data: { inquiryId: id } }),
    enabled: !!inquiry,
  })

  const emailEventsQ = useQuery({
    queryKey: ['partnership-email-events', id],
    queryFn: () => emailEventsFn({ data: { inquiryId: id } }),
    enabled: !!inquiry,
  })

  const [subject, setSubject] = useState('Re: your Princess Pink enquiry')
  const [body, setBody] = useState('')
  const [notes, setNotes] = useState<string | null>(null)

  const sendMut = useMutation({
    mutationFn: () => sendReplyFn({ data: { inquiryId: id, subject: subject.trim(), body: body.trim() } }),
    onSuccess: () => {
      toast.success('Reply sent.')
      setBody('')
      qc.invalidateQueries({ queryKey: ['partnership-replies', id] })
      qc.invalidateQueries({ queryKey: ['partnership-email-events', id] })
      qc.invalidateQueries({ queryKey: ['partnership-email-summary'] })
      qc.invalidateQueries({ queryKey: ['partnership-inquiries'] })
      router.invalidate()
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to send reply.'),
  })

  const statusMut = useMutation({
    mutationFn: (status: Inquiry['status']) => updateFn({ data: { inquiryId: id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partnership-inquiries'] }),
  })

  const notesMut = useMutation({
    mutationFn: (next: string) => updateFn({ data: { inquiryId: id, notes: next.trim() || null } }),
    onSuccess: () => {
      toast.success('Notes saved.')
      qc.invalidateQueries({ queryKey: ['partnership-inquiries'] })
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save notes.'),
  })

  if (inquiriesQ.isLoading) {
    return <main className="mx-auto max-w-4xl px-5 py-10 text-sm text-muted-foreground">Loading…</main>
  }
  if (!inquiry) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <Link to="/admin/partnerships" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-neon">
          ← Back to enquiries
        </Link>
        <p className="mt-6 text-sm text-red-400">Enquiry not found.</p>
      </main>
    )
  }

  const currentNotes = notes ?? inquiry.notes ?? ''

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 space-y-8">
      <div>
        <Link to="/admin/partnerships" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-neon">
          ← Back to enquiries
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-neon">Partnership enquiry</div>
            <h1 className="mt-1 font-display text-3xl font-bold">{inquiry.name}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              <a href={`mailto:${inquiry.email}`} className="hover:text-neon">{inquiry.email}</a>
              {inquiry.organization && <> · {inquiry.organization}</>}
              {inquiry.inquiry_type && <> · <span className="uppercase tracking-widest">{inquiry.inquiry_type}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['new', 'contacted', 'archived'] as const).map((s) => (
              <button
                key={s}
                disabled={inquiry.status === s || statusMut.isPending}
                onClick={() => statusMut.mutate(s)}
                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition ${
                  inquiry.status === s
                    ? 'border-neon bg-neon/10 text-neon'
                    : 'border-border/60 text-muted-foreground hover:border-neon/40'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-5 text-sm sm:grid-cols-2">
        <Field label="Enquiry ID" value={<code className="text-xs">{inquiry.id}</code>} />
        <Field label="Status" value={STATUS_LABEL[inquiry.status]} />
        <Field label="Type" value={inquiry.inquiry_type ?? '—'} />
        <Field label="Organization" value={inquiry.organization ?? '—'} />
        <Field label="Submitted" value={new Date(inquiry.created_at).toLocaleString()} />
        <Field label="Last updated" value={new Date(inquiry.updated_at).toLocaleString()} />
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Message</h2>
        <div className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-background/40 p-5 text-sm">
          {inquiry.message}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Internal notes</h2>
        <textarea
          value={currentNotes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Only visible to admins…"
          className="w-full resize-y rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-neon"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => notesMut.mutate(currentNotes)}
            disabled={notesMut.isPending || currentNotes === (inquiry.notes ?? '')}
            className="rounded-md border border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-widest hover:border-neon disabled:opacity-50"
          >
            {notesMut.isPending ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neon">Send reply</h2>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-neon"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Write your reply…"
          className="mt-2 w-full resize-y rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-neon"
        />
        <button
          onClick={() => sendMut.mutate()}
          disabled={sendMut.isPending || body.trim().length === 0 || subject.trim().length === 0}
          className="mt-3 rounded-md bg-neon px-5 py-2 text-xs font-semibold uppercase tracking-widest text-background hover:brightness-110 disabled:opacity-50"
        >
          {sendMut.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Reply history</h2>
        {repliesQ.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {repliesQ.data && repliesQ.data.replies.length === 0 && (
          <p className="text-xs text-muted-foreground">No replies sent yet.</p>
        )}
        <ul className="space-y-3">
          {(repliesQ.data?.replies ?? []).map((r: any) => (
            <li key={r.id} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{r.subject}</span>
                <span>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Email delivery</h2>
          <button
            onClick={() => emailEventsQ.refetch()}
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-neon"
          >
            {emailEventsQ.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {emailEventsQ.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {emailEventsQ.data && emailEventsQ.data.events.length === 0 && (
          <p className="text-xs text-muted-foreground">No email sends logged for this enquiry.</p>
        )}
        <ul className="space-y-2">
          {(emailEventsQ.data?.events ?? []).map((e: EmailEvent) => (
            <li key={e.messageId} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-semibold">{EMAIL_KIND(e.kind)}</span>
                  <EmailStatusBadge status={e.status} />
                </div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {e.recipientEmail ?? '—'}
                {e.templateName && <> · <span className="uppercase tracking-widest">{e.templateName}</span></>}
              </div>
              {e.errorMessage && (
                <p className="mt-2 whitespace-pre-wrap rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                  {e.errorMessage}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  )
}
