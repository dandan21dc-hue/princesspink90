# Remove Stripe, wire NOWPayments, add tests

## Scope note (please read)

This touches ~80 files. To keep it reviewable and avoid a broken preview
between commits, I'll do it in **three phases** in a single build session,
verifying types + tests after each. If you'd rather I stop after phase 1
or 2, say so before I start.

## Phase 1 — Build NOWPayments behind the abstraction

Add a real `nowpaymentsProvider` implementing the existing
`PaymentProvider` interface (`src/lib/payments/types.ts`). The provider
handles both `one_time` and `subscription` intents.

Server side:
- `src/lib/nowpayments.server.ts` — thin HTTP client around
  `api.nowpayments.io` (invoice create, subscription plan create, status
  read). Reads `NOWPAYMENTS_API_KEY` from env inside handlers.
- `src/lib/nowpayments.functions.ts`:
  - `createNowpaymentsInvoice` — one-time. Resolves price by internal id
    (same string-key convention we use with Stripe `lookup_key`), creates
    an NOWPayments invoice, returns `{ invoice_url }`.
  - `createNowpaymentsSubscription` — recurring. Creates/uses a
    subscription plan and returns the hosted checkout URL.
  - Both `.middleware([requireSupabaseAuth])` for user context.
- `src/routes/api/public/payments/nowpayments-webhook.ts` — verify HMAC
  (`x-nowpayments-sig`), upsert into `payments` / `subscriptions` tables,
  return 200 fast. Idempotent by `payment_id` / `subscription_id`.

Client side:
- `src/lib/payments/providers/nowpayments.tsx` — hook that calls the
  server fn, then either redirects to the hosted invoice URL or opens it
  in a modal iframe (I'll default to redirect; simpler and matches how
  NOWPayments is designed).
- `src/lib/payments/config.ts` — flip both intents to
  `nowpaymentsProvider`.

Data model:
- New `payments` table (id, user_id, provider, provider_payment_id,
  price_key, amount_cents, currency, status, environment, timestamps)
  with GRANTs + RLS (user reads own, service_role writes).
- Extend `subscriptions` table: add `provider` column (default `stripe`
  for existing rows, `nowpayments` going forward). Keep the rest of the
  schema so historical Stripe rows still render.

## Phase 2 — Delete Stripe

Files removed:
- `src/lib/stripe.ts`, `src/lib/stripe.server.ts`, `src/lib/stripe-tax-codes.ts`
- `src/lib/subscribePrices.functions.ts`, `.shared.ts`, `.server.ts` (rewritten against NOWPayments)
- `src/lib/stripeMaintenance.functions.ts`, `stripe-webhook-events.functions.ts`, `planPriceValidation.server.ts`, `termPassPriceMapping.test.ts`
- `src/lib/billing.functions.ts` Stripe-specific branches (portal → account settings link)
- `src/components/StripeEmbeddedCheckout.tsx` + test, `PaymentTestModeBanner.tsx` (or repurpose)
- `src/routes/api/public/payments/webhook.ts` (Stripe webhook) + its test
- `src/routes/_authenticated/admin.webhook-events.tsx`, `admin.checkout-reconciliation.tsx` — kept but re-pointed at NOWPayments data
- `src/routes/checkout.return.tsx` — replaced with a NOWPayments return page keyed on `payment_id`
- Stripe imports scrubbed from: `store.subscribe.tsx`, `store.$id.tsx`, `account.billing.tsx`, `panty-drawer.tsx`, `private-room.tsx`, `glory-holes.tsx`, `admin.orders-status.tsx`, `admin.analytics.tsx`, `admin.settings.tsx`, `admin.panty-listings.tsx`, `library.tsx`, `bookings.tsx`, `content.new.tsx`, `content.index.tsx`, `events.$id.checkin.tsx`, `NotificationsBell.tsx`, `AllAccessCard.tsx`, `PerksWidget.tsx`, `SubscriberDiscountPanel.tsx`, `AccountBanners.tsx`, `TermsAgreementGate.tsx`, `SiteHeader.tsx`, `CartDrawer.tsx`, `email-templates/payment-failed-final.tsx`, plus `.env` refs.
- `useStripeCheckout.tsx` retained as a thin alias to `useCheckout('one_time')` for one release, then deleted.
- Package removals: `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`.

Secrets: I'll ask you to save `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` via the secure form (not stored in code).

## Phase 3 — Vitest E2E coverage

New tests under `src/**/*.test.ts(x)`, no browser:

1. `nowpayments.server.test.ts` — HMAC signature verify: valid sig → parsed body; bad sig → throw; stale timestamp → throw.
2. `nowpayments-webhook.test.ts` — POSTs signed fixture payloads through the route handler (imported directly), asserts Supabase upsert calls via a mocked service-role client. Covers: `finished` (one-time → payments row), `partially_paid` (no subscription grant), subscription `active` / `expired` transitions, unknown event (200, no writes), replay (idempotent).
3. `nowpayments.functions.test.ts` — `createNowpaymentsInvoice` and `createNowpaymentsSubscription` with `fetch` mocked: happy path returns url; upstream 4xx surfaces `{ error }`; unauthenticated caller rejected by middleware.
4. `payments-abstraction.test.tsx` — renders a component using `useCheckout('one_time')` and `useCheckout('subscription')`, asserts both resolve to `nowpaymentsProvider` and that `openCheckout({...})` triggers the server-fn call (mocked).
5. `subscription-upgrade.test.ts` — simulates: user on `all_access_monthly_aud` opens upgrade to `all_access_12mo_monthly_aud`, webhook fires `subscription.updated` for new plan, `subscriptions` row updates to new `price_id`, `has_active_subscription` returns true.
6. `checkout-return.test.tsx` — return page renders success/failure/pending based on `payment_id` status pulled from the DB (mocked).

All tests use `vi.mock` for `@supabase/supabase-js` and `fetch` — no live services, no Playwright. Target runtime under 5s total.

## Verification after each phase

- `bunx tsgo --noEmit`
- `bunx vitest run`
- `rg -i "stripe" src/` returns nothing after phase 2 (except this plan and CHANGELOG).

## What I need from you before phase 1

1. Confirm the phased approach is fine (vs. one massive commit).
2. Confirm you have a NOWPayments account and can save the API key + IPN secret when I request them.
3. Confirm removing the Stripe customer portal is OK — subscribers will manage cancellations via a NOWPayments-hosted page instead, or via an in-app "cancel" server fn.
