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
