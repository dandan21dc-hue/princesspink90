# Refactor `/panty-drawer` to an item-only gallery

## Goal
Replace the current 24/48/72-hour tier page with a clean grid of the panty items admins upload in **Admin → Panty Listings** (`panty_listings` table). Each card shows the uploaded image, title, and price, and its Buy button uses a standard per-item Stripe checkout for that exact listing at its own price — not the old 24/48/72hr tier prices.

## What changes for the user
- No more static "24 Hours Worn / 48 Hours / 72 Hours" tier cards or "Worn Hours" copy.
- The page shows only pairs uploaded in your admin panty-listings manager that are `published = true` and `sold = false`.
- If nothing is uploaded (or everything sold), the page shows: **"New items coming soon — check back shortly."**
- Each card: cover image, title, price (AUD), and a Buy button that opens Stripe embedded checkout for that individual listing.
- Members-only rule stays: buying still requires an active All-Access subscription or lifetime membership (same guard as today), so members-only messaging remains.
- Shipping A$15 and subscriber discount continue to apply automatically at checkout.

## Technical outline

### Frontend
- Rewrite `src/routes/panty-drawer.tsx`:
  - Fetch `listPantyListingsPublic()` with TanStack Query.
  - Loading: skeleton grid. Empty: the "coming soon" placeholder. Populated: responsive grid of cards (image, title, price, Buy).
  - Buy button uses `useStripeCheckout()` with a new server-fn call `createPantyListingCheckout({ listingId, userId, customerEmail, returnUrl, environment })`.
  - Keep `PaymentTestModeBanner` and the existing head/OG metadata (updated wording to drop "24/48/72" phrasing).

### Backend (server function)
Add `createPantyListingCheckout` in `src/lib/store.functions.ts` alongside the existing store checkout code:
- Auth-gated with `requireSupabaseAuth`.
- Verify the user has an active All-Access subscription, lifetime membership, or active term pass (reuse the same members-only helper the existing panty flow uses).
- Read the listing from `panty_listings` where `id = listingId AND published AND NOT sold`. Reject otherwise.
- Build a Stripe Checkout Session with dynamic `price_data`:
  - `currency: "aud"` (hardcoded — AUD-only rule).
  - `unit_amount: listing.price_cents`, `product_data.name: listing.title`, tax code `TAX_CODES.tangible_goods` (matches panties).
  - `mode: "payment"`, `ui_mode: "embedded_page"`.
  - `shipping_address_collection: { allowed_countries: ["AU"] }` + the same A$15 discreet AU shipping rate used by panty cart checkout.
  - Reuse `resolveOrCreateCustomer` and `automatic_tax: { enabled: true }` (panty flow is not eligible for managed_payments).
  - Apply the subscriber discount coupon when eligible (same helper the current panty checkout uses).
  - Metadata: `userId`, `panty_listing_id: listing.id`, `panty_listing_title`.
- Return `{ clientSecret }` or `{ error }`.

### Webhook / order write
- `src/routes/api/public/payments/webhook.ts` already inserts a `panty_orders` row for panty purchases. Extend the handler to recognize sessions carrying `metadata.panty_listing_id`:
  - Insert a `panty_orders` row with `panty_listing_id`, price/currency from the session, and shipping info.
  - Mark the corresponding `panty_listings.sold = true` so it disappears from the gallery on the next load.

### Cleanup
- Remove the `<PantyGallery>` block from `/store/subscribe` (or make it link back to `/panty-drawer`) so item-level browsing lives in one place. The 24/48/72hr tier buy cards on `/store/subscribe` are left untouched — the request only refactors `/panty-drawer`.
- No changes to `panty_listings` schema, RLS, or the admin uploader.

## Files touched
- `src/routes/panty-drawer.tsx` — full rewrite.
- `src/lib/store.functions.ts` — add `createPantyListingCheckout`.
- `src/routes/api/public/payments/webhook.ts` — handle the new metadata and mark listing sold.
- `src/routes/store.subscribe.tsx` — small: drop or link the gallery block (optional, only if you want it deduped).

## Out of scope
- Adding new fields to `panty_listings` (already has `title`, `cover_url`, `price_cents`, `published`, `sold`).
- Changing the admin uploader UI.
- Changing 24/48/72hr tier checkout on `/store/subscribe`.
