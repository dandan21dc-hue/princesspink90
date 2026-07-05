/**
 * RLS + Storage isolation test for health_screenings.
 *
 * Verifies that:
 *   1. A signed-in user can SELECT their own health_screenings row.
 *   2. A different signed-in user CANNOT SELECT that row (RLS filters it out).
 *   3. A different signed-in user CANNOT download the underlying storage
 *      object under the owner's `{user_id}/...` folder.
 *   4. The owner CAN download their own file.
 *
 * Requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (service role is used only
 * to create/clean up the two throwaway auth users). The whole suite is
 * skipped when the service role key is absent, so it doesn't fail in
 * environments where privileged secrets aren't exposed (CI without secrets,
 * default dev sandbox, etc.).
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=... bunx vitest run src/lib/healthScreeningsRls.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const PUBLISHABLE =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HAS_ENV = Boolean(URL && PUBLISHABLE && SERVICE_ROLE);

const BUCKET = "health-screenings";

function userClient(): SupabaseClient {
  return createClient(URL!, PUBLISHABLE!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

function adminClient(): SupabaseClient {
  return createClient(URL!, SERVICE_ROLE!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

describe.skipIf(!HAS_ENV)("health_screenings RLS + bucket isolation", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  const created: { userId: string; email: string; screeningId?: string; filePath?: string }[] = [];

  async function createUser(label: string) {
    const email = `rls-${label}-${crypto.randomUUID()}@example.test`;
    const password = `Test-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("createUser failed");
    const entry = { userId: data.user.id, email, password } as const;
    created.push({ userId: entry.userId, email });
    return { ...entry, client: userClient() };
  }

  async function signIn(client: SupabaseClient, email: string, password: string) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;
    // Sanity check — bucket must exist and be private.
    const { data: bucket, error } = await admin.storage.getBucket(BUCKET);
    if (error) throw new Error(`Bucket '${BUCKET}' not reachable: ${error.message}`);
    expect(bucket?.public, `${BUCKET} must NOT be public`).toBe(false);
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    // Clean up screenings, files, and users we created.
    for (const c of created) {
      if (c.filePath) {
        await admin.storage.from(BUCKET).remove([c.filePath]).catch(() => {});
      }
      if (c.screeningId) {
        await admin.from("health_screenings").delete().eq("id", c.screeningId).catch(() => {});
      }
      await admin.auth.admin.deleteUser(c.userId).catch(() => {});
    }
  }, 30_000);

  it("isolates health_screenings rows between users and blocks cross-user file downloads", async () => {
    const owner = await createUser("owner");
    const intruder = await createUser("intruder");

    await signIn(owner.client, owner.email, owner.password);
    await signIn(intruder.client, intruder.email, intruder.password);

    // --- Owner uploads a file at `{owner.userId}/test.txt` and inserts a row ---
    const filePath = `${owner.userId}/${crypto.randomUUID()}.txt`;
    const payload = new Blob([`hello ${owner.userId}`], { type: "text/plain" });

    const upload = await owner.client.storage.from(BUCKET).upload(filePath, payload, {
      contentType: "text/plain",
      upsert: false,
    });
    expect(upload.error, `owner upload failed: ${upload.error?.message}`).toBeNull();
    created.find((c) => c.userId === owner.userId)!.filePath = filePath;

    const insert = await owner.client
      .from("health_screenings")
      .insert({
        user_id: owner.userId,
        file_path: filePath,
        test_date: new Date().toISOString().slice(0, 10),
        status: "pending",
      })
      .select("id")
      .single();
    expect(insert.error, `owner insert failed: ${insert.error?.message}`).toBeNull();
    const screeningId = insert.data!.id as string;
    created.find((c) => c.userId === owner.userId)!.screeningId = screeningId;

    // --- 1. Owner can read their own row ---
    const ownerRead = await owner.client
      .from("health_screenings")
      .select("id, user_id, file_path")
      .eq("id", screeningId);
    expect(ownerRead.error).toBeNull();
    expect(ownerRead.data).toHaveLength(1);
    expect(ownerRead.data![0].user_id).toBe(owner.userId);

    // --- 2. Intruder CANNOT read owner's row (RLS filters it out) ---
    const intruderRead = await intruder.client
      .from("health_screenings")
      .select("id, user_id, file_path")
      .eq("id", screeningId);
    // RLS returns empty results rather than an error for filtered rows.
    expect(intruderRead.error).toBeNull();
    expect(intruderRead.data ?? []).toHaveLength(0);

    // --- 2b. Intruder cannot see the row via a broad list either ---
    const intruderList = await intruder.client
      .from("health_screenings")
      .select("id")
      .eq("user_id", owner.userId);
    expect(intruderList.data ?? []).toHaveLength(0);

    // --- 3. Intruder CANNOT download the owner's storage object ---
    const intruderDownload = await intruder.client.storage.from(BUCKET).download(filePath);
    // Storage RLS returns an error (or empty body) rather than the file.
    const gotFile = intruderDownload.data != null && (await intruderDownload.data.text()).length > 0;
    expect(
      !gotFile,
      "intruder was able to download owner's health screening file — bucket RLS is broken",
    ).toBe(true);

    // --- 3b. Intruder cannot list the owner's folder ---
    const intruderListDir = await intruder.client.storage.from(BUCKET).list(owner.userId);
    expect((intruderListDir.data ?? []).length).toBe(0);

    // --- 4. Owner CAN download their own file ---
    const ownerDownload = await owner.client.storage.from(BUCKET).download(filePath);
    expect(ownerDownload.error, `owner download failed: ${ownerDownload.error?.message}`).toBeNull();
    expect(await ownerDownload.data!.text()).toContain(owner.userId);

    // --- 5. Intruder cannot INSERT a screening pretending to be the owner ---
    const spoof = await intruder.client
      .from("health_screenings")
      .insert({
        user_id: owner.userId,
        file_path: filePath,
        test_date: new Date().toISOString().slice(0, 10),
        status: "pending",
      })
      .select("id");
    expect(spoof.error, "intruder was able to insert a row for another user").not.toBeNull();
  }, 60_000);
});
