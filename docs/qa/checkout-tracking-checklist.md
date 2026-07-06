# Checkout Tracking QA Checklist

Validates end-to-end tracking coverage for the panty checkout flow, from cart click through the Stripe return page, for every terminal outcome. Use one browser session per scenario and inspect `window`-dispatched `app:track` events (DevTools → Console, or your analytics debugger).

## Setup

1. Open the app in a fresh incognito window.
2. In DevTools Console, install a listener to capture events:
   ```js
   window.__events = [];
   window.addEventListener('app:track', (e) => window.__events.push(e.detail));
   ```
3. Seed the cart with at least one panty item + one content item.
4. Confirm age gate is passed (`localStorage['age-gate-ok'] === '1'`).

Reset `window.__events = []` between scenarios.

## Shared payload assertions

Every `panty_checkout_start` event MUST include:
- [ ] `source` (`"cart"` or `"boutique"`)
- [ ] `item_count`, `unit_count`, `subtotal_cents` matching the rendered cart totals
- [ ] `has_panty` boolean
- [ ] `items` (stringified JSON array) with `{kind, id, title, quantity, unit_amount_cents, currency}` for every line
- [ ] `client_order_ref` (UUID) — persisted in `sessionStorage` until the return page resolves
- [ ] `total_amount_cents`, `currency`

Every return-page event (`panty_checkout_confirmed` | `panty_checkout_pending` | `panty_checkout_cancelled`) MUST include:
- [ ] `session_id` (Stripe Checkout Session id)
- [ ] `payment_intent_id` (or `null` for subscription-only mode)
- [ ] `client_order_ref` — identical to the value emitted at `panty_checkout_start`
- [ ] `total_amount_cents`, `currency`
- [ ] `status` (Stripe session `status`) and `variant` (`payment_status`)

## Scenario 1 — Confirmed (successful payment)

1. Open cart drawer → click **Checkout**.
   - [ ] `panty_checkout_start` fires exactly **once** with `source: "cart"`.
2. Complete Stripe embedded checkout with test card `4242 4242 4242 4242`.
3. Land on `/checkout/return?session_id=...`.
   - [ ] `panty_checkout_confirmed` fires with `status: "complete"`, `variant: "paid"`.
   - [ ] `client_order_ref` equals the value from step 1.
4. Hard-refresh the return page.
   - [ ] No duplicate `panty_checkout_confirmed` — de-dupe key `checkout:confirmed:<session_id>` in `sessionStorage` blocks re-fire.
5. Navigate away and back via browser Back button.
   - [ ] Still no duplicate.

## Scenario 2 — Pending (async payment method / processing)

1. Repeat cart → Checkout.
   - [ ] `panty_checkout_start` fires once.
2. Use a test method that stays in processing (e.g. delayed bank debit sandbox).
3. On return page while Stripe reports `status: "complete"` + `payment_status: "processing"` (or session still `open`):
   - [ ] `panty_checkout_pending` fires with correct `variant`.
   - [ ] Not accompanied by `panty_checkout_confirmed` or `panty_checkout_cancelled`.
4. Poll / reload the return page.
   - [ ] `panty_checkout_pending` does NOT re-fire (deduped by `checkout:pending:<session_id>`).
5. When the payment eventually settles to paid and the page updates:
   - [ ] `panty_checkout_confirmed` fires exactly once; pending event is not re-emitted.

## Scenario 3 — Incomplete / Cancelled

Run each sub-case in an isolated session.

### 3a. Drawer closed before checkout
- Open cart drawer with items → close it (X / overlay / Esc) without clicking Checkout.
  - [ ] `panty_checkout_cancelled` fires with `reason: "drawer_closed"`, `stage: "pre_checkout"`.
  - [ ] No `panty_checkout_start`.
  - [ ] Reopening + closing again does NOT re-emit unless items changed.

### 3b. Back to store from checkout page
- Click Checkout → on `/checkout/cart` click **← Store**.
  - [ ] `panty_checkout_start` fired once.
  - [ ] `panty_checkout_cancelled` fires with `reason: "back_to_store"`, `stage: "pre_payment"`.

### 3c. Return page — expired / incomplete session
- Force an expired session (let Stripe session TTL elapse, or use a cancelled test session id).
  - [ ] `panty_checkout_cancelled` fires with `reason: "return_incomplete"`, includes `status` and `variant`.
  - [ ] Reloading the return page does NOT re-fire (deduped by `checkout:cancelled:<session_id>`).

### 3d. Return page — missing / broken session id
- Visit `/checkout/return` with no `session_id`.
  - [ ] `panty_checkout_cancelled` fires with `reason: "missing_session_id"`.
- Visit with an invalid `session_id`.
  - [ ] `panty_checkout_cancelled` fires with `reason: "session_fetch_error"`.

## De-duplication matrix

| Event                        | Dedupe key (sessionStorage)              | Scope             |
| ---------------------------- | ---------------------------------------- | ----------------- |
| `panty_checkout_start`       | `checkout:start:<client_order_ref>`      | Per click         |
| `panty_checkout_confirmed`   | `checkout:confirmed:<session_id>`        | Per Stripe session|
| `panty_checkout_pending`     | `checkout:pending:<session_id>`          | Per Stripe session|
| `panty_checkout_cancelled`   | `checkout:cancelled:<session_id\|ref>`   | Per session/click |

For each row:
- [ ] Trigger the event, reload the page, trigger again → verify only one event in `window.__events`.
- [ ] Clear `sessionStorage` → verify event fires again (proves the key, not a global flag, is gating).

## Reconciliation spot check

Pick one confirmed order:
- [ ] `client_order_ref` from `panty_checkout_start` matches `client_order_ref` on `panty_checkout_confirmed`.
- [ ] `total_amount_cents` on start equals the amount on confirmed (± any Stripe-applied tax delta, documented in analytics).
- [ ] `session_id` on confirmed resolves in Stripe Dashboard to the same amount + currency.

## Sign-off

- [ ] All three outcome scenarios pass
- [ ] No duplicate events under reload / back-navigation
- [ ] `client_order_ref` round-trips start → return for every outcome
- [ ] Screenshots of `window.__events` attached to the QA ticket
