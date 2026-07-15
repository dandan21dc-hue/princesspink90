# Brand Ambassador Referral System

## Scope

Add a lightweight referral program. Every user gets a unique 6-character code at sign-up. New users can enter someone's code during sign-up, which awards the referrer 50 reward points. Users see their code, share link, and point balance on a new Rewards tab.

## Database (one migration)

Add to `public.profiles` (the app's user table — `auth.users` is managed by Supabase, so all custom user data lives on `profiles`):

- `referral_code text UNIQUE` — 6-char uppercase alphanumeric, generated on insert.
- `reward_points integer NOT NULL DEFAULT 0`.
- Case-insensitive index on `referral_code` for lookups.

Trigger work:

- `assign_referral_code()` BEFORE INSERT on profiles — generates a random 6-char code, retries on collision (uses uppercase A–Z / 2–9, excluding confusable chars like 0/O/1/I).
- Extend the existing `handle_new_user()` trigger (fires on `auth.users` insert) to also read `raw_user_meta_data->>'referral_code'` and, when it matches an existing `profiles.referral_code`, increment that referrer's `reward_points` by 50. Silently ignores an unknown/blank code — a bad code never blocks signup.
- Backfill existing profiles with codes so no user is left without one.

RLS: existing profile policies already let users read/update their own row — no policy changes needed. Awarding happens inside a `SECURITY DEFINER` trigger, so users can't hand-edit their own points.

## Sign-up flow (`src/routes/auth.tsx`)

- Add an optional "Referral code (optional)" input, shown only in signup mode.
- Uppercase + trim on submit; skip when blank.
- Pass through `options.data.referral_code` on `supabase.auth.signUp` so the trigger sees it.

## Rewards tab

Add a new authenticated route `src/routes/_authenticated/account.rewards.tsx` and a "Rewards" link in the existing account nav (`account.tsx`). The tab shows:

- Current point balance (big number).
- The user's referral code with a copy button.
- A full referral link: `${origin}/auth?ref=CODE` with a copy button.
- One-line explainer: "Friends who sign up with your code earn you 50 points."

Data comes from a new authenticated server function `getMyRewards()` in `src/lib/rewards.functions.ts` that reads `referral_code` and `reward_points` from the caller's profile row (RLS enforces ownership).

Also: when `/auth` loads with `?ref=CODE`, pre-fill the referral input.

## Technical notes

- No new tables — one column change on `profiles`, two trigger updates.
- Points are a simple counter for now; no redemption flow, no per-referral audit table (can be added later without breaking this).
- Trigger uses `SECURITY DEFINER` + `search_path = public` and does a bounded number of collision retries.
- Types file regenerates after the migration is approved; the Rewards route and server function are written after that so the new columns are typed.

## Files touched

- New migration (columns, functions, triggers, backfill).
- `src/routes/auth.tsx` — referral input + `?ref=` prefill.
- `src/lib/rewards.functions.ts` — new.
- `src/routes/_authenticated/account.rewards.tsx` — new.
- `src/routes/_authenticated/account.tsx` — add Rewards nav link.
