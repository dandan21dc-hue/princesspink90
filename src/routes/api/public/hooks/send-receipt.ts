import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { enqueueTemplateEmail } from '@/lib/email/enqueue.server'

// Called by AFTER INSERT triggers on panty_orders, private_room_bookings,
// memberships and content_purchases (see migration send_receipt_on_purchase).
// Sends one receipt email per row and stamps a marker so retries are idempotent.
//
// Auth: `Authorization: Bearer <receipt_webhook_secret>` from Postgres vault.

const SITE_URL = 'https://princesspink90.com'

type Source =
  | 'panty_orders'
  | 'private_room_bookings'
  | 'memberships'
  | 'content_purchases'

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    db: { schema: 'public' },
  })
}

function formatAud(cents: number | null | undefined): string {
  if (cents == null) return 'A$0.00'
  return `A$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Australia/Sydney',
    })
  } catch {
    return iso
  }
}

interface Receipt {
  userId: string
  receiptTitle: string
  itemDescription: string
  amountCents: number | null
  referenceId: string
  purchasedIso: string
  dashboardPath: string
  lineItems?: { label: string; value: string }[]
}

async function loadReceipt(
  supabase: NonNullable<ReturnType<typeof getServiceClient>>,
  source: Source,
  rowId: string,
): Promise<Receipt | null> {
  if (source === 'panty_orders') {
    const { data } = await supabase
      .from('panty_orders')
      .select('id, user_id, amount_cents, variant, hours, created_at')
      .eq('id', rowId)
      .maybeSingle()
    if (!data) return null
    const row = data as {
      id: string
      user_id: string
      amount_cents: number | null
      variant: string | null
      hours: number | null
      created_at: string
    }
    return {
      userId: row.user_id,
      receiptTitle: 'Panty drawer order',
      itemDescription: row.hours ? `${row.hours}-hour wear` : (row.variant ?? 'Panty order'),
      amountCents: row.amount_cents,
      referenceId: row.id,
      purchasedIso: row.created_at,
      dashboardPath: '/panty-drawer',
    }
  }

  if (source === 'private_room_bookings') {
    const { data } = await supabase
      .from('private_room_bookings')
      .select('id, user_id, amount_cents, starts_at, duration_minutes, party_size, created_at')
      .eq('id', rowId)
      .maybeSingle()
    if (!data) return null
    const row = data as {
      id: string
      user_id: string
      amount_cents: number | null
      starts_at: string
      duration_minutes: number
      party_size: number
      created_at: string
    }
    return {
      userId: row.user_id,
      receiptTitle: 'Private room booking',
      itemDescription: `${row.duration_minutes}-min session · ${row.party_size} ${row.party_size === 1 ? 'guest' : 'guests'}`,
      amountCents: row.amount_cents,
      referenceId: row.id,
      purchasedIso: row.created_at,
      dashboardPath: '/bookings',
      lineItems: [{ label: 'Session starts', value: formatDate(row.starts_at) }],
    }
  }

  if (source === 'memberships') {
    const { data } = await supabase
      .from('memberships')
      .select('id, user_id, amount_cents, kind, expires_at, created_at')
      .eq('id', rowId)
      .maybeSingle()
    if (!data) return null
    const row = data as {
      id: string
      user_id: string
      amount_cents: number | null
      kind: string
      expires_at: string | null
      created_at: string
    }
    const label =
      row.kind === 'lifetime'
        ? 'Lifetime All-Access Pass'
        : row.kind === 'term_pass_all_access_30d'
          ? '30-day All-Access Pass'
          : row.kind
    return {
      userId: row.user_id,
      receiptTitle: 'Membership purchase',
      itemDescription: label,
      amountCents: row.amount_cents,
      referenceId: row.id,
      purchasedIso: row.created_at,
      dashboardPath: '/all-access-pass',
      lineItems: row.expires_at
        ? [{ label: 'Access until', value: formatDate(row.expires_at) }]
        : [{ label: 'Access', value: 'Lifetime' }],
    }
  }

  if (source === 'content_purchases') {
    const { data } = await supabase
      .from('content_purchases')
      .select('id, user_id, content_item_id, amount_cents, created_at')
      .eq('id', rowId)
      .maybeSingle()
    if (!data) return null
    const row = data as {
      id: string
      user_id: string
      content_item_id: string
      amount_cents: number | null
      created_at: string
    }
    let itemTitle = 'Content unlock'
    const { data: item } = await supabase
      .from('content_items')
      .select('title')
      .eq('id', row.content_item_id)
      .maybeSingle()
    if (item && typeof (item as { title?: string }).title === 'string') {
      itemTitle = (item as { title: string }).title
    }
    return {
      userId: row.user_id,
      receiptTitle: 'Content purchase',
      itemDescription: itemTitle,
      amountCents: row.amount_cents,
      referenceId: row.id,
      purchasedIso: row.created_at,
      dashboardPath: '/store',
    }
  }

  return null
}

export const Route = createFileRoute('/api/public/hooks/send-receipt')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabase = getServiceClient()
        if (!supabase) return json({ error: 'server_misconfigured' }, 500)

        const { data: secretRow, error: secretErr } = await supabase
          .schema('vault' as never)
          .from('decrypted_secrets' as never)
          .select('decrypted_secret')
          .eq('name', 'receipt_webhook_secret')
          .maybeSingle()

        if (secretErr || !secretRow) {
          console.error('send-receipt: vault secret unavailable', secretErr)
          return json({ error: 'server_misconfigured' }, 500)
        }

        const expected = (secretRow as { decrypted_secret?: string }).decrypted_secret ?? ''
        const authHeader = request.headers.get('authorization') ?? ''
        const provided = authHeader.replace(/^Bearer\s+/i, '')
        if (!provided || !expected || !timingSafeEqual(provided, expected)) {
          return json({ error: 'unauthorized' }, 401)
        }

        let source: Source | null = null
        let rowId: string | null = null
        try {
          const body = (await request.json()) as { source?: unknown; row_id?: unknown }
          if (
            body.source === 'panty_orders' ||
            body.source === 'private_room_bookings' ||
            body.source === 'memberships' ||
            body.source === 'content_purchases'
          ) {
            source = body.source
          }
          if (typeof body.row_id === 'string') rowId = body.row_id
        } catch {
          return json({ error: 'invalid_body' }, 400)
        }

        if (!source || !rowId) return json({ error: 'missing_fields' }, 400)

        const receipt = await loadReceipt(supabase, source, rowId)
        if (!receipt) return json({ error: 'not_found' }, 404)

        // Fetch the user's registered email from auth.users.
        const { data: userRow, error: userErr } = await supabase.auth.admin.getUserById(
          receipt.userId,
        )
        if (userErr || !userRow?.user?.email) {
          console.error('send-receipt: user lookup failed', { userErr, source, rowId })
          return json({ error: 'user_email_unavailable' }, 404)
        }

        const idempotencyKey = `receipt-${source}-${rowId}`

        const result = await enqueueTemplateEmail({
          templateName: 'order-receipt',
          recipientEmail: userRow.user.email,
          idempotencyKey,
          templateData: {
            name:
              (userRow.user.user_metadata as { display_name?: string } | null)?.display_name ??
              undefined,
            receiptTitle: receipt.receiptTitle,
            itemDescription: receipt.itemDescription,
            amount: formatAud(receipt.amountCents),
            purchasedAt: formatDate(receipt.purchasedIso),
            referenceId: receipt.referenceId,
            lineItems: receipt.lineItems,
            dashboardUrl: `${SITE_URL}${receipt.dashboardPath}`,
          },
        })

        if (!result.success && result.reason !== 'email_suppressed') {
          console.error('send-receipt: enqueue failed', { source, rowId, reason: result.reason })
          return json({ error: 'enqueue_failed', reason: result.reason }, 502)
        }

        return json({ ok: true, message_id: result.messageId, source }, 200)
      },
    },
  },
})
