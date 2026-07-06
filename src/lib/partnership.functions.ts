import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

async function ensureAdmin(context: any) {
  const { data, error } = await context.supabase.rpc('has_role', {
    _user_id: context.userId,
    _role: 'admin',
  })
  if (error || !data) throw new Error('Forbidden')
}

export const listPartnershipInquiries = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context)
    const { data, error } = await context.supabase
      .from('partnership_inquiries')
      .select('id, created_at, updated_at, name, email, organization, inquiry_type, message, status, notes')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return { inquiries: data ?? [] }
  })

export const listPartnershipReplies = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { inquiryId: string }) => z.object({ inquiryId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context)
    const { data: rows, error } = await context.supabase
      .from('partnership_replies')
      .select('id, created_at, subject, body, sent_by')
      .eq('inquiry_id', data.inquiryId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return { replies: rows ?? [] }
  })

const replySchema = z.object({
  inquiryId: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
})

export const sendPartnershipReply = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof replySchema>) => replySchema.parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context)

    // Load inquiry (as the admin user; RLS admin-select policy applies)
    const { data: inquiry, error: loadErr } = await context.supabase
      .from('partnership_inquiries')
      .select('id, name, email, message')
      .eq('id', data.inquiryId)
      .maybeSingle()
    if (loadErr) throw loadErr
    if (!inquiry) throw new Error('Inquiry not found')

    // Insert reply record
    const { error: insertErr } = await context.supabase
      .from('partnership_replies')
      .insert({
        inquiry_id: data.inquiryId,
        sent_by: context.userId,
        subject: data.subject,
        body: data.body,
      })
    if (insertErr) throw insertErr

    // Mark inquiry as contacted
    await context.supabase
      .from('partnership_inquiries')
      .update({ status: 'contacted' })
      .eq('id', data.inquiryId)

    // Enqueue the actual email (server-only helper)
    const { enqueueTemplateEmail } = await import('@/lib/email/enqueue.server')
    const result = await enqueueTemplateEmail({
      templateName: 'partnership-reply',
      recipientEmail: inquiry.email,
      idempotencyKey: `partnership-reply-${data.inquiryId}-${Date.now()}`,
      templateData: {
        name: inquiry.name,
        subject: data.subject,
        body: data.body,
        originalMessage: inquiry.message,
      },
    })

    if (!result.success) {
      throw new Error(`Reply saved but email failed: ${result.reason}`)
    }
    return { success: true }
  })

const updateSchema = z.object({
  inquiryId: z.string().uuid(),
  status: z.enum(['new', 'contacted', 'archived']).optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export const updatePartnershipInquiry = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof updateSchema>) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context)
    const patch: { status?: 'new' | 'contacted' | 'archived'; notes?: string | null } = {}
    if (data.status !== undefined) patch.status = data.status
    if (data.notes !== undefined) patch.notes = data.notes
    if (Object.keys(patch).length === 0) return { success: true }
    const { error } = await context.supabase
      .from('partnership_inquiries')
      .update(patch)
      .eq('id', data.inquiryId)
    if (error) throw error
    return { success: true }
  })

type EmailLogRow = {
  message_id: string | null
  status: string | null
  error_message: string | null
  created_at: string
  template_name: string | null
  recipient_email: string | null
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

function latestByMessageId(rows: EmailLogRow[]): EmailLogRow[] {
  const map = new Map<string, EmailLogRow>()
  for (const r of rows) {
    if (!r.message_id) continue
    const prev = map.get(r.message_id)
    if (!prev || new Date(r.created_at).getTime() > new Date(prev.created_at).getTime()) {
      map.set(r.message_id, r)
    }
  }
  return [...map.values()]
}

/**
 * Summary of the auto-sent confirmation + internal-notification emails for
 * a batch of inquiries. Returns latest row per message_id.
 */
export const listPartnershipEmailSummary = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { inquiryIds: string[] }) =>
    z.object({ inquiryIds: z.array(z.string().uuid()).max(500) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await ensureAdmin(context)
    if (data.inquiryIds.length === 0) return { summary: {} as Record<string, { confirmation: EmailEvent | null; notification: EmailEvent | null }> }

    const keys: string[] = []
    for (const id of data.inquiryIds) {
      keys.push(`partnership-confirmation-${id}`, `partnership-notification-${id}`)
    }

    const { data: rows, error } = await context.supabase
      .from('email_send_log')
      .select('message_id, status, error_message, created_at, template_name, recipient_email')
      .in('message_id', keys)
      .order('created_at', { ascending: false })
    if (error) throw error

    const latest = latestByMessageId((rows ?? []) as EmailLogRow[])
    const summary: Record<string, { confirmation: EmailEvent | null; notification: EmailEvent | null }> = {}
    for (const id of data.inquiryIds) summary[id] = { confirmation: null, notification: null }
    for (const r of latest) {
      if (!r.message_id) continue
      const confMatch = r.message_id.match(/^partnership-confirmation-(.+)$/)
      const notifMatch = r.message_id.match(/^partnership-notification-(.+)$/)
      const id = confMatch?.[1] ?? notifMatch?.[1]
      if (!id || !summary[id]) continue
      const event: EmailEvent = {
        kind: confMatch ? 'confirmation' : 'notification',
        messageId: r.message_id,
        status: r.status,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        templateName: r.template_name,
        recipientEmail: r.recipient_email,
      }
      if (confMatch) summary[id].confirmation = event
      else summary[id].notification = event
    }
    return { summary }
  })

/**
 * Full email event history for a single inquiry (confirmation, internal
 * notification, and every admin reply). Latest row per message_id.
 */
export const listPartnershipEmailEvents = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { inquiryId: string }) => z.object({ inquiryId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context)
    const id = data.inquiryId
    const { data: rows, error } = await context.supabase
      .from('email_send_log')
      .select('message_id, status, error_message, created_at, template_name, recipient_email')
      .or(
        `message_id.eq.partnership-confirmation-${id},message_id.eq.partnership-notification-${id},message_id.like.partnership-reply-${id}-%`,
      )
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error

    const latest = latestByMessageId((rows ?? []) as EmailLogRow[])
    const events: EmailEvent[] = latest
      .map((r) => {
        if (!r.message_id) return null
        const kind: EmailEvent['kind'] = r.message_id.startsWith('partnership-confirmation-')
          ? 'confirmation'
          : r.message_id.startsWith('partnership-notification-')
            ? 'notification'
            : 'reply'
        return {
          kind,
          messageId: r.message_id,
          status: r.status,
          errorMessage: r.error_message,
          createdAt: r.created_at,
          templateName: r.template_name,
          recipientEmail: r.recipient_email,
        }
      })
      .filter((e): e is EmailEvent => e !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return { events }
  })
