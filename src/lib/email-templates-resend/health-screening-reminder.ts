// Plain-string email template for the 7-day health screening expiry reminder.
// Kept as inline HTML (no React Email) so it works in the Cloudflare Worker
// runtime used by public cron routes without extra bundling.

export type HealthStatus = 'approved' | 'pending' | 'rejected' | 'expired' | string

export interface HealthReminderTemplateArgs {
  recipientName?: string | null
  validUntil: string // ISO date (YYYY-MM-DD)
  daysUntilExpiry: number
  portalUrl: string
  // Latest screening snapshot from the portal
  status?: HealthStatus | null
  testDate?: string | null // ISO date
}

export function renderHealthScreeningReminder(args: HealthReminderTemplateArgs): {
  subject: string
  html: string
  text: string
} {
  const { recipientName, validUntil, daysUntilExpiry, portalUrl, status, testDate } = args
  const firstName = pickFirstName(recipientName)
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,'
  const dayLabel = daysUntilExpiry === 1 ? 'day' : 'days'
  const prettyValidUntil = formatDate(validUntil)
  const prettyTestDate = testDate ? formatDate(testDate) : null
  const badge = statusBadge(status)

  const subject = firstName
    ? `${firstName}, your health screening expires in ${daysUntilExpiry} ${dayLabel}`
    : `Your health screening expires in ${daysUntilExpiry} ${dayLabel}`

  const text = [
    greeting,
    '',
    `A friendly heads-up: your screening on file is valid until ${prettyValidUntil} — ${daysUntilExpiry} ${dayLabel} from today.`,
    '',
    `Current status: ${badge.plain}`,
    prettyTestDate ? `Test date on file: ${prettyTestDate}` : null,
    `Expires: ${prettyValidUntil}`,
    '',
    'To keep your access active for upcoming events, please upload a renewed certificate before it expires.',
    '',
    `Update your screening: ${portalUrl}`,
    '',
    `View in browser: ${portalUrl}`,
    '',
    'With love,',
    'Midnight Glory',
    '',
    '— This is an automated reminder from Midnight Glory. Reply to this email if you need help.',
  ]
    .filter(Boolean)
    .join('\n')

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #f2d6e4;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#ff6fae 0%,#c94b8b 100%);padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.9;">Midnight Glory</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">Health screening reminder</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;font-size:16px;line-height:1.55;">
                <p style="margin:0 0 14px 0;">${greeting}</p>
                <p style="margin:0 0 14px 0;">
                  A friendly heads-up: your screening on file is valid until
                  <strong>${escapeHtml(prettyValidUntil)}</strong> — that's
                  <strong>${daysUntilExpiry} ${dayLabel}</strong> from today.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="background:#fdf3f8;border:1px solid #f2d6e4;border-radius:12px;">
                  <tr>
                    <td style="padding:16px 20px;font-size:14px;color:#4a2b3a;line-height:1.6;">
                      <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#8a5b74;margin-bottom:8px;">
                        Your screening on file
                      </div>
                      <div style="margin-bottom:6px;">
                        <span style="color:#8a5b74;">Status:</span>
                        <span style="display:inline-block;margin-left:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${badge.bg};color:${badge.fg};">
                          ${escapeHtml(badge.label)}
                        </span>
                      </div>
                      ${
                        prettyTestDate
                          ? `<div style="margin-bottom:4px;"><span style="color:#8a5b74;">Test date:</span> <strong>${escapeHtml(prettyTestDate)}</strong></div>`
                          : ''
                      }
                      <div><span style="color:#8a5b74;">Expires:</span> <strong>${escapeHtml(prettyValidUntil)}</strong></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;font-size:16px;line-height:1.55;">
                <p style="margin:0 0 20px 0;">
                  To keep your access active for upcoming events, please upload a renewed certificate before it expires.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 20px 32px;">
                <a href="${escapeAttr(portalUrl)}"
                   style="display:inline-block;background:#c94b8b;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">
                  Update your screening
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px 32px;font-size:12px;color:#8a5b74;line-height:1.5;word-break:break-all;">
                Button not working? <a href="${escapeAttr(portalUrl)}" style="color:#c94b8b;text-decoration:underline;">View in browser</a><br />
                <span style="color:#a07a8e;">${escapeHtml(portalUrl)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;font-size:14px;color:#555;line-height:1.5;">
                <p style="margin:0 0 6px 0;">With love,</p>
                <p style="margin:0;">Midnight Glory</p>
              </td>
            </tr>
            <tr>
              <td style="background:#fdf3f8;padding:16px 32px;font-size:12px;color:#8a5b74;line-height:1.5;">
                This is an automated reminder from Midnight Glory. Reply to this email if you need help.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, html, text }
}

function pickFirstName(name?: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0]
}

function statusBadge(status?: HealthStatus | null): {
  label: string
  plain: string
  bg: string
  fg: string
} {
  switch ((status ?? '').toLowerCase()) {
    case 'approved':
      return { label: 'Approved', plain: 'Approved', bg: '#e6f7ed', fg: '#0f7a3d' }
    case 'pending':
      return { label: 'Pending review', plain: 'Pending review', bg: '#fff4e0', fg: '#7a4b00' }
    case 'rejected':
      return { label: 'Rejected', plain: 'Rejected', bg: '#fde8e8', fg: '#9b1c1c' }
    case 'expired':
      return { label: 'Expired', plain: 'Expired', bg: '#eee', fg: '#555' }
    default:
      return { label: 'On file', plain: 'On file', bg: '#f2e6ed', fg: '#5a2b45' }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s)
}
function formatDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`)
    return d.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}
