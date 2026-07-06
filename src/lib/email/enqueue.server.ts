import * as React from 'react'
import { render } from '@react-email/render'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { TEMPLATES } from '@/lib/email-templates/registry'

// Keep in sync with src/routes/lovable/email/transactional/send.ts
const SITE_NAME = 'princesspink90'
const SENDER_DOMAIN = 'notify.princesspink90.com'
const FROM_DOMAIN = 'princesspink90.com'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local[0]}***@${domain}`
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  })
}

export interface EnqueueTemplateEmailArgs {
  templateName: string
  /** Ignored when the template has a fixed `to`. */
  recipientEmail?: string
  templateData?: Record<string, any>
  idempotencyKey?: string
}

export interface EnqueueTemplateEmailResult {
  success: boolean
  reason?:
    | 'server_misconfigured'
    | 'template_not_found'
    | 'recipient_required'
    | 'email_suppressed'
    | 'enqueue_failed'
    | 'unsubscribe_token_failed'
  messageId?: string
}

/**
 * Server-side helper that renders a registered template and enqueues it onto
 * the transactional email queue. Bypasses caller-auth checks — the caller is
 * responsible for authorizing the send (e.g. validated public form, admin fn).
 */
export async function enqueueTemplateEmail(
  args: EnqueueTemplateEmailArgs,
): Promise<EnqueueTemplateEmailResult> {
  const supabase = getServiceClient()
  if (!supabase) {
    console.error('enqueueTemplateEmail: server env not configured')
    return { success: false, reason: 'server_misconfigured' }
  }

  const template = TEMPLATES[args.templateName]
  if (!template) {
    console.error('enqueueTemplateEmail: template not found', { templateName: args.templateName })
    return { success: false, reason: 'template_not_found' }
  }

  const recipient = (template.to ?? args.recipientEmail ?? '').trim()
  if (!recipient) return { success: false, reason: 'recipient_required' }

  const normalized = recipient.toLowerCase()
  const messageId = crypto.randomUUID()
  const idempotencyKey = args.idempotencyKey ?? messageId
  const templateData = args.templateData ?? {}

  // Suppression check
  const { data: suppressed } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()

  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: args.templateName,
      recipient_email: recipient,
      status: 'suppressed',
    })
    return { success: false, reason: 'email_suppressed', messageId }
  }

  // Get or create unsubscribe token
  let unsubscribeToken: string
  const { data: existing } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalized)
    .maybeSingle()

  if (existing && !existing.used_at) {
    unsubscribeToken = existing.token
  } else if (!existing) {
    unsubscribeToken = generateToken()
    await supabase
      .from('email_unsubscribe_tokens')
      .upsert({ token: unsubscribeToken, email: normalized }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: stored } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalized)
      .maybeSingle()
    if (!stored) return { success: false, reason: 'unsubscribe_token_failed', messageId }
    unsubscribeToken = stored.token
  } else {
    // token used but not in suppression — safety fallback
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: args.templateName,
      recipient_email: recipient,
      status: 'suppressed',
    })
    return { success: false, reason: 'email_suppressed', messageId }
  }

  // Render + enqueue
  const element = React.createElement(template.component, templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject = typeof template.subject === 'function'
    ? template.subject(templateData)
    : template.subject

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: args.templateName,
    recipient_email: recipient,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: args.templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('enqueueTemplateEmail: enqueue failed', {
      error: enqueueError,
      templateName: args.templateName,
      recipient: redactEmail(recipient),
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: args.templateName,
      recipient_email: recipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return { success: false, reason: 'enqueue_failed', messageId }
  }

  return { success: true, messageId }
}
