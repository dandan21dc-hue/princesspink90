import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
  assertAudCurrency,
} from "@/lib/stripe.server";
import { TAX_CODES, isEligibleForManagedPayments } from "@/lib/stripe-tax-codes";
import type Stripe from "stripe";

type CheckoutResult = { clientSecret: string } | { error: string };

// ---------- Public reads ----------

// Media in `content-media` is stored as bucket-relative paths (e.g.
// "<user>/<uuid>.jpg"), not full URLs. Public store pages need real URLs.
// Sign any non-URL path so <img>/<video src=...> is always a valid URL.
type MediaEntry = { url: string; type: "image" | "video" };

async function signContentMediaUrls(
  supabase: any,
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const needsSigning = Array.from(new Set(paths.filter((p) => p && !/^https?:\/\//i.test(p))));
  if (!needsSigning.length) return map;
  const { data, error } = await supabase.storage
    .from("content-media")
    .createSignedUrls(needsSigning, 60 * 60 * 24); // 24h
  if (error) {
    console.error("signContentMediaUrls failed", error.message);
    return map;
  }
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
  }
  return map;
}

function guessMediaType(url: string): "image" | "video" {
  return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url) ? "video" : "image";
}

async function hydrateItemMedia<
  T extends { cover_url: string | null; media_urls: unknown },
>(
  supabase: any,
  items: T[],
): Promise<Array<T & { media_urls: MediaEntry[] }>> {
  // Normalize media_urls into MediaEntry[] regardless of legacy shape.
  const normalized = items.map((item) => {
    const raw = item.media_urls;
    let entries: MediaEntry[] = [];
    if (Array.isArray(raw)) {
      entries = raw
        .map((m): MediaEntry | null => {
          if (typeof m === "string") return { url: m, type: guessMediaType(m) };
          if (m && typeof m === "object" && typeof (m as { url?: unknown }).url === "string") {
            const url = (m as { url: string }).url;
            const type = (m as { type?: string }).type === "video" ? "video" : (m as { type?: string }).type === "image" ? "image" : guessMediaType(url);
            return { url, type };
          }
          return null;
        })
        .filter((m): m is MediaEntry => !!m);
    }
    return { item, entries };
  });

  const allPaths: string[] = [];
  for (const { item, entries } of normalized) {
    if (item.cover_url) allPaths.push(item.cover_url);
    for (const e of entries) allPaths.push(e.url);
  }
  const signed = await signContentMediaUrls(supabase, allPaths);

  return normalized.map(({ item, entries }) => ({
    ...item,
    cover_url: item.cover_url
      ? signed.get(item.cover_url) ?? item.cover_url
      : null,
    media_urls: entries.map((e) => ({
      url: signed.get(e.url) ?? e.url,
      type: e.type,
    })),
  }));
}

export const listStoreItems = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("content_items")
    .select("id,kind,title,description,cover_url,media_urls,price_cents,currency,subscribers_only,sizes,materials,created_at")
    .eq("published", true)
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return hydrateItemMedia(supabase, data ?? []);
});

export const getStoreItem = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: row, error } = await supabase
      .from("content_items")
      .select("id,kind,title,description,cover_url,media_urls,price_cents,currency,subscribers_only,sizes,materials,created_at")
      .eq("id", data.id)
      .eq("published", true)
      .eq("moderation_status", "approved")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const [hydrated] = await hydrateItemMedia(supabase, [row]);
    return hydrated;
  });

// Public read: busy time ranges for the private room within [from, to].
export const listPrivateRoomBusy = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => {
    if (!data.from || !data.to) throw new Error("from/to required");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_private_room_busy", {
      from_ts: data.from,
      to_ts: data.to,
    });
    if (error) throw new Error(error.message);

    // Also union admin-managed "blocked" slots (marked booked/unavailable in
    // the Availability Manager) so the public picker greys them out.
    const { data: blocked, error: blockedErr } = await supabaseAdmin
      .from("private_session_slots")
      .select("start_time,end_time")
      .eq("is_booked", true)
      .lt("start_time", data.to)
      .gt("end_time", data.from);
    if (blockedErr) throw new Error(blockedErr.message);

    const busy = (rows ?? []) as Array<{ starts_at: string; duration_minutes: number }>;
    const blockedBusy = (blocked ?? []).map((b: { start_time: string; end_time: string }) => {
      const starts = new Date(b.start_time);
      const ends = new Date(b.end_time);
      return {
        starts_at: b.start_time,
        duration_minutes: Math.max(1, Math.round((ends.getTime() - starts.getTime()) / 60000)),
      };
    });
    return [...busy, ...blockedBusy];
  });



// ---------- Authenticated ----------

// Owner-scoped fetch of a private-room booking by its Stripe checkout session.
// RLS ensures only the booking's user (or an admin) can read the row.
export const getMyPrivateRoomBookingBySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string }) => {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId)) throw new Error("Invalid session id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,starts_at,duration_minutes,status,amount_cents,currency,party_size,notes,customer_email,created_at",
      )
      .eq("stripe_session_id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

// List all of the signed-in user's private-room bookings (past + upcoming).
export const listMyPrivateRoomBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,starts_at,duration_minutes,status,amount_cents,currency,party_size,notes,customer_email,created_at",
      )
      .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Return the status history (held/confirmed/cancelled) timeline for one of the
