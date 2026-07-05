import { createFileRoute } from '@tanstack/react-router'
import { createStripeClient, getStripeErrorMessage } from '@/lib/stripe.server'

// TEMPORARY diagnostic endpoint. Creates a Stripe checkout session for each
// AUD subscription plan and returns key fields so we can verify price IDs,
// mode, return_url, and metadata are wired correctly. Auth-guarded via
// SUPABASE_PUBLISHABLE_KEY. Safe to delete after verification.
export const Route = createFileRoute('/api/public/dev/verify-aud-checkouts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get('apikey') ??
          request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const plans = [
          'all_access_monthly_aud',
          'all_access_3mo_onetime_aud',
          'all_access_6mo_onetime_aud',
          'all_access_12mo_onetime_aud',
          'lifetime_onetime_aud',
        ] as const

        const returnUrl =
          'https://example.test/checkout/return?session_id={CHECKOUT_SESSION_ID}'
        const fakeUserId = 'dev-verify-user'

        try {
          const stripe = createStripeClient('sandbox')
          const results: Array<Record<string, unknown>> = []

          for (const priceId of plans) {
            const prices = await stripe.prices.list({ lookup_keys: [priceId] })
            const stripePrice = prices.data[0]
            if (!stripePrice) {
              results.push({ priceId, ok: false, error: 'lookup_key not found' })
              continue
            }
            const isRecurring = stripePrice.type === 'recurring'
            const isLifetime = priceId === 'lifetime_onetime_aud'
            const termPassMatch = /^all_access_(3|6|12)mo_onetime_aud$/.exec(priceId)
            const termMonths = termPassMatch ? Number(termPassMatch[1]) : null

            const session = await stripe.checkout.sessions.create({
              line_items: [{ price: stripePrice.id, quantity: 1 }],
              mode: isRecurring ? 'subscription' : 'payment',
              ui_mode: 'embedded_page',
              return_url: returnUrl,
              metadata: {
                userId: fakeUserId,
                ...(isLifetime && { membership: 'lifetime' }),
                ...(termMonths && {
                  membership: 'term_pass',
                  term_months: String(termMonths),
                }),
              },
              ...(isRecurring && {
                subscription_data: { metadata: { userId: fakeUserId } },
              }),
            })

            results.push({
              priceId,
              ok: true,
              lookup_key: stripePrice.lookup_key,
              stripe_price_id: stripePrice.id,
              currency: stripePrice.currency,
              unit_amount: stripePrice.unit_amount,
              recurring: stripePrice.recurring,
              session_id: session.id,
              mode: session.mode,
              return_url: session.return_url,
              ui_mode: session.ui_mode,
              metadata: session.metadata,
              subscription_data_metadata: isRecurring
                ? { userId: fakeUserId }
                : null,
              has_client_secret: Boolean(session.client_secret),
            })
          }

          return new Response(JSON.stringify({ ok: true, results }, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({ ok: false, error: getStripeErrorMessage(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
