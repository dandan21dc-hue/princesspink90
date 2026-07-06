## What I'm building

Fixes for every gap the audit found, wired to your 4 answers:
- **Prices**: fetched live from Stripe
- **USD plans**: removed
- **Age gate**: hard server-side gate for signed-in users on /store & /account
- **Dunning**: day 3 + day 7 + final emails

### 1. Product catalog & currency

- **Live prices**: new `getSubscribePrices()` server fn that lists AUD lookup keys once and returns `{ id, unit_amount, currency, recurring }`. `/store/subscribe` reads that in a loader + `useSuspenseQuery` and renders `formatCurrency(amount, currency)` — no hard-coded `A$10/mo` strings.
- **USD removed**: delete `usdCheckoutFlow.test.ts`, purge USD lookup keys from `PriceId` union in `store.functions.ts`, and archive the USD Stripe prices (via one-off `stripe.prices.update({ active: false })` script — Stripe prices are immutable). No UI change (they weren't shown).
- **Tax-code drift fix**: stop calling `stripe.products.update` on every checkout. Move it into a one-off `scripts/sync-stripe-tax-codes.mjs` idempotent script + a startup check that logs but doesn't retry. Failures now surface instead of being swallowed.
- **Private-room tax code**: split `isEligibleForManagedPayments` so `services` SKUs use `automatic_tax` (not managed_payments) — services aren't in the eligible tax-code set for full compliance handling.

### 2. Authentication & age gate

- **Server-recorded age confirmation**: signed-in users' click on the age gate calls `confirmAgeGate` server fn which inserts an `age_verifications` row (`method: 'self_attested'`).
- **Hard gate**: new `_authenticated/route.tsx` `beforeLoad` check — `has_age_verification(userId)` returns false → `redirect({ to: '/age-gate', search: { next } })`. Applied to the whole `_authenticated` subtree (already covers `/account/*`) plus a top-level `beforeLoad` on `/store` and `/store/*`.
- Anonymous visitors continue to see the localStorage gate on marketing pages.

### 3. Payment gateway / webhook

- **New webhook handlers**:
  - `setup_intent.succeeded` → attach new PM to customer, set as default, no-op if already default (safety net when user closes tab before returning).
  - `customer.subscription.trial_will_end` → enqueue `trial-ending` email 3 days out.
  - `invoice.paid` / `invoice.payment_succeeded` → **also** update `current_period_end` from the invoice's `lines.data[0].period.end` (defensive; keeps DB fresh if `subscription.updated` is delayed).
- **Dunning escalation**: on `invoice.payment_failed`, insert a row in a new `dunning_schedule` table (`user_id`, `invoice_id`, `next_email_at`, `stage`). Daily cron `/api/public/cron/dunning-escalation` sends day-3 (`payment-failed-retry`), day-7 (`payment-failed-urgent`), day-14 (`payment-failed-final`) emails, cancels on `invoice.paid` or `subscription.deleted`.
- **`useSubscription` bug fix**: also read `memberships` (lifetime + valid term_pass) and merge into `isActive`. `AccountBanners` already keys off `isPastDue` — unchanged.
- **`user_can_access_content` DB fn**: add the grace-period canceled clause to match hook + `getMyLibrary`.
- **`listMyInvoices` gap**: fall back to looking up `stripe_customer_id` from any of `content_purchases` / `panty_orders` / `memberships` when there's no `subscriptions` row.
- **Fix false-passing test**: `webhook.test.ts:824–840` now asserts `past_due` was written; add tests for `invoice.paid`, `charge.refunded`, both dispute paths, `setup_intent.succeeded`, panty order path, dunning schedule enqueue.

### 4. Emails

Three new templates in `src/lib/email-templates/` and registered in `registry.ts`:
- `payment-failed-retry.tsx` (day 3)
- `payment-failed-urgent.tsx` (day 7)
- `payment-failed-final.tsx` (day 14 — access ending)
- `trial-ending.tsx` (3 days before trial end)

Each triggers via the queued `sendTransactionalEmail` helper from the cron / webhook.

### 5. Migrations

One migration:
- `age_verifications` — new `method` enum value `self_attested`; helper fn `has_age_verification(uuid)` (SECURITY DEFINER, EXECUTE to authenticated).
- `dunning_schedule` table + RLS + `service_role` grants.
- Update `user_can_access_content` to add canceled-grace clause.
- Schedule `pg_cron` daily job hitting `/api/public/cron/dunning-escalation` with `apikey` header.

### 6. Files touched (~18 files, 1 migration, 1 script)

```text
src/lib/store.functions.ts           – remove USD keys, split managed_payments, drop per-checkout tax-code write
src/lib/billing.functions.ts         – listMyInvoices fallback lookup
src/lib/subscribePrices.functions.ts – NEW getSubscribePrices
src/lib/account.functions.ts         – confirmAgeGate server fn
src/hooks/useSubscription.ts         – merge memberships into isActive
src/routes/store.subscribe.tsx       – loader + useSuspenseQuery, formatCurrency
src/routes/_authenticated/route.tsx  – age-gate beforeLoad
src/routes/store.tsx                 – age-gate beforeLoad
src/routes/age-gate.tsx              – NEW server-recorded gate page
src/components/AgeGate.tsx           – call confirmAgeGate for signed-in users
src/routes/api/public/payments/webhook.ts        – setup_intent, trial_will_end, invoice.paid period bump, dunning enqueue
src/routes/api/public/cron/dunning-escalation.ts – NEW
src/lib/email-templates/{4 new files + registry}
src/routes/api/public/payments/webhook.test.ts   – fix false-pass + new cases
scripts/sync-stripe-tax-codes.mjs    – NEW idempotent tax-code sync
scripts/archive-usd-prices.mjs       – NEW one-off
supabase migration                   – dunning_schedule + has_age_verification + user_can_access_content update + cron
src/lib/usdCheckoutFlow.test.ts      – DELETE
```

## How to test in preview

Use Stripe test cards on any checkout (embedded checkout is already wired):

- **4242 4242 4242 4242** — succeeds. Any future expiry, any CVC, any postcode. Use for AUD monthly, term passes, lifetime, private room, content items, panty.
- **4000 0000 0000 9995** — declines immediately. Confirms failure UI.
- **4000 0000 0000 0341** — first charge succeeds, subsequent renewals fail. Best card to test dunning: subscribe, then trigger `stripe trigger invoice.payment_failed` (or wait for renewal) and watch the day-3/7/14 emails land in `email_send_log`, plus the banner in `AccountBanners`.
- **4000 0025 0000 3155** — succeeds after 3DS challenge. Confirms 3DS embedded modal.

Flows to walk through in preview:
1. Sign in as a fresh user → hit `/store` → age-gate page appears → confirm → row in `age_verifications`, redirected to `/store`.
2. Subscribe with `4242…` → `subscriptions` row appears → cancel from `/account/billing` → `cancel_at_period_end=true` → resume → cleared.
3. Update payment method from `/account/billing` — even if you close the tab before it returns, `setup_intent.succeeded` webhook will still attach the new card.
4. Buy a single content item with `4242…` → `content_purchases` row + item unlocks in `/account/library`. Then buy nothing else and hit `/account/billing` → invoices list shows the receipt (fallback lookup works).
5. Trigger dunning: `stripe trigger invoice.payment_failed` against a test sub → row in `dunning_schedule`, banner shows, day-3 email queued (visible in `email_send_log`).
6. Refund the test charge from Stripe dashboard → `content_purchases` row disappears, library loses the item.

**One thing to know**: the Stripe embedded checkout can be finicky inside the Lovable preview iframe. If it stalls, open the preview URL in its own browser tab.

## Out of scope (won't touch)

- Stripe Customer Portal — you have full bespoke self-service; adding the portal is duplication.
- Physical shipping to non-AU countries.
- Existing subscribers migrating to managed payments (Stripe blocks that).
