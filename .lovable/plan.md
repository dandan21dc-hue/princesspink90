## Scope

- **Cartable**: `store items` (photo sets, videos, bundles) and `panty_24/48/72hr_aud`.
- **Not cartable** (Stripe / product constraints): subscriptions, lifetime, term passes, private-room bookings. These keep their existing single-item "Buy now" flow. I'll note it in the UI where relevant.

## What I'll build

### 1. Cart store (client, localStorage)
`src/lib/cart.ts` — tiny Zustand-style hook (no dep, just `useSyncExternalStore` + `localStorage`).
- Item shape: `{ kind: "content" | "panty", id, title, unit_amount_cents, currency, cover_url?, priceId? }`
- API: `useCart()` → `{ items, add(item), remove(id), setQty(id, q), clear() }`
- Persisted under `pp_cart_v1`, hydrated on mount.

### 2. Cart UI
- **Header icon** (`SiteHeader.tsx`): shopping-bag with count badge; opens the drawer.
- **CartDrawer** (`src/components/CartDrawer.tsx`): shadcn `Sheet`, lists items with thumbnail/title/price/qty controls/remove; subtotal; shipping notice if any panty is in cart; "Checkout" button.
- **"Add to cart"** buttons on:
  - `store/$id.tsx` — next to existing "Buy now"
  - `store/subscribe.tsx` — only on the 3 panty cards
- Store list (`store.tsx`) keeps its existing Link-to-detail behavior.

### 3. Multi-item checkout server fn
`createCartCheckoutSession` in `src/lib/store.functions.ts`:
- Input: `{ items: Array<{ kind, id, quantity }>, userId?, customerEmail?, returnUrl, environment, customerCountry? }`
- Resolves each item server-side (never trust client prices):
  - `content` → look up `content_items` row → `price_data` from `price_cents`.
  - `panty` → resolve via `lookup_keys` (`panty_24hr_aud` etc).
- Builds one `checkout.sessions.create` with all `line_items` in `mode: "payment"`.
- If any panty item is present → attach the existing AU shipping option + `shipping_address_collection`.
- Uses `resolveOrCreateCustomer` and sets `metadata.userId`.
- `managed_payments` on when eligible (digital-only cart) — off when the cart contains a panty item, matching the existing single-item rule.
- Stores per-line fulfillment hints in session metadata:
  - `cart_content_ids` = comma-joined content_item UUIDs
  - `cart_panty_prices` = comma-joined panty priceIds with qty
  - `cart_mode = "1"` so the webhook takes the multi-item path.

### 4. Webhook fulfillment
Extend `checkout.session.completed` handler in `src/routes/api/public/payments/webhook.ts`:
- If `metadata.cart_mode === "1"`:
  - For each `cart_content_ids` UUID → insert one `content_purchases` row (existing single-item logic reused, extracted into a small helper).
  - For each `cart_panty_prices` entry → insert one `panty_orders` row with shipping details from the session (existing panty logic reused).
- Existing single-item code path is untouched — old bookings/subs/etc. keep working.

### 5. Return URL
Cart checkout returns to `/checkout/return?next=%2Flibrary` (or `%2Fdashboard` if any panty item is in cart). Existing return page needs no changes.

## Files touched

- **new**: `src/lib/cart.ts`, `src/components/CartDrawer.tsx`, `src/components/CartButton.tsx`
- **edit**: `src/components/SiteHeader.tsx`, `src/routes/store.$id.tsx`, `src/routes/store.subscribe.tsx`, `src/lib/store.functions.ts`, `src/routes/api/public/payments/webhook.ts`, `src/routes/__root.tsx` (mount drawer once)

## Test plan (preview, sandbox card `4242 4242 4242 4242`)

1. Add two different store items → open cart → checkout → after return, both appear in `/library`.
2. Add one store item + one `panty_48hr` → shipping address form should appear in checkout; after payment, library shows the content and a panty order row exists in the admin.
3. Add only panty items → shipping still required.
4. Remove/qty edit in drawer → reflected instantly and after reload (localStorage).
5. Passes and private-room bookings → no "Add to cart" button; direct checkout unchanged.
6. Cart persists across page reloads; `Clear cart` after successful checkout return.

## Out of scope (call out to user)

- Mixing subscriptions with one-time items in one Stripe session (Stripe won't allow it).
- Booking a private room from the cart (single time slot per session).
- Cross-device cart sync (would need a DB table + RLS; user opted for local only).