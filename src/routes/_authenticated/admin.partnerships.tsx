import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  listPartnershipEmailEvents,
  listPartnershipEmailSummary,
  listPartnershipInquiries,
  listPartnershipReplies,
  sendPartnershipReply,
  updatePartnershipInquiry,
} from '@/lib/partnership.functions'

type EmailEvent = {
  kind: 'confirmation' | 'notification' | 'reply'
  messageId: string
  status: string | null
  errorMessage: string | null
  createdAt: string
  templateName: string | null
  recipientEmail: string | null
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

function EmailKindLabel({ kind }: { kind: EmailEvent['kind'] }) {
  const map: Record<EmailEvent['kind'], string> = {
    confirmation: 'Auto-confirmation to sender',
    notification: 'Internal notification',
    reply: 'Admin reply',
  }
  return <span className="font-display text-sm font-semibold">{map[kind]}</span>
}

export const Route = createFileRoute('/_authenticated/admin/partnerships')({
  head: () => ({ meta: [{ title: 'Partnerships — Admin' }, { name: 'robots', content: 'noindex' }] }),
  component: AdminPartnerships,
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

const STATUS_LABEL: Record<Inquiry['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  archived: 'Archived',
}

function AdminPartnerships() {
  const listFn = useServerFn(listPartnershipInquiries)
  const summaryFn = useServerFn(listPartnershipEmailSummary)
  const q = useQuery({ queryKey: ['partnership-inquiries'], queryFn: () => listFn() })
  const [selected, setSelected] = useState<Inquiry | null>(null)
  const [filter, setFilter] = useState<'all' | Inquiry['status']>('all')

  const inquiries = (q.data?.inquiries ?? []) as Inquiry[]
  const filtered = filter === 'all' ? inquiries : inquiries.filter((i) => i.status === filter)

  const ids = inquiries.map((i) => i.id)
  const summaryQ = useQuery({
    queryKey: ['partnership-email-summary', ids.join(',')],
    queryFn: () => summaryFn({ data: { inquiryIds: ids } }),
    enabled: ids.length > 0,
  })
  const summary = summaryQ.data?.summary ?? {}

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-neon">Admin</div>
          <h1 className="mt-1 font-display text-3xl font-bold">Partnership enquiries</h1>
        </div>
        <div className="flex gap-2 text-xs">
          {(['all', 'new', 'contacted', 'archived'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 uppercase tracking-widest transition ${
                filter === f
                  ? 'border-neon bg-neon/10 text-neon'
                  : 'border-border/60 text-muted-foreground hover:border-neon/40'
              }`}
            >
              {f}
              {f !== 'all' && ` (${inquiries.filter((i) => i.status === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-sm text-red-400">Failed to load: {String(q.error)}</p>}

      {q.data && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center text-sm text-muted-foreground">
          No enquiries {filter === 'all' ? 'yet' : `in “${filter}”`}.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="space-y-2">
          {filtered.map((i) => (
            <li key={i.id}>
              <div
                className={`rounded-xl border p-4 transition ${
                  selected?.id === i.id
                    ? 'border-neon bg-neon/5'
                    : 'border-border/60 bg-card/40 hover:border-neon/40'
                }`}
              >
                <button onClick={() => setSelected(i)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-display text-sm font-semibold">{i.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                        i.status === 'new'
                          ? 'bg-neon/20 text-neon'
                          : i.status === 'contacted'
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {STATUS_LABEL[i.status]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {i.organization ? `${i.organization} · ` : ''}{i.email}
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{i.message}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <EmailStatusBadge label="Confirm" status={summary[i.id]?.confirmation?.status ?? 'not sent'} />
                    <EmailStatusBadge label="Notify" status={summary[i.id]?.notification?.status ?? 'not sent'} />
                  </div>
                </button>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  <span>{new Date(i.created_at).toLocaleString()}</span>
                  <Link
                    to="/admin/partnerships/$id"
                    params={{ id: i.id }}
                    className="text-neon hover:brightness-125"
                  >
                    Open detail →
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="min-h-[300px]">
          {selected ? <InquiryDetail inquiry={selected} onClose={() => setSelected(null)} /> : (
            <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center text-sm text-muted-foreground">
              Select an enquiry to reply.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function InquiryDetail({ inquiry, onClose }: { inquiry: Inquiry; onClose: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const listRepliesFn = useServerFn(listPartnershipReplies)
  const sendReplyFn = useServerFn(sendPartnershipReply)
  const updateFn = useServerFn(updatePartnershipInquiry)
  const emailEventsFn = useServerFn(listPartnershipEmailEvents)

  const replies = useQuery({
    queryKey: ['partnership-replies', inquiry.id],
    queryFn: () => listRepliesFn({ data: { inquiryId: inquiry.id } }),
  })

  const emailEvents = useQuery({
    queryKey: ['partnership-email-events', inquiry.id],
    queryFn: () => emailEventsFn({ data: { inquiryId: inquiry.id } }),
  })

  const [subject, setSubject] = useState(`Re: your Princess Pink enquiry`)
  const [body, setBody] = useState('')

  const sendMut = useMutation({
    mutationFn: () =>
      sendReplyFn({ data: { inquiryId: inquiry.id, subject: subject.trim(), body: body.trim() } }),
    onSuccess: () => {
      toast.success('Reply sent.')
      setBody('')
      qc.invalidateQueries({ queryKey: ['partnership-replies', inquiry.id] })
      qc.invalidateQueries({ queryKey: ['partnership-email-events', inquiry.id] })
      qc.invalidateQueries({ queryKey: ['partnership-email-summary'] })
      qc.invalidateQueries({ queryKey: ['partnership-inquiries'] })
      router.invalidate()
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to send reply.'),
  })

  const setStatusMut = useMutation({
    mutationFn: (status: Inquiry['status']) => updateFn({ data: { inquiryId: inquiry.id, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partnership-inquiries'] })
    },
  })

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">{inquiry.name}</h2>
          <div className="text-sm text-muted-foreground">
            <a href={`mailto:${inquiry.email}`} className="hover:text-neon">{inquiry.email}</a>
            {inquiry.organization && <> · {inquiry.organization}</>}
            {inquiry.inquiry_type && <> · <span className="uppercase tracking-wider">{inquiry.inquiry_type}</span></>}
          </div>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      <div className="mt-4 whitespace-pre-wrap rounded-lg border border-border/40 bg-background/40 p-4 text-sm">
        {inquiry.message}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(['new', 'contacted', 'archived'] as const).map((s) => (
          <button
            key={s}
            disabled={inquiry.status === s || setStatusMut.isPending}
            onClick={() => setStatusMut.mutate(s)}
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

      <div className="mt-6">
        <div className="mb-2 text-xs uppercase tracking-widest text-neon">Reply from your Princess Pink address</div>
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
      </div>

      <div className="mt-8">
        <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Reply history</div>
        {replies.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {replies.data && replies.data.replies.length === 0 && (
          <p className="text-xs text-muted-foreground">No replies sent yet.</p>
        )}
        <ul className="space-y-3">
          {(replies.data?.replies ?? []).map((r: any) => (
            <li key={r.id} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{r.subject}</span>
                <span>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Email delivery</span>
          <button
            onClick={() => emailEvents.refetch()}
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-neon"
          >
            {emailEvents.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {emailEvents.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {emailEvents.error && (
          <p className="text-xs text-red-400">Failed to load email events: {String((emailEvents.error as Error).message)}</p>
        )}
        {emailEvents.data && emailEvents.data.events.length === 0 && (
          <p className="text-xs text-muted-foreground">No email sends logged for this enquiry.</p>
        )}
        <ul className="space-y-2">
          {(emailEvents.data?.events ?? []).map((e: EmailEvent) => (
            <li key={e.messageId} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <EmailKindLabel kind={e.kind} />
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
      </div>
    </div>
  )
}