// user's bookings. RLS restricts access to the booking's owner (or admins).
export const listMyPrivateRoomBookingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("private_room_booking_status_events")
      .select("id,status,changed_at,note")
      .eq("booking_id", data.id)
      .order("changed_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Cancel one of the user's own bookings. Must be at least 2 hours away and not already cancelled.
export const cancelMyPrivateRoomBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; timeZone?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error: readErr } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,user_id,starts_at,status,duration_minutes,amount_cents,currency,party_size,customer_email",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.user_id !== context.userId) throw new Error("Not your booking");
    if (row.status === "cancelled") throw new Error("Already cancelled");
    const starts = new Date(row.starts_at).getTime();
    if (starts - Date.now() < 2 * 60 * 60 * 1000) {
      throw new Error("Bookings can only be cancelled at least 2 hours in advance");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    // Fire the cancellation email. Failures here shouldn't fail the cancel
    // action itself — the booking is already cancelled in the DB.
    try {
      const durationMinutes = (row.duration_minutes as number) ?? 60;
      const { formatBookingDateTime } = await import("@/lib/booking-format");
      const { dateLabel, timeLabel } = formatBookingDateTime(
        row.starts_at as string,
        durationMinutes,
        data.timeZone,
      );
      const durationLabel = durationMinutes === 30 ? "30-minute session" : "1-hour session";
      const amount =
        row.amount_cents != null
          ? new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: ((row.currency as string | null) ?? "aud").toUpperCase(),
            }).format((row.amount_cents as number) / 100)
          : undefined;
      const claimEmail =
        (context.claims as { email?: string } | null | undefined)?.email ?? null;
      const recipient = (row.customer_email as string | null) ?? claimEmail;
      if (recipient) {
        const origin =
          process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
          process.env.SITE_URL?.replace(/\/$/, "") ??
          "https://princesspink90.com";
        const dashboardUrl = `${origin}/bookings`;
        const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
        await enqueueTemplateEmail({
          templateName: "booking-cancelled",
          recipientEmail: recipient,
          idempotencyKey: `booking-cancelled-${row.id}`,
          templateData: {
            dateLabel,
            timeLabel,
            durationLabel,
            partySize: (row.party_size as number | null) ?? 1,
            amount,
            bookingId: row.id as string,
            dashboardUrl,
          },
        });
      }
    } catch (e) {
      console.error("[cancelMyPrivateRoomBooking] failed to enqueue cancellation email", e);
    }

    return { ok: true };
  });

// Reschedule a booking. Keeps duration, moves starts_at, validates lead time and no overlap.
export const rescheduleMyPrivateRoomBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; startsAt: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    if (Number.isNaN(Date.parse(data.startsAt))) throw new Error("Invalid startsAt");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error: readErr } = await context.supabase
      .from("private_room_bookings")
      .select("id,user_id,starts_at,duration_minutes,status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.user_id !== context.userId) throw new Error("Not your booking");
    if (row.status === "cancelled") throw new Error("Cannot reschedule a cancelled booking");
    const newStart = new Date(data.startsAt);
    if (newStart.getTime() - Date.now() < 60 * 60 * 1000) {
      throw new Error("New time must be at least 1 hour from now");
    }
    const hour = newStart.getHours();
    if (hour < 10 || hour > 21) throw new Error("Time must be between 10:00 and 22:00");
    const newEnd = new Date(newStart.getTime() + row.duration_minutes * 60_000);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: busy, error: busyErr } = await supabaseAdmin
      .from("private_room_bookings")
      .select("id,starts_at,duration_minutes,status,created_at")
      .neq("id", data.id)
      .in("status", ["confirmed", "pending"])
      .gte("starts_at", new Date(newStart.getTime() - 2 * 60 * 60_000).toISOString())
      .lte("starts_at", new Date(newEnd.getTime() + 2 * 60 * 60_000).toISOString());
    if (busyErr) throw new Error(busyErr.message);
    const conflict = (busy ?? []).some((b) => {
      if (b.status === "pending" && new Date(b.created_at).getTime() < Date.now() - 15 * 60_000) {
        return false; // stale hold
      }
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = bStart + b.duration_minutes * 60_000;
      return bStart < newEnd.getTime() && bEnd > newStart.getTime();
    });
    if (conflict) throw new Error("That slot is no longer available");
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ starts_at: newStart.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Admin-only booking mutations
// ---------------------------------------------------------------------------
// The self-serve cancel/reschedule server fns above intentionally forbid
// anyone but the booking owner. These admin variants add role-based access so
// only users with the `admin` role can publish changes to another guest's
// booking. They bypass the owner's 2-hour cancel and 1-hour reschedule lead
// times because operators sometimes need to move or void a booking at short
// notice, but every other invariant (valid slot window, no overlap with an
// existing booking, cannot un-cancel) still applies.

async function assertBookingAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin access required");
}

export const adminCancelPrivateRoomBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; timeZone?: string; reason?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    if (data.reason !== undefined && typeof data.reason !== "string") {
      throw new Error("Invalid reason");
    }
    if (typeof data.reason === "string" && data.reason.length > 500) {
      throw new Error("Reason too long");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertBookingAdmin(context.supabase, context.userId);
    const { data: row, error: readErr } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,user_id,starts_at,status,duration_minutes,amount_cents,currency,party_size,customer_email",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.status === "cancelled") throw new Error("Already cancelled");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Cancellation email — same shape as the owner-side flow.
    try {
      const durationMinutes = (row.duration_minutes as number) ?? 60;
      const { formatBookingDateTime } = await import("@/lib/booking-format");
      const { dateLabel, timeLabel } = formatBookingDateTime(
        row.starts_at as string,
        durationMinutes,
        data.timeZone,
      );
      const durationLabel = durationMinutes === 30 ? "30-minute session" : "1-hour session";
      const amount =
        row.amount_cents != null
          ? new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: ((row.currency as string | null) ?? "aud").toUpperCase(),
            }).format((row.amount_cents as number) / 100)
          : undefined;
      const recipient = (row.customer_email as string | null) ?? null;
      if (recipient) {
        const origin =
          process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
          process.env.SITE_URL?.replace(/\/$/, "") ??
          "https://princesspink90.com";
        const dashboardUrl = `${origin}/bookings`;
        const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
        await enqueueTemplateEmail({
          templateName: "booking-cancelled",
          recipientEmail: recipient,
          idempotencyKey: `booking-cancelled-${row.id}`,
          templateData: {
            dateLabel,
            timeLabel,
            durationLabel,
            partySize: (row.party_size as number | null) ?? 1,
            amount,
            bookingId: row.id as string,
            dashboardUrl,
          },
        });
      }
    } catch (e) {
      console.error("[adminCancelPrivateRoomBooking] failed to enqueue cancellation email", e);
    }

    return { ok: true, bookingId: row.id as string };
  });

export const adminReschedulePrivateRoomBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; startsAt: string; reason?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    if (Number.isNaN(Date.parse(data.startsAt))) throw new Error("Invalid startsAt");
    if (typeof data.reason === "string" && data.reason.length > 500) {
      throw new Error("Reason too long");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertBookingAdmin(context.supabase, context.userId);
    const { data: row, error: readErr } = await context.supabase
      .from("private_room_bookings")
      .select("id,user_id,starts_at,duration_minutes,status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.status === "cancelled") throw new Error("Cannot reschedule a cancelled booking");

    const newStart = new Date(data.startsAt);
    const hour = newStart.getHours();
    if (hour < 10 || hour > 21) throw new Error("Time must be between 10:00 and 22:00");
    const newEnd = new Date(newStart.getTime() + row.duration_minutes * 60_000);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: busy, error: busyErr } = await supabaseAdmin
      .from("private_room_bookings")
      .select("id,starts_at,duration_minutes,status,created_at")
      .neq("id", data.id)
      .in("status", ["confirmed", "pending"])
      .gte("starts_at", new Date(newStart.getTime() - 2 * 60 * 60_000).toISOString())
      .lte("starts_at", new Date(newEnd.getTime() + 2 * 60 * 60_000).toISOString());
    if (busyErr) throw new Error(busyErr.message);
    const conflict = (busy ?? []).some((b) => {
      if (b.status === "pending" && new Date(b.created_at).getTime() < Date.now() - 15 * 60_000) {
        return false;
      }
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = bStart + b.duration_minutes * 60_000;
      return bStart < newEnd.getTime() && bEnd > newStart.getTime();
    });
    if (conflict) throw new Error("That slot conflicts with another booking");

    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ starts_at: newStart.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, bookingId: row.id as string };
  });





async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error("Invalid userId");
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (options.userId && customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

function allowedReturnOrigins(): string[] {
  const origins: string[] = [];
  for (const key of ["PUBLIC_APP_URL", "SITE_URL"] as const) {
    const val = process.env[key];
    if (!val) continue;
    try {
      origins.push(new URL(val).origin);
    } catch {
      // ignore malformed env values
    }
  }
  return origins;
}

export function ensureSessionIdInReturnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("returnUrl must be http(s)");
  }
  // Enforce origin allowlist to prevent open redirect via Stripe return_url.
  // Only the application's own configured origin(s) are accepted. If no
  // PUBLIC_APP_URL/SITE_URL is configured (local dev), we fall through.
  const allowed = allowedReturnOrigins();
  if (allowed.length > 0 && !allowed.includes(parsed.origin)) {
    throw new Error("returnUrl must use the application origin");
  }
  if (rawUrl.includes("{CHECKOUT_SESSION_ID}")) return rawUrl;
  const [beforeHash, hash = ""] = rawUrl.split("#");
  const sep = beforeHash.includes("?") ? "&" : "?";
  const withTemplate = `${beforeHash}${sep}session_id={CHECKOUT_SESSION_ID}`;
  return hash ? `${withTemplate}#${hash}` : withTemplate;
}

/**
 * Non-throwing check: does the user currently qualify for the subscriber
 * discount on the Panty Drawer? Panty Drawer purchases themselves are open
 * to the public — this helper is only used to decide whether to apply the
 * 15% subscriber coupon.
 */
async function hasSubscriberAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  env: StripeEnv,
): Promise<boolean> {
  const nowIso = new Date().toISOString();

  const sub = await supabase
    .from("subscriptions")
    .select("status,current_period_end")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sub.error) return false;
  const s = sub.data as { status: string; current_period_end: string | null } | null;
  const subActive = !!s && (
    (["active", "trialing", "past_due"].includes(s.status)
      && (!s.current_period_end || s.current_period_end > nowIso))
    || (s.status === "canceled" && !!s.current_period_end && s.current_period_end > nowIso)
  );

  if (subActive) return true;

  const mem = await supabase
    .from("memberships")
    .select("kind,expires_at")
    .eq("user_id", userId)
    .eq("environment", env);

  if (mem.error) return false;
  const rows = (mem.data ?? []) as Array<{ kind: string; expires_at: string | null }>;
  return rows.some((m) =>
    m.kind === "lifetime"
    || (m.kind.startsWith("term_pass_") && !!m.expires_at && m.expires_at > nowIso),
  );
}


// ---------- Subscriber discount (Panty Drawer) ----------
//
// Active subscribers/members get a 15% Stripe coupon on their FIRST THREE
// panty purchases as a thank-you. After 3 paid orders the discount is no
// longer applied automatically — full price at checkout. The coupon is
// created once per Stripe environment on first use (idempotent by id)
// and re-used forever after.

export const SUBSCRIBER_DISCOUNT_PERCENT = 15;
export const SUBSCRIBER_DISCOUNT_MAX_ORDERS = 3;
const SUBSCRIBER_COUPON_ID = "subscriber_pantry_15";

async function ensureSubscriberCoupon(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(SUBSCRIBER_COUPON_ID);
  } catch (err: unknown) {
    const code = (err as { code?: string; statusCode?: number } | null)?.code
      ?? (err as { raw?: { code?: string } } | null)?.raw?.code;
    const status = (err as { statusCode?: number } | null)?.statusCode;
    if (code === "resource_missing" || status === 404) {
      await stripe.coupons.create({
        id: SUBSCRIBER_COUPON_ID,
        percent_off: SUBSCRIBER_DISCOUNT_PERCENT,
        duration: "forever",
        name: `Subscriber ${SUBSCRIBER_DISCOUNT_PERCENT}% off (first ${SUBSCRIBER_DISCOUNT_MAX_ORDERS} Panty Drawer orders)`,
      });
    } else {
      throw err;
    }
  }
  return SUBSCRIBER_COUPON_ID;
}

/**
 * Count of PAID panty orders for a user in the given env where the subscriber
 * discount was applied. Used to enforce the 3-discounted-purchases cap —
 * non-discounted orders (bought before subscribing, or after the cap) do not
 * count against the allowance.
 */
