// Server-only Resend sender.
// Uses RESEND_API_KEY directly against api.resend.com (no gateway/connector).

const RESEND_URL = 'https://api.resend.com/emails'

export const RESEND_FROM = 'Midnight Glory Support <support@princesspink90.com>'
export const RESEND_REPLY_TO = 'support@princesspink90.com'

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
  idempotencyKey?: string
}

export interface ResendResult {
  ok: boolean
  id?: string
  status: number
  error?: string
}

export async function sendResendEmail(args: SendEmailArgs): Promise<ResendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, status: 0, error: 'RESEND_API_KEY not configured' }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: args.from ?? RESEND_FROM,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo ?? RESEND_REPLY_TO,
      tags: args.tags,
    }),
  })

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: body.message ?? body.name ?? `HTTP ${res.status}`,
    }
  }
  return { ok: true, id: body.id, status: res.status }
}
