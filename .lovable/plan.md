# Fix plan — purchase, account, and billing gaps

## What you'll be able to do when this ships

- **Cancel or resume your monthly All-Access subscription** from `/account/billing`, with a clear "access until X" banner.
- **Update your saved card** in-app (Stripe Elements card form, tokenized — we never see the number).
- **See past invoices/receipts** in a list, download PDFs.
- **See a "Payment failed — update your card" banner** the moment Stripe reports a failed renewal, plus an email from us.
- **Sell individual content items in AUD or USD** — creators pick a currency per item; buyers see the right one at checkout.
- **Stripe handles tax end-to-end** on every eligible checkout (calculates, collects, files, remits). You do nothing.
- **Request account deletion** from `/account`. 30-day grace window; you can reverse it by signing in during that window. After 30 days, everything is purged.

## What's changing under the hood

### 1. Full in-app subscription management (`/account/billing`)

New route `src/routes/_authenticated/account/billing.tsx` with three panels:

- **Plan** — current plan, next renewal date, `cancel_at_period_end` state, Cancel/Resume buttons.
- **Payment method** — last-4 + brand of default card, "Update card" opens a Stripe Elements dialog that creates a SetupIntent and attaches the new PaymentMethod as the customer's default.
- **Invoices** — last 12 invoices from Stripe, with hosted-invoice-url links.

New server functions in `src/lib/billing.functions.ts`:
- `cancelSubscription` — sets `cancel_at_period_end: true`
- `resumeSubscription` — sets `cancel_at_period_end: false`
- `createSetupIntent` — for card updates
- `setDefaultPaymentMethod` — attaches PM + sets as customer's `invoice_settings.default_payment_method`
- `listInvoices` — Stripe `invoices.list({ customer })`
- `getBillingSummary` — customer + subscription + default PM

All go through `createStripeClient(env)` and `requireSupabaseAuth`, verify the caller owns the `stripe_customer_id`, and return Stripe errors via `getStripeErrorMessage`.

### 2. Per-item currency for content

Migration adds `currency text not null default 'aud' check (currency in ('aud','usd'))` to `content_items`. Creator upload UI adds a currency dropdown. `createContentCheckoutSession` reads the item's currency instead of the hardcoded `"usd"`. Existing content items default to AUD (change flagged if any are actually priced for US buyers).

### 3. Full tax compliance (Stripe files it)

- Every product gets a tax code via `stripe.products.update` (one-time script in `scripts/set-tax-codes.ts`, ids listed in `src/lib/stripe-tax-codes.ts`):
  - All-Access monthly/term-pass/lifetime → `txcd_10103001` (SaaS/electronic services)
  - Individual content items → `txcd_10000000` (general digital goods)
  - Private room bookings → `txcd_20030000` (services)
  - Panty orders → `txcd_99999999` (physical goods) — **excluded from full compliance handling**, uses `automatic_tax: { enabled: true }` instead
- Checkout sessions: `managed_payments: { enabled: true }` for digital SKUs, `automatic_tax: { enabled: true }` for panty orders.
- Session metadata stamped with `managed_payments: "true"|"false"` and `customer_country` (detected via `cdn-cgi/trace`).
- Removes conflicts: no `payment_method_types`, no `shipping_address_collection` on managed-payment sessions (panty flow keeps them).

### 4. `invoice.payment_failed` + dunning

Webhook (`src/routes/api/public/payments/webhook.ts`) adds:
- `invoice.payment_failed` → update `subscriptions.status = 'past_due'`, enqueue "payment failed" email via existing `enqueue_email` path (new template `payment-failed.tsx`).
- `invoice.payment_succeeded` (renewal) → clear past-due state, no email.

`useSubscription` already treats `past_due` as active-with-access; `<DunningBanner />` renders app-wide when status is `past_due`, linking to `/account/billing`.

### 5. Soft account deletion (30-day window)

Migration adds `deleted_at timestamptz` to `profiles` + `pending_deletion_at timestamptz`.