async function countDiscountedPantyOrders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  env: StripeEnv,
): Promise<number> {
  const { count, error } = await supabase
    .from("panty_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("environment", env)
    .eq("status", "paid")
    .gt("discount_percent", 0);
  if (error) return 0;
  return count ?? 0;
}



/**
 * Non-throwing subscriber check for UI use (mirrors assertPantyAccess).
 */
export const getSubscriberStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data }) => {
    try {
      // Read the caller's session lazily; signed-out visitors just get the
      // non-subscriber response instead of a 401 that blanks the store page.
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const authHeader = req?.headers.get("authorization") ?? "";
      const token = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
      if (!token) {
        return { isSubscriber: false, discountPercent: 0, discountedOrdersRemaining: 0, discountedOrdersMax: SUBSCRIBER_DISCOUNT_MAX_ORDERS };
      }

      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        },
      );
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        return { isSubscriber: false, discountPercent: 0, discountedOrdersRemaining: 0, discountedOrdersMax: SUBSCRIBER_DISCOUNT_MAX_ORDERS };
      }

      
      const isSub = await hasSubscriberAccess(supabase, userId, data.environment);
      if (!isSub) {
        return { isSubscriber: false, discountPercent: 0, discountedOrdersRemaining: 0, discountedOrdersMax: SUBSCRIBER_DISCOUNT_MAX_ORDERS };
      }
      const used = await countDiscountedPantyOrders(supabase, userId, data.environment);
      const remaining = Math.max(0, SUBSCRIBER_DISCOUNT_MAX_ORDERS - used);

      return {
        isSubscriber: true,
        discountPercent: remaining > 0 ? SUBSCRIBER_DISCOUNT_PERCENT : 0,
        discountedOrdersRemaining: remaining,
        discountedOrdersMax: SUBSCRIBER_DISCOUNT_MAX_ORDERS,
      };
    } catch {
      return { isSubscriber: false, discountPercent: 0, discountedOrdersRemaining: 0, discountedOrdersMax: SUBSCRIBER_DISCOUNT_MAX_ORDERS };
    }
  });

/**
 * Auto-renew term passes: resolve (or idempotently create) a recurring
 * Stripe price with interval=month, interval_count={3,6,12} that mirrors
 * the one-time term pass amount/product. Lookup key is
 * `all_access_{n}mo_renew_aud` so it's stable across sandbox and live.
 */
async function ensureRenewalPrice(
  stripe: Stripe,
  termMonths: number,
  sourcePrice: Stripe.Price,
): Promise<Stripe.Price> {
  const lookupKey = `all_access_${termMonths}mo_renew_aud`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  if (existing.data[0]) return existing.data[0];

  const productId =
    typeof sourcePrice.product === "string" ? sourcePrice.product : sourcePrice.product.id;

  return stripe.prices.create({
    product: productId,
    currency: assertAudCurrency(sourcePrice.currency),
    unit_amount: sourcePrice.unit_amount ?? 0,
    recurring: { interval: "month", interval_count: termMonths },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    nickname: `All-Access ${termMonths}mo (auto-renew)`,
  });
}




