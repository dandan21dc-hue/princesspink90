
# Stabilization Plan

Five items, processed in order. Each ships behind small, reviewable changes.

---

## 1. Unresponsive buttons + loading states

**Investigate first** (no code yet):
- Reproduce Add to Cart and Subscribe in a headless browser, capture console + network, screenshot the failing element with `getBoundingClientRect` / `elementFromPoint` to confirm whether a transparent overlay is stealing clicks vs. handler silently failing.
- Read `src/routes/store.subscribe.tsx`, `src/lib/cart.ts`, `src/components/CartDrawer.tsx`, and any `useMutation` around checkout.

**Fix pattern (applied per button):**
- Wrap click handlers in `try / catch / finally`.
- On entry: `setPending(true)`, `console.log('[checkout] click', { plan, ref })`.
- On error: `toast.error(err.message)` + `console.error('[checkout] failed', err)`.
- On finish: `setPending(false)`.
- Button gets `disabled={pending}` and swaps label to `Loading…` / `Adding…` / `Opening checkout…`.
- If overlay found: fix stacking (`relative z-10` on interactive card, `pointer-events-none` on decorative overlay).

**Server-fn logging:**
- In `createCheckoutSession` and cart mutations, `console.log('[server:checkout]', { userId, plan, env })` on entry, log the returned Stripe error message on catch. Viewable via `server-function-logs`.

---

## 2. Missing `term_pass_12` and Lifetime perks

**Root cause hypothesis:** the webhook writes `subscriptions` but does not insert the perk-bearing `memberships` row for 12-mo (`term_pass_12` + free event entry) or Lifetime (free event entry + free private-room session).

**Fix in `src/routes/api/public/payments/webhook.ts`:**
- On `customer.subscription.created` / `.updated` for `price.lookup_key === 'all_access_12mo_monthly_aud'`, upsert a `memberships` row: `kind = 'term_pass_12'`, `term_months = 12`, `expires_at = current_period_end + 12 months` (or `+ term_months * interval`), `environment = env`. Perk fields: leave `event_ticket_used_at = null` so it can be redeemed once.
- On `checkout.session.completed` (or `.subscription.created`) for `lifetime_onetime_aud`, upsert `memberships` row `kind = 'lifetime'`, plus initialise `event_ticket_used_at = null` and `private_session_requested_at = null` so both perks are redeemable.
- Idempotency: upsert on `(user_id, kind, environment)` (add a unique index in a migration if missing).

**Backfill migration:** one-off SQL that scans existing `subscriptions` with the 12-mo `price_id` / lifetime checkout and inserts missing membership rows. Log to `stripe_webhook_events` with a synthetic `event_type = 'backfill.membership'` for auditability.

---

## 3. Automated checkout tests

**Approach:** Vitest suite `src/routes/store.subscribe.checkout.test.ts` covering the five plans by mocking `createCheckoutSession` and asserting:
- Correct `lookup_key` sent to Stripe.
- `client_order_ref` generated and attached.
- Tracking events fired: `boutique_tier_click`, `checkout_start`, `panty_checkout_confirmed` (where applicable).

**End-to-end webhook test:** a `scripts/test-checkout-flow.ts` runnable via `bun` that, for each plan, POSTs a signed synthetic Stripe event to `/api/public/payments/webhook?env=sandbox`, then asserts the expected rows exist in `subscriptions` and `memberships`. Uses `PAYMENTS_SANDBOX_WEBHOOK_SECRET`.

Runs on demand — not in the automatic build — to avoid hitting the DB during CI.

---

## 4. Admin tracking / reconciliation page

New route: `src/routes/_authenticated/admin.tracking.tsx` (admin-gated via `has_role`).

Requires a lightweight tracking sink. Two pieces:

**Migration:** new `public.tracking_events` table (`event_name`, `props jsonb`, `user_id`, `client_order_ref`, `environment`, `created_at`). RLS: users insert their own, admins select all. GRANTs per rules.

**Server fn:** `logTrackingEvent` (unauth-friendly, rate-limited by `client_order_ref`) — called from the existing `track()` helper in `src/lib/track.ts` in addition to whatever it does today.

**Admin page shows:**
- Aggregate counts of `boutique_tier_click` grouped by `plan` (last 24h / 7d / 30d).
- A funnel per `client_order_ref`: Start → Confirmed → Webhook-received → Membership-created, with the missing step highlighted red.
- Filter by plan, env, date range. Click a row to see raw event props + linked `stripe_webhook_events`.

---

## 5. Post-checkout confirmation screen

New route: `src/routes/store.subscribe.confirmed.tsx`.
- Reached from Stripe `success_url` with `?session_id=cs_…&plan=…`.
- Loader calls a new server fn `getCheckoutConfirmation({ sessionId })` that:
  - Retrieves the Stripe session, resolves the `lookup_key` and period dates.
  - Falls back to polling `subscriptions` / `memberships` for up to ~10s if the webhook hasn't landed yet (with a friendly "finalising your access…" state).
- Renders: tier label, "Access starts: {start}", "Next renewal / Ends: {end}" or "Never expires — Lifetime", perks summary (free event entry, private session for lifetime), and CTAs to `/library` and `/store`.

Update `createCheckoutSession` `success_url` to point at the new route.

---

## Order of delivery

1. Item 1 (buttons + logging) — smallest, unblocks testers immediately.
2. Item 5 (confirmation screen) — user-visible win, uses existing data.
3. Item 2 (webhook perks + backfill migration) — data-correctness.
4. Item 4 (tracking table + admin page) — needs a migration.
5. Item 3 (test flow) — locks in the fixes.

Each item is a separate commit-sized change so you can review / roll back independently.

## Confirm before I start

Reply "go" to proceed with item 1, or tell me which items to drop / reorder.
