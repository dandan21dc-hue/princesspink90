import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv } from "@/lib/stripe";



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
      .eq("stripe_session_id" as any, data.sessionId)
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
  .inputValidator((data: { id: string; startsAt: string; timeZone?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    if (Number.isNaN(Date.parse(data.startsAt))) throw new Error("Invalid startsAt");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error: readErr } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,user_id,starts_at,duration_minutes,status,amount_cents,currency,party_size,customer_email",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.user_id !== context.userId) throw new Error("Not your booking");
    if (row.status === "cancelled") throw new Error("Cannot reschedule a cancelled booking");
    const newStart = new Date(data.startsAt);
    const rejectBase = {
      attemptKind: "reschedule_self" as const,
      userId: context.userId,
      attemptedStartsAt: newStart.toISOString(),
      durationMinutes: row.duration_minutes as number,
      bookingId: row.id as string,
    };
    if (newStart.getTime() - Date.now() < 60 * 60 * 1000) {
      const { logBookingRejection } = await import("@/lib/booking-rejection-log.server");
      await logBookingRejection({
        ...rejectBase,
        reasonCode: "lead_time_too_short",
        reasonMessage: "New time must be at least 1 hour from now",
      });
      throw new Error("New time must be at least 1 hour from now");
    }
    const hour = newStart.getHours();
    if (hour < 10 || hour > 21) {
      const { logBookingRejection } = await import("@/lib/booking-rejection-log.server");
      await logBookingRejection({
        ...rejectBase,
        reasonCode: "outside_operating_hours",
        reasonMessage: "Time must be between 10:00 and 22:00",
        metadata: { requestedHour: hour },
      });
      throw new Error("Time must be between 10:00 and 22:00");
    }
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
    const conflictRows = (busy ?? []).filter((b) => {
      if (b.status === "pending" && new Date(b.created_at).getTime() < Date.now() - 15 * 60_000) {
        return false; // stale hold
      }
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = bStart + b.duration_minutes * 60_000;
      return bStart < newEnd.getTime() && bEnd > newStart.getTime();
    });
    if (conflictRows.length > 0) {
      const { logBookingRejection } = await import("@/lib/booking-rejection-log.server");
      await logBookingRejection({
        ...rejectBase,
        reasonCode: "slot_conflict",
        reasonMessage: "That slot is no longer available",
        conflictBookingIds: conflictRows.map((b) => b.id as string),
      });
      throw new Error("That slot is no longer available");
    }

    const oldStartsAt = row.starts_at as string;
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ starts_at: newStart.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    try {
      const claimEmail =
        (context.claims as { email?: string } | null | undefined)?.email ?? null;
      const recipient = (row.customer_email as string | null) ?? claimEmail;
      if (recipient) {
        const { enqueueBookingRescheduledEmail } = await import(
          "@/lib/booking-reschedule-email.server"
        );
        await enqueueBookingRescheduledEmail({
          bookingId: row.id as string,
          recipient,
          oldStartsAt,
          newStartsAt: newStart.toISOString(),
          durationMinutes: row.duration_minutes as number,
          partySize: (row.party_size as number | null) ?? 1,
          amountCents: row.amount_cents as number | null,
          currency: row.currency as string | null,
          timeZone: data.timeZone,
          rescheduledByStaff: false,
        });
      }
    } catch (e) {
      console.error("[rescheduleMyPrivateRoomBooking] failed to enqueue reschedule email", e);
    }


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
  .inputValidator((data: { id: string; startsAt: string; reason?: string; timeZone?: string }) => {
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
      .select(
        "id,user_id,starts_at,duration_minutes,status,amount_cents,currency,party_size,customer_email",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Booking not found");
    if (row.status === "cancelled") throw new Error("Cannot reschedule a cancelled booking");

    const newStart = new Date(data.startsAt);
    const rejectBase = {
      attemptKind: "reschedule_admin" as const,
      userId: (row.user_id as string | null) ?? context.userId,
      attemptedStartsAt: newStart.toISOString(),
      durationMinutes: row.duration_minutes as number,
      bookingId: row.id as string,
      metadata: { admin_id: context.userId, ...(data.reason ? { reason: data.reason } : {}) },
    };
    const hour = newStart.getHours();
    if (hour < 10 || hour > 21) {
      const { logBookingRejection } = await import("@/lib/booking-rejection-log.server");
      await logBookingRejection({
        ...rejectBase,
        reasonCode: "outside_operating_hours",
        reasonMessage: "Time must be between 10:00 and 22:00",
        metadata: { ...rejectBase.metadata, requestedHour: hour },
      });
      throw new Error("Time must be between 10:00 and 22:00");
    }
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
    const conflictRows = (busy ?? []).filter((b) => {
      if (b.status === "pending" && new Date(b.created_at).getTime() < Date.now() - 15 * 60_000) {
        return false;
      }
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = bStart + b.duration_minutes * 60_000;
      return bStart < newEnd.getTime() && bEnd > newStart.getTime();
    });
    if (conflictRows.length > 0) {
      const { logBookingRejection } = await import("@/lib/booking-rejection-log.server");
      await logBookingRejection({
        ...rejectBase,
        reasonCode: "slot_conflict",
        reasonMessage: "That slot conflicts with another booking",
        conflictBookingIds: conflictRows.map((b) => b.id as string),
      });
      throw new Error("That slot conflicts with another booking");
    }


    const oldStartsAt = row.starts_at as string;
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({ starts_at: newStart.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    try {
      const recipient = row.customer_email as string | null;
      if (recipient) {
        const { enqueueBookingRescheduledEmail } = await import(
          "@/lib/booking-reschedule-email.server"
        );
        await enqueueBookingRescheduledEmail({
          bookingId: row.id as string,
          recipient,
          oldStartsAt,
          newStartsAt: newStart.toISOString(),
          durationMinutes: row.duration_minutes as number,
          partySize: (row.party_size as number | null) ?? 1,
          amountCents: row.amount_cents as number | null,
          currency: row.currency as string | null,
          timeZone: data.timeZone,
          reason: data.reason,
          rescheduledByStaff: true,
        });
      }
    } catch (e) {
      console.error("[adminReschedulePrivateRoomBooking] failed to enqueue reschedule email", e);
    }

    return { ok: true, bookingId: row.id as string };
  });







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







// ---------- Library (owned content) ----------

export const getMyLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    // Subscriptions table was dropped when Stripe was removed. All-Access
    // now flows exclusively through `memberships` below; recurring
    // "subscription" access no longer exists as a separate row.
    const sub: {
      status: string;
      current_period_end: string | null;
    } | null = null as any;
    const now = Date.now();
    const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
    const hasRecurring = !!sub && (
      (["active", "trialing", "past_due"].includes(sub!.status) && (!periodEnd || periodEnd > now))
      || (sub!.status === "canceled" && !!periodEnd && periodEnd > now)
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
      .select("id,kind,title,price_cents,currency,subscribers_only,published,created_at,moderation_status,moderation_notes,moderation_reviewed_at")
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

    // Snapshot the previous status + item metadata so the audit row is
    // self-contained even if the item is deleted later.
    const { data: prev } = await supabaseAdmin
      .from("content_items")
      .select("id,title,kind,creator_id,moderation_status")
      .eq("id", data.id)
      .maybeSingle();
    if (!prev) throw new Error("Content item not found");

    const trimmedNotes = data.notes?.trim() || null;

    const { data: row, error } = await supabaseAdmin
      .from("content_items")
      .update({
        moderation_status: data.decision,
        moderation_notes: trimmedNotes,
        moderation_reviewed_by: context.userId,
        moderation_reviewed_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("id,moderation_status")
      .single();
    if (error) throw new Error(error.message);

    // Best-effort: record the decision. Never fail the moderation call on an
    // audit-log write failure — the primary action already succeeded.
    try {
      const { data: actor } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("user_id", context.userId)
        .maybeSingle();
      const actorEmail = context.claims?.email ?? actor?.display_name ?? null;
      await supabaseAdmin.from("content_moderation_audit").insert({
        content_item_id: data.id,
        item_title: prev.title,
        item_kind: prev.kind,
        creator_id: prev.creator_id,
        action: data.decision,
        previous_status: prev.moderation_status,
        notes: trimmedNotes,
        actor_id: context.userId,
        actor_email: actorEmail,
      } as any);
    } catch (e) {
      console.warn("content_moderation_audit insert failed", e);
    }

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

/**
 * Hard-delete a content item from the admin moderation queue. Used when an
 * upload fails or is spam/duplicate and shouldn't linger as a "rejected"
 * row. Cascades remove any content_purchases rows via the FK; media blobs in
 * the content-media bucket are removed on a best-effort basis.
 */
export const adminDeleteContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data.id) throw new Error("id required");
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

    // Fetch full row first so we can (a) audit the delete and (b) remove blobs.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("content_items")
      .select("id, title, kind, creator_id, moderation_status, cover_url, media_urls")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Content item not found");

    const { error: delErr } = await supabaseAdmin
      .from("content_items")
      .delete()
      .eq("id", data.id);
    if (delErr) throw new Error(delErr.message);

    // Best-effort blob cleanup — do not fail the delete if storage removal errors.
    const paths: string[] = [];
    if (existing.cover_url) paths.push(existing.cover_url);
    const media = (existing.media_urls ?? []) as Array<{ url?: string }>;
    for (const m of media) {
      if (m?.url) paths.push(m.url);
    }
    if (paths.length > 0) {
      await supabaseAdmin.storage.from("content-media").remove(paths).catch(() => {});
    }

    // Best-effort audit-log entry for the deletion.
    try {
      const { data: actor } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("user_id", context.userId)
        .maybeSingle();
      const actorEmail = context.claims?.email ?? actor?.display_name ?? null;
      await supabaseAdmin.from("content_moderation_audit").insert({
        content_item_id: null, // FK would SET NULL anyway; row is gone
        item_title: existing.title,
        item_kind: existing.kind,
        creator_id: existing.creator_id,
        action: "deleted",
        previous_status: existing.moderation_status,
        notes: null,
        actor_id: context.userId,
        actor_email: actorEmail,
      } as any);
    } catch (e) {
      console.warn("content_moderation_audit insert (delete) failed", e);
    }

    return { id: data.id, deleted: true };
  });

// ---------- Moderation audit log ----------

export type ModerationAuditEntry = {
  id: string;
  content_item_id: string | null;
  item_title: string;
  item_kind: string | null;
  action: "approved" | "rejected" | "pending" | "deleted";
  previous_status: string | null;
  notes: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
};

/**
 * List moderation audit entries. Admin-only. Optionally scope to a single
 * content item to render an inline history under that row.
 */
export const adminListModerationAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { contentItemId?: string; limit?: number } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<ModerationAuditEntry[]> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 500);
    let q = supabaseAdmin
      .from("content_moderation_audit")
      .select(
        "id, content_item_id, item_title, item_kind, action, previous_status, notes, actor_id, actor_email, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.contentItemId) q = q.eq("content_item_id", data.contentItemId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ModerationAuditEntry[];
  });