export const createStoreCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      priceId?: string;
      contentItemId?: string;
      pantyListingId?: string;
      quantity?: number;
      customerEmail?: string;
      userId?: string;
      returnUrl: string;
      environment: StripeEnv;
      bookingStartsAt?: string;
      bookingPartySize?: number;
      bookingNotes?: string;
      customerCountry?: string;
      autoRenew?: boolean;
    }) => {
      if (!data.priceId && !data.contentItemId && !data.pantyListingId) {
        throw new Error("priceId, contentItemId, or pantyListingId required");
      }
      if (data.priceId && !/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      if (data.contentItemId && !/^[a-f0-9-]+$/i.test(data.contentItemId)) throw new Error("Invalid item id");
      if (data.pantyListingId && !/^[a-f0-9-]{36}$/i.test(data.pantyListingId)) throw new Error("Invalid listing id");
      if (data.bookingPartySize !== undefined) {
        if (!Number.isInteger(data.bookingPartySize) || data.bookingPartySize < 1 || data.bookingPartySize > 10) {
          throw new Error("Party size must be between 1 and 10");
        }
      }
      if (data.bookingNotes !== undefined) {
        if (typeof data.bookingNotes !== "string") throw new Error("Invalid notes");
        if (data.bookingNotes.length > 1000) throw new Error("Notes must be 1000 characters or fewer");
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      // SECURITY: never trust client-supplied userId. Bind checkout to the
      // authenticated caller so an attacker cannot create sessions or
      // bookings on behalf of another user.
      data = { ...data, userId: context.userId };
      const stripe = createStripeClient(data.environment);
      const customerId =
        data.customerEmail || data.userId
          ? await resolveOrCreateCustomer(stripe, {
              email: data.customerEmail,
              userId: data.userId,
            })
          : undefined;

      const customerCountry = (data.customerCountry ?? "").toUpperCase() || undefined;

      // Subscription / lookup-key checkout
      if (data.priceId) {
        const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
        let stripePrice = prices.data[0];
        // Validate against the expected catalogue (interval + amount).
        // Logs a structured event when the plan is missing or misconfigured
        // in Stripe so drift is visible in server function logs.
        const { validatePlanPrice } = await import("@/lib/planPriceValidation.server");
        const issue = validatePlanPrice(data.priceId, stripePrice);
        if (!stripePrice) throw new Error("Price not found");
        if (issue?.kind === "mismatch") {
          throw new Error(
            `Plan ${issue.lookupKey} is misconfigured in Stripe (${issue.fields.join(", ")}). Please contact support.`,
          );
        }

        const isLifetime = data.priceId === "lifetime_onetime_aud";
        // Accept both the newer `_onetime_aud` and legacy `_monthly_aud`
        // naming — both are one-time upfront term passes unless auto-renew
        // is opted into at checkout (see below).
        const termPassMatch = /^all_access_(3|6|12)mo_(onetime|monthly)_aud$/.exec(data.priceId);
        const termMonths = termPassMatch ? Number(termPassMatch[1]) : null;
        const isPanty = /^panty_(24|48|72)hr_aud$/.test(data.priceId);
        const privateRoomMatch = /^private_room_(30|60)min_aud$/.exec(data.priceId);
        const privateRoomMinutes = privateRoomMatch ? Number(privateRoomMatch[1]) : null;

        // Auto-renew opt-in: swap the one-time term-pass price for a
        // recurring price with interval=month, interval_count=termMonths.
        // Lifetime and non-term SKUs ignore the flag.
        if (data.autoRenew && termMonths && !isLifetime) {
          stripePrice = await ensureRenewalPrice(stripe, termMonths, stripePrice);
        }

        const isRecurring = stripePrice.type === "recurring";

        // Retrieve product so we can (a) description one-time payments and
        // (b) ensure the product carries the correct tax code for tax
        // calculation / managed_payments eligibility.
        const productId =
          typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
        const product = await stripe.products.retrieve(productId);
        const productDescription = product.name;



        // Panty Drawer is open to the public — no access gate here.


        // Tax codes are set once via scripts/sync-stripe-tax-codes.mjs.
        // We no longer patch them per checkout — that hid API failures and
        // added latency to every payment. If a product is misconfigured,
        // re-run the sync script.


        // Private room: create a pending booking BEFORE checkout so the slot
        // is held. Verify no overlap. Duration/amount default to the global
        // site_settings values (the admin-configured defaults) whenever the
        // caller hasn't supplied an explicit override — the price-slug
        // (e.g. `private_room_60min_aud`) and the Stripe unit_amount are
        // treated as per-booking overrides layered over those defaults.
        const isBookingCheckout = privateRoomMinutes !== null || Boolean(data.bookingStartsAt);
        let privateRoomBookingId: string | null = null;
        if (isBookingCheckout) {
          if (!data.userId) throw new Error("Sign in required to book the private room");
          if (!data.bookingStartsAt) throw new Error("Please pick a start time");
          const startsAt = new Date(data.bookingStartsAt);
          if (Number.isNaN(startsAt.getTime())) throw new Error("Invalid start time");
          if (startsAt.getTime() < Date.now() + 60 * 60 * 1000) {
            throw new Error("Bookings must be at least 1 hour in advance");
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Load global defaults once — used whenever the checkout doesn't
          // carry an explicit override.
          const { data: defaults } = await supabaseAdmin
            .from("site_settings")
            .select("session_price_cents, session_duration_minutes")
            .eq("id", "host")
            .maybeSingle();
          const defaultDurationMinutes = defaults?.session_duration_minutes ?? 60;
          const defaultPriceCents = defaults?.session_price_cents ?? 27500;

          const bookingDurationMinutes = privateRoomMinutes ?? defaultDurationMinutes;
          const bookingAmountCents =
            typeof stripePrice.unit_amount === "number" && stripePrice.unit_amount > 0
              ? stripePrice.unit_amount
              : defaultPriceCents;

          const endsAt = new Date(startsAt.getTime() + bookingDurationMinutes * 60_000);
          const { data: busy, error: busyErr } = await supabaseAdmin.rpc(
            "get_private_room_busy",
            { from_ts: startsAt.toISOString(), to_ts: endsAt.toISOString() },
          );
          if (busyErr) throw new Error(busyErr.message);
          if ((busy ?? []).length > 0) throw new Error("That time is no longer available. Please pick another slot.");
          const env = data.environment;
          const { data: booking, error: bookErr } = await supabaseAdmin
            .from("private_room_bookings")
            .insert({
              user_id: data.userId,
              starts_at: startsAt.toISOString(),
              duration_minutes: bookingDurationMinutes,
              status: "pending",
              amount_cents: bookingAmountCents,
              currency: "aud",
              environment: env,
              customer_email: data.customerEmail ?? null,
              party_size: data.bookingPartySize ?? null,
              notes: data.bookingNotes?.trim() ? data.bookingNotes.trim() : null,
            })
            .select("id")
            .single();
          if (bookErr || !booking) throw new Error(bookErr?.message ?? "Could not hold slot");
          privateRoomBookingId = booking.id as string;
        }

        // Full tax compliance: use managed_payments for digital SKUs; panty
        // orders fall back to automatic_tax so tax is still calculated.
        const useManagedPayments = isEligibleForManagedPayments(data.priceId);

        // Panty subscriber discount: only for active subscribers/members,
        // and only on the first SUBSCRIBER_DISCOUNT_MAX_ORDERS paid orders.
        const applyPantyDiscount =
          isPanty
          && !!data.userId
          && (await hasSubscriberAccess(context.supabase, data.userId, data.environment))
          && (await countDiscountedPantyOrders(context.supabase, data.userId, data.environment))
             < SUBSCRIBER_DISCOUNT_MAX_ORDERS;


        const baseParams: Stripe.Checkout.SessionCreateParams = {
          line_items: [{ price: stripePrice.id, quantity: data.quantity || 1 }],
          mode: isRecurring ? "subscription" : "payment",
          ui_mode: "embedded_page",
          return_url: ensureSessionIdInReturnUrl(data.returnUrl),
          ...(customerId && { customer: customerId, customer_update: { address: "auto" } }),
          ...(!isRecurring && !useManagedPayments && {
            payment_intent_data: { description: productDescription },
          }),
          ...(isPanty && {
            shipping_address_collection: { allowed_countries: ["AU"] },
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount",
                  display_name: "Discreet AU shipping",
                  fixed_amount: { amount: 1500, currency: "aud" },
                },
              },
            ],
            // Subscriber thank-you: 15% off, first 3 paid panty orders only.
            ...(applyPantyDiscount && {
              discounts: [{ coupon: await ensureSubscriberCoupon(stripe) }],
            }),
          }),
          metadata: {
            ...(data.userId && { userId: data.userId }),
            ...(isLifetime && { membership: "lifetime" }),
            ...(termMonths && { membership: "term_pass", term_months: String(termMonths) }),
            ...(isRecurring && data.priceId && { subscription: data.priceId }),
            ...(isPanty && { panty_order: data.priceId }),
            ...(privateRoomBookingId && {
              booking: "private_room",
              private_room_booking_id: privateRoomBookingId,
            }),
            managed_payments: useManagedPayments ? "true" : "false",
            ...(customerCountry && { customer_country: customerCountry }),
            ...(isPanty && applyPantyDiscount && {
              subscriber_discount_percent: String(SUBSCRIBER_DISCOUNT_PERCENT),
            }),
          },

          ...(isRecurring && data.userId && {
            subscription_data: { metadata: { userId: data.userId } },
          }),
        };

        // Attach the tax handling that matches our compliance decision.
        // managed_payments is dahlia-preview and not in the SDK types yet.
        const paramsWithTax = useManagedPayments
          ? ({ ...baseParams, managed_payments: { enabled: true } } as unknown as Stripe.Checkout.SessionCreateParams)
          : { ...baseParams, automatic_tax: { enabled: true } };

        const session = await stripe.checkout.sessions.create(paramsWithTax);

        // Save Stripe session id on the pending booking so the webhook can confirm it.
        if (privateRoomBookingId) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("private_room_bookings")
            .update({ stripe_session_id: session.id })
            .eq("id", privateRoomBookingId);
        }

        return { clientSecret: session.client_secret ?? "" };
      }

      // ---------- Panty Drawer listing checkout (per-item, dynamic price) ----------
      if (data.pantyListingId) {
        // Panty Drawer is open to the public — no access gate here.



        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: listing, error: listingErr } = await sb
          .from("panty_listings")
          .select("id,title,description,cover_url,price_cents,published,sold")
          .eq("id", data.pantyListingId)
          .eq("published", true)
          .eq("sold", false)
          .maybeSingle();
        if (listingErr) throw new Error(listingErr.message);
        if (!listing) throw new Error("This pair is no longer available");
        if (!listing.price_cents || listing.price_cents < 50) throw new Error("Listing has no valid price");

        const applyDiscount =
          (await hasSubscriberAccess(context.supabase, data.userId!, data.environment))
          && (await countDiscountedPantyOrders(context.supabase, data.userId!, data.environment))
            < SUBSCRIBER_DISCOUNT_MAX_ORDERS;


        const listingParams: Stripe.Checkout.SessionCreateParams = {
          line_items: [
            {
              price_data: {
                currency: "aud",
                product_data: {
                  name: listing.title,
                  ...(listing.description && { description: listing.description.slice(0, 500) }),
                  ...(listing.cover_url && { images: [listing.cover_url] }),
                  tax_code: TAX_CODES.physical_goods,
                },
                unit_amount: listing.price_cents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          ui_mode: "embedded_page",
          return_url: ensureSessionIdInReturnUrl(data.returnUrl),
          ...(customerId && { customer: customerId, customer_update: { address: "auto" } }),
          payment_intent_data: { description: `Panty Drawer: ${listing.title}` },
          shipping_address_collection: { allowed_countries: ["AU"] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount",
                display_name: "Discreet AU shipping",
                fixed_amount: { amount: 1500, currency: "aud" },
              },
            },
          ],
          ...(applyDiscount && {
            discounts: [{ coupon: await ensureSubscriberCoupon(stripe) }],
          }),
          automatic_tax: { enabled: true },
          metadata: {
            userId: data.userId!,
            panty_listing_id: listing.id,
            panty_listing_title: listing.title.slice(0, 200),
            managed_payments: "false",
            ...(customerCountry && { customer_country: customerCountry }),
            ...(applyDiscount && {
              subscriber_discount_percent: String(SUBSCRIBER_DISCOUNT_PERCENT),
            }),
          },
        };

        const session = await stripe.checkout.sessions.create(listingParams);
        return { clientSecret: session.client_secret ?? "" };
      }

      // One-time item checkout via contentItemId + dynamic price_data.

      // Currency is read from the item, not hardcoded.
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: item, error } = await supabase
        .from("content_items")
        .select("id,title,description,price_cents,currency,published")
        .eq("id", data.contentItemId!)
        .eq("published", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!item) throw new Error("Item not found");
      if (!item.price_cents || item.price_cents < 50) throw new Error("Item is not for individual sale");

      // AUD-only: pricing is enforced in AUD regardless of what may be stored on the row.
      const itemCurrency = "aud";

      const contentParams: Stripe.Checkout.SessionCreateParams = {
        line_items: [
          {
            price_data: {
              currency: itemCurrency,
              product_data: {
                name: item.title,
                ...(item.description && { description: item.description.slice(0, 500) }),
                tax_code: TAX_CODES.digital_goods,
              },
              unit_amount: item.price_cents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: ensureSessionIdInReturnUrl(data.returnUrl),
        ...(customerId && { customer: customerId, customer_update: { address: "auto" } }),
        metadata: {
          ...(data.userId && { userId: data.userId }),
          content_item_id: item.id,
          managed_payments: "true",
          ...(customerCountry && { customer_country: customerCountry }),
        },
      };

      const paramsWithManaged = {
        ...contentParams,
        managed_payments: { enabled: true },
      } as unknown as Stripe.Checkout.SessionCreateParams;

      const session = await stripe.checkout.sessions.create(paramsWithManaged);
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ---------- Cart checkout (multi-item, one-time only) ----------

const PANTY_LOOKUP = ["panty_24hr_aud", "panty_48hr_aud", "panty_72hr_aud"] as const;
type PantyLookup = (typeof PANTY_LOOKUP)[number];

type CartItemInput =
  | { kind: "content"; id: string; quantity: number }
  | { kind: "panty"; id: PantyLookup; quantity: number };

/**
 * Multi-item checkout: builds ONE Stripe Checkout Session with N line items.
 * Only one-time SKUs are cartable (subscriptions and private-room bookings
 * cannot share a session). Server-authoritative on prices — the client
 * merely says "id + quantity", we look up the actual price/amount.
 */
export const createCartCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      items: CartItemInput[];
      returnUrl: string;
      environment: StripeEnv;
      customerEmail?: string;
      customerCountry?: string;
      /** Client-generated correlation id (UUID) so pre-checkout analytics
       *  events can be reconciled with the Stripe session created here. */
      clientOrderRef?: string;
    }) => {
      if (!Array.isArray(data.items) || data.items.length === 0) {
        throw new Error("Cart is empty");
      }
      if (data.items.length > 20) throw new Error("Too many items in cart");
      for (const it of data.items) {
        if (it.kind === "content") {
          if (!/^[a-f0-9-]+$/i.test(it.id)) throw new Error("Invalid content id");
        } else if (it.kind === "panty") {
          if (!PANTY_LOOKUP.includes(it.id)) throw new Error("Invalid panty variant");
        } else {
          throw new Error("Unsupported cart item");
        }
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 10) {
          throw new Error("Invalid quantity");
        }
        // Panty rows are unique per checkout session (schema constraint) and
        // don't have a per-order quantity column — enforce single-pair.
        if (it.kind === "panty" && it.quantity !== 1) {
          throw new Error("Only one of each panty variant per order");
        }
      }
      // Same reason — only one distinct panty variant per checkout session.
      const pantyCount = data.items.filter((it) => it.kind === "panty").length;
      if (pantyCount > 1) {
        throw new Error("Only one panty variant per order — check out separately");
      }
      if (data.clientOrderRef !== undefined) {
        if (typeof data.clientOrderRef !== "string" || data.clientOrderRef.length > 64) {
          throw new Error("Invalid clientOrderRef");
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(data.clientOrderRef)) {
          throw new Error("Invalid clientOrderRef");
        }
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const userId = context.userId;
      const stripe = createStripeClient(data.environment);
      const customerId = await resolveOrCreateCustomer(stripe, {
        email: data.customerEmail,
        userId,
      });

      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      // Split for lookup
      const contentIds = data.items.filter((it) => it.kind === "content").map((it) => it.id);
      const pantyItems = data.items.filter((it) => it.kind === "panty") as Array<{
        kind: "panty";
        id: PantyLookup;
        quantity: number;
      }>;

      // Panty Drawer is open to the public — no access gate here.




      // Fetch content items in one query
      let contentRows: Array<{
        id: string;
        title: string;
        description: string | null;
        price_cents: number | null;
        currency: string | null;
        published: boolean;
      }> = [];
      if (contentIds.length) {
        const { data: rows, error } = await supabase
          .from("content_items")
          .select("id,title,description,price_cents,currency,published")
          .in("id", contentIds)
          .eq("published", true);
        if (error) throw new Error(error.message);
        contentRows = rows ?? [];
      }
      const contentMap = new Map(contentRows.map((r) => [r.id, r]));

      // Fetch panty prices in one call (lookup keys) so amounts stay
      // Stripe-authoritative.
      const pantyPriceMap = new Map<PantyLookup, Stripe.Price>();
      if (pantyItems.length) {
        const uniqueKeys = Array.from(new Set(pantyItems.map((it) => it.id)));
        const prices = await stripe.prices.list({
          lookup_keys: uniqueKeys,
          active: true,
          expand: ["data.product"],
        });
        for (const p of prices.data) {
          if (p.lookup_key && PANTY_LOOKUP.includes(p.lookup_key as PantyLookup)) {
            pantyPriceMap.set(p.lookup_key as PantyLookup, p);
          }
        }
      }

      // Build Stripe line_items
      const lineItems: NonNullable<Stripe.Checkout.SessionCreateParams["line_items"]> = [];
      for (const it of data.items) {
        if (it.kind === "content") {
          const row = contentMap.get(it.id);
          if (!row) throw new Error("An item in your cart is no longer available");
          if (!row.price_cents || row.price_cents < 50) {
            throw new Error(`"${row.title}" is not available for individual sale`);
          }
          lineItems.push({
            price_data: {
              currency: "aud",
              product_data: {
                name: row.title,
                ...(row.description && { description: row.description.slice(0, 500) }),
                tax_code: TAX_CODES.digital_goods,
              },
              unit_amount: row.price_cents,
            },
            quantity: it.quantity,
          });
        } else {
          const price = pantyPriceMap.get(it.id);
          if (!price) throw new Error(`Panty variant ${it.id} is not currently available`);
          lineItems.push({ price: price.id, quantity: it.quantity });
        }
      }

      const hasPanty = pantyItems.length > 0;
      const customerCountry = (data.customerCountry ?? "").toUpperCase() || undefined;

      // Pack cart layout into session metadata for webhook fulfillment.
      // Metadata values cap at 500 chars — 20 items x ~40 chars fits.
      const cartContentMeta = data.items
        .filter((it) => it.kind === "content")
        .map((it) => `${it.id}:${it.quantity}`)
        .join(",");
      const cartPantyMeta = pantyItems.map((it) => `${it.id}:${it.quantity}`).join(",");

      // Full-compliance managed_payments only for digital-only carts. Panty
      // present → automatic_tax so shipping tax is still calculated.
      const useManagedPayments = !hasPanty;

      // Panty subscriber discount: only for active subscribers/members,
      // and only on the first SUBSCRIBER_DISCOUNT_MAX_ORDERS paid orders.
      const applyPantyDiscount =
        hasPanty
        && (await hasSubscriberAccess(context.supabase, userId, data.environment))
        && (await countDiscountedPantyOrders(context.supabase, userId, data.environment))
           < SUBSCRIBER_DISCOUNT_MAX_ORDERS;


      const baseParams: Stripe.Checkout.SessionCreateParams = {
        line_items: lineItems,
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: ensureSessionIdInReturnUrl(data.returnUrl),
        customer: customerId,
        customer_update: { address: "auto" },
        ...(!useManagedPayments && {
          payment_intent_data: { description: "Midnight Glory cart order" },
        }),
        ...(hasPanty && {
          shipping_address_collection: { allowed_countries: ["AU"] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount",
                display_name: "Discreet AU shipping",
                fixed_amount: { amount: 1500, currency: "aud" },
              },
            },
          ],
          // Subscriber thank-you: 15% off, first 3 paid panty orders only.
          ...(applyPantyDiscount && {
            discounts: [{ coupon: await ensureSubscriberCoupon(stripe) }],
          }),
        }),
        metadata: {
          userId,
          cart_mode: "1",
          ...(cartContentMeta && { cart_content_items: cartContentMeta }),
          ...(cartPantyMeta && { cart_panty_items: cartPantyMeta }),
          managed_payments: useManagedPayments ? "true" : "false",
          ...(customerCountry && { customer_country: customerCountry }),
          ...(data.clientOrderRef && { client_order_ref: data.clientOrderRef }),
          ...(applyPantyDiscount && {
            subscriber_discount_percent: String(SUBSCRIBER_DISCOUNT_PERCENT),
          }),
        },
      };

      const paramsWithTax = useManagedPayments
        ? ({ ...baseParams, managed_payments: { enabled: true } } as unknown as Stripe.Checkout.SessionCreateParams)
        : { ...baseParams, automatic_tax: { enabled: true } };

      const session = await stripe.checkout.sessions.create(paramsWithTax);
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });


// ---------- Library (owned content) ----------

export const getMyLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status,current_period_end")
      .eq("user_id", userId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const now = Date.now();
    const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
    const hasRecurring = !!sub && (
      (["active", "trialing", "past_due"].includes(sub.status) && (!periodEnd || periodEnd > now))
      || (sub.status === "canceled" && !!periodEnd && periodEnd > now)
    );

    const { data: memberships } = await supabase
      .from("memberships")
      .select("kind,expires_at")
      .eq("user_id", userId)
      .eq("environment", env);
    const hasMembershipAccess = (memberships ?? []).some((m) => {
      if (m.kind === "lifetime") return true;
      if (m.kind?.startsWith("term_pass_") && m.expires_at) {
        return new Date(m.expires_at).getTime() > now;
      }
      return false;
    });

    const hasSubscription = hasRecurring || hasMembershipAccess;

    const { data: purchases } = await supabase
      .from("content_purchases")
      .select("content_item_id,created_at")
      .eq("user_id", userId)
      .eq("environment", env);
    const purchasedIds = new Set((purchases ?? []).map((p) => p.content_item_id));

    const query = supabase
      .from("content_items")
      .select("id,kind,title,description,cover_url,media_urls,subscribers_only,price_cents,currency,created_at")
      .eq("published", true)
      .order("created_at", { ascending: false });
    const { data: allItems } = await query;

    // Simplified: subscribers see everything; non-subscribers see items
    // they've bought individually.
    const unlocked = (allItems ?? []).filter(
      (item) => hasSubscription || purchasedIds.has(item.id),
    );

    return { hasSubscription, items: unlocked };
  });

