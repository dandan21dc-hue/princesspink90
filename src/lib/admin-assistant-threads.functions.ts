import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";


/**
 * Server functions for Admin Command Center thread persistence.
 * All access is admin-gated + owner-scoped via RLS on
 * admin_assistant_threads / admin_assistant_messages.
 */

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type AdminThread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

// -------- list --------
export const listAdminThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminThread[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("admin_assistant_threads")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminThread[];
  });

// -------- create --------
export const createAdminThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ title: z.string().trim().max(120).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<AdminThread> => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("admin_assistant_threads")
      .insert({
        admin_id: context.userId,
        title: data.title?.trim() || "New conversation",
      })
      .select("id, title, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as AdminThread;
  });

// -------- rename --------
export const renameAdminThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("admin_assistant_threads")
      .update({ title: data.title, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// -------- delete --------
export const deleteAdminThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("admin_assistant_threads")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// -------- load messages --------
type StoredMessageRow = {
  client_id: string;
  role: "user" | "assistant" | "system";
  parts: unknown;
  created_at: string;
};

type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Json[];
};

export const getAdminThreadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ threadId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<StoredMessage[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data: thread, error: tErr } = await context.supabase
      .from("admin_assistant_threads")
      .select("id")
      .eq("id", data.threadId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!thread) throw new Error("Thread not found");

    const { data: rows, error } = await context.supabase
      .from("admin_assistant_messages")
      .select("client_id, role, parts, created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return ((rows ?? []) as StoredMessageRow[]).map((r) => ({
      id: r.client_id,
      role: r.role,
      parts: Array.isArray(r.parts) ? (r.parts as Json[]) : [],
    }));
  });
