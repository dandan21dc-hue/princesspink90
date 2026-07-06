# `panty_checkout_*` event schema

Client-side events emitted via `track()` (`src/lib/track.ts`) for the panty /
cart checkout funnel. `track()` also mirrors these into
`window.dataLayer` and dispatches a `CustomEvent("app:track")`. Any event
name listed in `PERSISTED_EVENTS` is additionally written to the
`analytics_events` table; the events documented here are **not** in that
whitelist today (only `boutique_tier_click`, `all_access_tier_click`, and
`checkout_completed` are persisted).

All property values are `string | number | boolean | null | undefined`.
`null` and `undefined` are stripped inside `track()` before the payload is
emitted, so downstream consumers only see defined scalars. Every emitted
payload also receives an automatic `ts: number` (`Date.now()`) and the
`event: string` name.

## Common fields

These may appear on any `panty_checkout_*` event depending on stage. A field
is only present when it is meaningful for that emit site (see the per-event
tables).

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | `"cart_drawer" \| "cart" \| "checkout_page" \| "checkout_return"` | UI surface that fired the event. |
| `stage` | `"pre_checkout" \| "pre_payment" \| "post_return"` | Funnel stage at emit time. |
| `variant` | `string` | Panty SKU / price id, or `"cart"` for multi-item cart orders. |
| `session_id` | `string` (`cs_…`) | Stripe Checkout Session id. |
| `payment_intent_id` | `string \| undefined` (`pi_…`) | Stripe PaymentIntent id — present once Stripe has attached one to the session. |
| `client_order_ref` | `string \| undefined` | Client-generated correlation id (UUID or `co_…`) round-tripped through Stripe metadata for reconciliation. |
| `order_id` | `string \| undefined` (uuid) | First matching `panty_orders.id` for this session — present once the webhook has created the order row. |
| `order_ids` | `string \| undefined` | Comma-joined `panty_orders.id` list (cart orders can produce multiple). |
| `order_count` | `number` | Count of matched `panty_orders` rows (0 before the webhook has run). |
| `total_amount_cents` / `subtotal_cents` | `number` | Order total (cart events also expose `subtotal_cents`). |
| `currency` | `string` (ISO 4217, lowercase) | e.g. `"aud"`. |
| `item_count` | `number` | Distinct line items in the cart. |
| `unit_count` | `number` | Sum of `quantity` across line items. |
| `has_panty` | `boolean` | Cart contains at least one `kind === "panty"` item. |
| `cart_mode` | `boolean` | Session was opened in multi-item cart mode (`metadata.cart_mode === "1"`). |
| `status` | `string` | Raw Stripe session status (`"complete" \| "open" \| "expired" \| …`). |
| `reason` | `string` | Why a cancellation fired (see per-event tables). |
| `items` | `string` (JSON) | Only on `panty_checkout_start` — JSON string of `{ kind, id, title, quantity, unit_amount_cents, currency }`. |

## `panty_checkout_started`

Fired from `src/routes/store.subscribe.tsx` when the single-item subscribe
flow launches a panty checkout. Legacy shape, still emitted alongside the
newer `panty_checkout_start`.

| Field | Type | Always present |
| --- | --- | --- |
| `variant` | `string` | yes |

## `panty_checkout_start`

Fired from `src/components/CartDrawer.tsx` when the user clicks "Checkout"
in the cart drawer.

| Field | Type | Always present |
| --- | --- | --- |
| `source` | `"cart"` | yes |
| `client_order_ref` | `string` | yes |
| `item_count` | `number` | yes |
| `unit_count` | `number` | yes |
| `subtotal_cents` | `number` | yes |
| `total_amount_cents` | `number` | yes (equals `subtotal_cents`) |
| `currency` | `string` | yes |
| `has_panty` | `boolean` | yes |
| `items` | `string` (JSON) | yes |

## `panty_checkout_pending`