// ---------- Admin (creator) ----------

export const createContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      kind: "photo_set" | "video" | "bundle";
      title: string;
      description?: string;
      cover_url?: string;
      price_cents?: number | null;
      currency?: string;
      subscribers_only?: boolean;
      media_urls?: Array<{ url: string; type: "image" | "video" }>;
      published?: boolean;
    }) => {
      if (!data.title.trim() || data.title.length > 160) throw new Error("Title required (max 160 chars)");
      if (data.price_cents != null && (data.price_cents < 0 || data.price_cents > 1_000_00)) throw new Error("Price out of range");
      // Currency is AUD-only. Reject any other value (notably "usd", any
      // casing) so no admin action can create a non-AUD price. Any missing
      // or blank value is coerced to "aud"; the DB also enforces a CHECK
      // constraint as a last line of defence.
      const raw = data.currency;
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const normalized = String(raw).trim().toLowerCase();
        if (normalized === "usd") throw new Error("USD is not supported — prices must be AUD");
        if (normalized !== "aud") throw new Error("Currency must be AUD");
      }
      data.currency = "aud";
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("content_items")
      .insert({
        creator_id: userId,
        kind: data.kind,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        cover_url: data.cover_url || null,
        price_cents: data.price_cents ?? null,
        currency: "aud",
        subscribers_only: data.subscribers_only ?? false,
        media_urls: (data.media_urls ?? []) as any,
        published: data.published ?? true,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return row;
  });

