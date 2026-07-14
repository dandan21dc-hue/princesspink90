Good news: the payments abstraction already routes both `one_time` and `subscription` intents to NOWPayments (`src/lib/payments/config.ts`). The Stripe pieces are dead or transitional — this plan removes them cleanly.

## 1. Frontend / hooks / components (delete)

- `src/hooks/useStripeCheckout.tsx`
- `src/components/StripeEmbeddedCheckout.tsx` + `.test.tsx`
- `src/lib/payments/providers/stripe.tsx`
- `src/lib/stripeCheckoutFlow.test.ts`
- `src/lib/stripe.ts` (client-side env helper)
- `src/lib/stripe-tax-codes.ts`

Search-and-replace remaining `useStripeCheckout` imports → `useCheckout("one_time" | "subscription")` from `@/lib/payments`. Affected: `checkout.cart.tsx`, `glory-holes.tsx`, `private-room.tsx`, `panty-drawer.tsx`, `store.$id.tsx`, `store.subscribe.tsx`, `AllAccessCard.tsx`, `CartDrawer.tsx`, `SubscriberDiscountPanel.tsx`, `TermsAgreementGate.tsx`, `PaymentPendingPlaceholder.tsx`.

## 2. Subscriptions surface

- Rewrite `useSubscription` (currently reads `subscriptions` table) to read from `memberships` where `kind = 'term_pass_all_access_30d'` and `expires_at > now()`. Same `{ isActive, currentPeriodEnd, ... }` shape so callers don't change.
- `store.subscribe.tsx`: keep as the All-Access Pass buy page; strip `price_id` / Stripe wording; expiry copy stays ("manual re-buy after 30 days"), Buy button routes through NOWPayments.
- `SubscriberDiscountPanel.tsx` + `useMyTiers.ts`: key discount tiers off active All-Access membership instead of Stripe `price_id`.
- `account.billing.tsx`: replace Stripe Billing Portal button with a "Buy new pass" CTA (portal doesn't exist for NOWPayments).

## 3. Server functions & webhooks (delete)

- `src/lib/stripe.server.ts`
- `src/lib/stripe-webhook-events.functions.ts`
- `src/lib/stripeMaintenance.functions.ts`
- `src/lib/planPriceValidation.server.ts` (Stripe price parity check)
- `src/routes/api/public/payments/webhook.ts` + `.test.ts` (Stripe webhook)
- `src/routes/api/public/cron/dunning-escalation.ts` (Stripe dunning)
- `src/routes/_authenticated/admin.checkout-reconciliation.tsx`
- `src/routes/_authenticated/admin.webhook-events.tsx` (Stripe-only viewer)

Prune Stripe branches from: `billing.functions.ts`, `admin.functions.ts`, `admin-orders.functions.ts`, `analytics.functions.ts`, `store.functions.ts`, `account.functions.ts`, `subscribePrices.functions.ts`, `booking-email.functions.ts`, `cart.ts`, `returnUrl.ts` + tests, `pantyCheckoutEvents.ts`, `track.ts`, `audCurrencyGuard.test.ts`, email templates (`payment-failed-final.tsx`), admin settings/orders-status routes, `checkout.return.tsx` (drop Stripe `session_id` handling, keep NOWPayments `payment_id`).

## 4. Package + config

- `bun remove stripe @stripe/stripe-js @stripe/react-stripe-js`
- Drop `verify-multi-currency-checkout.mjs` script and Stripe e2e specs (`e2e/checkout-*`).
- Docs: mark `docs/analytics/panty-checkout-events.md` + `docs/qa/checkout-tracking-checklist.md` as NOWPayments-only, strip Stripe sections.
- Remove `STRIPE_*_API_KEY` and `PAYMENTS_*_WEBHOOK_SECRET` references from code (secrets themselves stay in the dashboard — connector-managed).

## 5. Database migration (irreversible)

One migration drops all Stripe schema. In order:

```sql
-- Update user_can_access_content to drop subscriptions branch, keep memberships + purchases
CREATE OR REPLACE FUNCTION public.user_can_access_content(...) ... ;

-- Update purge_account_rows to stop referencing subscriptions
CREATE OR REPLACE FUNCTION public.purge_account_rows(...) ... ;

-- Rewrite run_payment_integrity_checks to drop the two Stripe checks
CREATE OR REPLACE FUNCTION public.run_payment_integrity_checks(...) ... ;

DROP TABLE IF EXISTS public.stripe_webhook_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.dunning_schedule CASCADE;

ALTER TABLE public.panty_orders
  DROP COLUMN IF EXISTS stripe_session_id,
  DROP COLUMN IF EXISTS stripe_payment_intent_id,
  DROP COLUMN IF EXISTS stripe_customer_id;
-- (same shape applied to any other table with stripe_* columns discovered during exec)

DROP FUNCTION IF EXISTS public.has_active_subscription(uuid, text);
```

## 6. Verification

- Typecheck via `tsgo` (auto).
- Run remaining vitest specs (`bun x vitest run`) to confirm no Stripe imports leak.
- Playwright smoke: home → All-Access → NOWPayments redirect stub; cart → checkout → NOWPayments redirect stub.

## Risk

Irreversible DB drop wipes historical Stripe orders and subscription rows. Admin pages tied to those tables (`admin.checkout-reconciliation`, `admin.webhook-events`) are removed with them — links to them will be pulled from the admin nav.

I'll execute in this order once you approve: migration first, then code (deletes → rewrites → package removal), then verify.