Fired from `src/routes/checkout.return.tsx` when the return page loads and
`session.status === "open"` (Stripe accepted the session but payment hasn't
finalised).

| Field | Type | Always present |
| --- | --- | --- |
| `variant` | `string` | yes |
| `session_id` | `string` | yes |
| `payment_intent_id` | `string` | when Stripe has one |
| `client_order_ref` | `string` | when set in session metadata |
| `order_id` | `string` | when the webhook has already created the row (usually **absent** at pending stage) |
| `order_ids` | `string` | as above |
| `order_count` | `number` | yes (may be `0`) |
| `total_amount_cents` | `number` | when Stripe has computed it |
| `currency` | `string` | when Stripe has one |
| `status` | `"open"` | yes |
| `cart_mode` | `boolean` | yes |

## `panty_checkout_confirmed`

Fired from `src/routes/checkout.return.tsx` when `session.status === "complete"`.

Same shape as `panty_checkout_pending`, with:

| Field | Type | Always present |
| --- | --- | --- |
| `status` | `"complete"` | yes |
| `order_id` | `string` | yes once the webhook has processed the session (may still be absent if the client returns before the webhook lands — dedup by `session_id`) |
| `order_ids` | `string` | as above |
| `order_count` | `number` | yes |

## `panty_checkout_cancelled`

Fired from multiple sites. Always includes `source`, `stage`, and `reason`.

Emit sites and their extra fields:

### `source: "cart_drawer"` — `src/components/CartDrawer.tsx`
Cart drawer was closed with items still inside.

| Field | Value / type |
| --- | --- |
| `reason` | `"drawer_closed"` |
| `stage` | `"pre_checkout"` |
| `item_count`, `unit_count`, `subtotal_cents`, `currency`, `has_panty` | as in common fields |

### `source: "checkout_page"` — `src/routes/checkout.cart.tsx`
User clicked "← Store" from the cart checkout page.

| Field | Value / type |
| --- | --- |
| `reason` | `"back_to_store"` |
| `stage` | `"pre_payment"` |
| `item_count`, `unit_count`, `subtotal_cents`, `currency`, `has_panty` | as in common fields |

### `source: "checkout_return"` — `src/routes/checkout.return.tsx`
Return page reached a non-complete state.

| `reason` | Extra fields |
| --- | --- |
| `"return_incomplete"` | Full `panty_checkout_pending`/`confirmed` base payload plus `stage: "post_return"`. Fires when `session.status` is neither `"complete"` nor `"open"`. |
| `"missing_session_id"` | `stage: "post_return"` only. Fires when Stripe returned a placeholder `session_id` template. |
| `"session_fetch_error"` | `session_id`, `stage: "post_return"`. Fires when `getCheckoutSession` errored. |

## Deduplication

- `panty_checkout_pending` / `_confirmed` / `_cancelled` from the return
  page are keyed by `${sessionId}:${eventName}` in a `useRef`, so re-renders
  and the redirect delay don't double-fire.
- Return-page error variants (`missing_session_id`, `session_fetch_error`)
  use a separate `useRef` keyed by `"template"` or `error:${sessionId}`.
- For downstream reconciliation, treat `session_id` (Stripe) and `order_id`
  (`panty_orders.id`) as the canonical join keys; `client_order_ref` is the
  fallback when neither has been produced yet.

## Validation checklist

An event conforms when:

1. `event` matches one of the names above.
2. Every present value is a `string`, `number`, or `boolean` (no `null` /
   `undefined` after `track()` scrubbing).
3. Required fields for that specific event (see per-event tables) are all
   present.
4. `session_id` matches `/^cs_[A-Za-z0-9_]+$/` when present.
5. `payment_intent_id` matches `/^pi_[A-Za-z0-9_]+$/` when present.
6. `order_id` / each entry of `order_ids` is a UUID when present.
7. `currency` is a lowercase ISO 4217 code.
8. `order_count === order_ids?.split(",").length` when both are present
   (or `0` when neither is).
