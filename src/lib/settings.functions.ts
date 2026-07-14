import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SiteSettings = {
  email: string;
  fetlife_handle: string;
  reddit_handle: string;
  glory_holes_enabled: boolean;
  session_price_cents: number;
  session_duration_minutes: number;
};

const DEFAULTS: SiteSettings = {
  email: "midnight-glory@princesspink90.com",
  fetlife_handle: "pink_princess90",
  reddit_handle: "19pink-princess90",
  glory_holes_enabled: true,
  session_price_cents: 27500,
  session_duration_minutes: 60,
};

export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettings> => {
    // Reads through supabaseAdmin because the site_settings SELECT policy
    // is restricted to authenticated users (host contact email is PII and
    // must not be exposed via the anon Data API). This server fn is the
    // sanctioned way to project the safe public contact info.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select(
        "email, fetlife_handle, reddit_handle, glory_holes_enabled, session_price_cents, session_duration_minutes",
      )
      .eq("id", "host")
      .maybeSingle();
    return data ?? DEFAULTS;
  },
);

/**
 * Public projection of the active session price and duration. Safe to expose
 * unauthenticated — pricing is public info displayed on the booking pages.
 */
export const getSessionPricing = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ price_cents: number; duration_minutes: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("session_price_cents, session_duration_minutes")
      .eq("id", "host")
      .maybeSingle();
    return {
      price_cents: data?.session_price_cents ?? DEFAULTS.session_price_cents,
      duration_minutes: data?.session_duration_minutes ?? DEFAULTS.session_duration_minutes,
    };
  },
);

/**
 * Public boolean-only projection of the Glory Holes toggle. Safe to expose
 * unauthenticated because it contains no PII — used by the public booking
 * page to hide itself when the admin has disabled it.
 */
export const getGloryHolesEnabled = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("glory_holes_enabled")
      .eq("id", "host")
      .maybeSingle();
    return { enabled: data?.glory_holes_enabled ?? true };
  },
);

// Shared session pricing bounds — enforced identically on client and server.
export const SESSION_PRICE_MIN_CENTS = 100; // A$1.00
export const SESSION_PRICE_MAX_CENTS = 10_000_00; // A$10,000.00
export const SESSION_DURATION_MIN_MINUTES = 5;
export const SESSION_DURATION_MAX_MINUTES = 480; // 8 hours

const updateSchema = z.object({
  email: z.string().trim().email().max(255),
  fetlife_handle: z.string().trim().min(1).max(100),
  reddit_handle: z.string().trim().min(1).max(100),
  glory_holes_enabled: z.boolean(),
  session_price_cents: z
    .number({ error: "Session price must be a number." })
    .int("Session price must be a whole number of cents.")
    .min(SESSION_PRICE_MIN_CENTS, {
      message: `Session price must be at least A$${(SESSION_PRICE_MIN_CENTS / 100).toFixed(2)}.`,
    })
    .max(SESSION_PRICE_MAX_CENTS, {
      message: `Session price must be at most A$${(SESSION_PRICE_MAX_CENTS / 100).toFixed(2)}.`,
    }),
  session_duration_minutes: z
    .number({ error: "Session duration must be a number." })
    .int("Session duration must be a whole number of minutes.")
    .min(SESSION_DURATION_MIN_MINUTES, {
      message: `Session duration must be at least ${SESSION_DURATION_MIN_MINUTES} minutes.`,
    })
    .max(SESSION_DURATION_MAX_MINUTES, {
      message: `Session duration must be at most ${SESSION_DURATION_MAX_MINUTES} minutes.`,
    }),
  });

export type PricingAuditEntry = {
  id: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
  old_session_price_cents: number | null;
  new_session_price_cents: number | null;
  old_session_duration_minutes: number | null;
  new_session_duration_minutes: number | null;
};

const auditQuerySchema = z.object({
  search: z.string().trim().max(255).optional().default(""),
  from: z.string().trim().max(40).optional().default(""),
  to: z.string().trim().max(40).optional().default(""),
  page: z.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(10),
});

export type PricingAuditQuery = z.input<typeof auditQuerySchema>;

export type PricingAuditPage = {
  rows: PricingAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

type AuditBuilder = {
  select: (cols: string, o: { count: "exact" }) => AuditBuilder;
  order: (col: string, o: { ascending: boolean }) => AuditBuilder;
  range: (from: number, to: number) => Promise<{ data: PricingAuditEntry[] | null; error: unknown; count: number | null }>;
  ilike: (col: string, pat: string) => AuditBuilder;
  gte: (col: string, val: string) => AuditBuilder;
  lte: (col: string, val: string) => AuditBuilder;
};

export const listPricingAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PricingAuditQuery) => auditQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PricingAuditPage> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const page = data.page;
    const pageSize = data.pageSize;
    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    let q = (supabaseAdmin as unknown as { from: (t: string) => AuditBuilder })
      .from("site_settings_pricing_audit")
      .select(
        "id, changed_at, changed_by, changed_by_email, old_session_price_cents, new_session_price_cents, old_session_duration_minutes, new_session_duration_minutes",
        { count: "exact" },
      )
      .order("changed_at", { ascending: false });

    if (data.search) {
      // Escape PostgREST ilike wildcards in user input.
      const safe = data.search.replace(/[%_,]/g, (m) => `\\${m}`);
      q = q.ilike("changed_by_email", `%${safe}%`);
    }
    if (data.from) {
      const fromDate = new Date(data.from);
      if (!isNaN(fromDate.getTime())) q = q.gte("changed_at", fromDate.toISOString());
    }
    if (data.to) {
      const toDate = new Date(data.to);
      if (!isNaN(toDate.getTime())) {
        // Treat as inclusive end-of-day when only a date is supplied.
        if (/^\d{4}-\d{2}-\d{2}$/.test(data.to)) {
          toDate.setUTCHours(23, 59, 59, 999);
        }
        q = q.lte("changed_at", toDate.toISOString());
      }
    }

    const { data: rows, error, count } = await q.range(fromIdx, toIdx);
    if (error) throw error as Error;
    return {
      rows: (rows ?? []) as PricingAuditEntry[],
      total: count ?? 0,
      page,
      pageSize,
    };
  });

export const updateSiteSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SiteSettings) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("site_settings")
      .update({
        email: data.email,
        fetlife_handle: data.fetlife_handle,
        reddit_handle: data.reddit_handle,
        glory_holes_enabled: data.glory_holes_enabled,
        session_price_cents: data.session_price_cents,
        session_duration_minutes: data.session_duration_minutes,
      })
      .eq("id", "host");
    if (error) throw error;
    return { ok: true };
  });