export const listMyContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("content_items")
      .select("id,kind,title,price_cents,currency,subscribers_only,published,created_at")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("content_items")
      .delete()
      .eq("id", data.id)
      .eq("creator_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Signed URL for owned or accessible media
export const signMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; path: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: allowed } = await supabase.rpc("user_can_access_content", {
      _user_id: userId,
      _content_id: data.itemId,
      _env: env,
    });
    if (!allowed) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Assert requested path actually belongs to this item; prevents an
    // authenticated caller from signing arbitrary paths under content-media
    // by piggybacking on an item they legitimately have access to.
    const { data: item, error: itemErr } = await supabaseAdmin
      .from("content_items")
      .select("cover_url,media_urls")
      .eq("id", data.itemId)
      .maybeSingle();
    if (itemErr || !item) throw new Error("Item not found");
    const mediaUrls = (item.media_urls ?? []) as Array<{ url: string; type?: string }>;
    const allowedPaths = new Set<string>();
    if (item.cover_url) allowedPaths.add(item.cover_url as string);
    for (const m of mediaUrls) if (m?.url) allowedPaths.add(m.url);
    if (!allowedPaths.has(data.path)) throw new Error("Path not part of this item");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("content-media")
      .createSignedUrl(data.path, 60 * 10);
    if (error || !signed) throw new Error(error?.message ?? "Sign failed");
    return { url: signed.signedUrl };
  });

/**
 * Fetch a Checkout Session from Stripe by id, scoped to the signed-in user
 * via the metadata.userId stamp. Used by the /checkout/return landing page
 * to confirm status and route the user to the right destination.
 */
export const getCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId)) throw new Error("Invalid session id");
    return data;
  })
  .handler(async ({ data, context }): Promise<
    | {
        status: string | null;
        metadata: Record<string, string> | null;
        session_id: string;
        payment_intent_id: string | null;
        amount_total: number | null;
        currency: string | null;
        order_ids: string[];
      }
    | { error: string }
  > => {
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);
      const metadata = (session.metadata ?? {}) as Record<string, string>;
      // Security: only expose the session to its owner.
      if (metadata.userId && metadata.userId !== context.userId) {
        throw new Error("Not allowed");
      }
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      // Reconciliation: return the panty_orders row id(s) the webhook created
      // for this session so client tracking can include order_id alongside the
      // Stripe identifiers. RLS scopes this read to the session's owner.
      const { data: orders } = await context.supabase
        .from("panty_orders")
        .select("id")
        .eq("stripe_session_id", session.id);
      const orderIds = (orders ?? []).map((o) => o.id as string);

      return {
        status: session.status ?? null,
        metadata,
        session_id: session.id,
        payment_intent_id: paymentIntentId,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        order_ids: orderIds,
      };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ---------- Admin moderation queue ----------

export const adminListModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { status?: "pending" | "approved" | "rejected" | "all" }) => data ?? {})
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("content_items")
      .select(
        "id,kind,title,description,cover_url,media_urls,creator_id,published,moderation_status,moderation_notes,moderation_reviewed_at,moderation_reviewed_by,moderation_submitted_at,created_at",
      )
      .order("moderation_submitted_at", { ascending: false });
    const status = data.status ?? "pending";
    if (status !== "all") q = q.eq("moderation_status", status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminModerateContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { id: string; decision: "approved" | "rejected" | "pending"; notes?: string }) => {
      if (!data.id) throw new Error("id required");
      if (!["approved", "rejected", "pending"].includes(data.decision)) {
        throw new Error("Invalid decision");
      }
      if (data.notes && data.notes.length > 2000) throw new Error("Notes too long");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("content_items")
      .update({
        moderation_status: data.decision,
        moderation_notes: data.notes?.trim() || null,
        moderation_reviewed_by: context.userId,
        moderation_reviewed_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("id,moderation_status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminGetModerationMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { path: string }) => {
    if (!data.path) throw new Error("path required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("content-media")
      .createSignedUrl(data.path, 60 * 10);
    if (error || !signed) throw new Error(error?.message ?? "Sign failed");
    return { url: signed.signedUrl };
  });