New server functions:
- `requestAccountDeletion` — sets `pending_deletion_at = now() + 30 days`, cancels active subscription at period end, sends confirmation email.
- `cancelAccountDeletion` — nulls `pending_deletion_at`, must be called while signed in during the window.

New cron (`pg_cron` daily, calls `src/routes/api/public/cron/purge-deleted-accounts.ts` with a shared-secret header):
- For rows where `pending_deletion_at < now()`: revoke entitlements, delete `content_purchases` / `memberships` / `rsvps` / `panty_orders` / `private_room_bookings`, delete storage assets, `supabaseAdmin.auth.admin.deleteUser`, then delete profile row.

`__root.tsx` shows a "Your account is scheduled for deletion on X — undo" banner when `pending_deletion_at` is set.

### 6. Small correctness fixes rolled in

- `handle_new_user` trigger — verified missing; migration re-attaches it to `auth.users`.
- Private room `amount_cents` sourced from Stripe price at booking-insert time, not hardcoded.
- `getMyLibrary` filter simplified to `hasSubscription || purchasedIds.has(item.id)`.
- Admin routes get a `beforeLoad` role check so the shell doesn't render for non-admins.

## Tests I'll add

- `billingManagement.test.ts` — cancel, resume, list invoices, setup intent creation.
- `paymentFailedWebhook.test.ts` — `invoice.payment_failed` → `past_due` + email enqueued; `invoice.payment_succeeded` → cleared.
- `accountDeletion.test.ts` — request → row updated + subscription cancel_at_period_end; cancel-during-window → row cleared; purge cron → auth user + rows gone.
- `contentItemCurrency.test.ts` — AUD content item builds AUD checkout, USD builds USD.
- `managedPaymentsSession.test.ts` — digital SKU session has `managed_payments`, panty session has `automatic_tax` + shipping.

## How to test in the preview

**Stripe test cards** (use in the embedded checkout — Stripe is in sandbox mode, the pink test-mode banner should be visible):

| Card | Effect |
|---|---|
| `4242 4242 4242 4242` | Succeeds immediately |
| `4000 0000 0000 9995` | Charge declined (insufficient funds) |
| `4000 0000 0000 0341` | Charge succeeds, subsequent renewals fail — use this to test dunning |
| `4000 0025 0000 3155` | Requires 3DS authentication |

Any future expiry, any 3-digit CVC, any postcode.

**End-to-end runs to do in preview:**

1. **Happy-path subscribe** — sign up → `/store/subscribe` → pay with `4242…` → land on `/library` → confirm All-Access content unlocked → open `/account/billing`, see plan + card + 1 invoice.
2. **Cancel → resume** — `/account/billing` → Cancel → banner shows "access until X" → Resume → banner clears.
3. **Update card** — `/account/billing` → Update card → enter `5555 5555 5555 4444` → last-4 updates in the panel.
4. **Dunning** — subscribe with `4000 0000 0000 0341` → in Stripe Dashboard (sandbox), advance the test clock ~1 month, or trigger `invoice.payment_failed` via `stripe trigger invoice.payment_failed` → within seconds the app shows the red dunning banner and an email lands.
5. **Content item, AUD vs USD** — as a creator, upload two items, one AUD one USD → view each as buyer → confirm currency and total match expectation → complete both purchases → both appear in `/library`.
6. **Tax** — check out from an AU IP (or spoof `customer_country=AU`) → confirm GST line appears on the checkout receipt.
7. **Account deletion** — `/account` → Delete → confirm email → sign out → sign back in within 30 days → banner + "Undo" button → click Undo → account restored. To test the purge, temporarily set `pending_deletion_at = now() - '1 day'::interval` on your own profile via SQL, run the cron endpoint manually, confirm your auth user + rows are gone.

---

Ready to build this — approve and I'll ship it in one pass. It'll span ~15 file edits, 2 migrations, and 1 tax-code setup script.