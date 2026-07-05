// Plain-string email template for the 7-day health screening expiry reminder.
// Kept as inline HTML (no React Email) so it works in the Cloudflare Worker
// runtime used by public cron routes without extra bundling.

export interface HealthReminderTemplateArgs {
  recipientName?: string | null
  validUntil: string // ISO date (YYYY-MM-DD)
  daysUntilExpiry: number
  portalUrl: string
}

export function renderHealthScreeningReminder(args: HealthReminderTemplateArgs): {
  subject: string
  html: string
  text: string
} {
  const { recipientName, validUntil, daysUntilExpiry, portalUrl } = args
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,'
  const dayLabel = daysUntilExpiry === 1 ? 'day' : 'days'
  const prettyDate = formatDate(validUntil)

  const subject = `Your health screening expires in ${daysUntilExpiry} ${dayLabel}`

  const text = [
    greeting,
    '',
    `A friendly heads-up: your approved health screening is valid until ${prettyDate} — ${daysUntilExpiry} ${dayLabel} from today.`,
    '',
    'To keep your access active for upcoming events, please upload a renewed certificate before it expires.',
    '',
    `Update your screening: ${portalUrl}`,
    '',
    'With love,',
    'Princess Pink',
    '',
    '— This is an automated reminder from Princess Pink. Reply to this email if you need help.',
  ].join('\n')

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
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.9;">Princess Pink</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">Health screening reminder</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;font-size:16px;line-height:1.55;">
                <p style="margin:0 0 14px 0;">${greeting}</p>
                <p style="margin:0 0 14px 0;">
                  A friendly heads-up: your approved health screening is valid until
                  <strong>${escapeHtml(prettyDate)}</strong> — that's
                  <strong>${daysUntilExpiry} ${dayLabel}</strong> from today.
                </p>
                <p style="margin:0 0 20px 0;">
                  To keep your access active for upcoming events, please upload a renewed certificate before it expires.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 28px 32px;">
                <a href="${escapeAttr(portalUrl)}"
                   style="display:inline-block;background:#c94b8b;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">
                  Update your screening
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;font-size:14px;color:#555;line-height:1.5;">
                <p style="margin:0 0 6px 0;">With love,</p>
                <p style="margin:0;">Princess Pink</p>
              </td>
            </tr>
            <tr>
              <td style="background:#fdf3f8;padding:16px 32px;font-size:12px;color:#8a5b74;line-height:1.5;">
                This is an automated reminder from Princess Pink. Reply to this email if you need help.
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
