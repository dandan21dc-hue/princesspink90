import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listSecurityChangelog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("security_changelog")
      .select("id, version, title, summary, published_at, created_at, updated_at")
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(20000),
  published_at: z.string().datetime().optional(),
});

export const upsertSecurityChangelogEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const row = {
      version: data.version,
      title: data.title,
      summary: data.summary,
      published_at: data.published_at ?? new Date().toISOString(),
      created_by: context.userId,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("security_changelog")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: inserted, error } = await context.supabase
      .from("security_changelog")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const deleteSecurityChangelogEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("security_changelog")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
