import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VeriffStatus = "unverified" | "pending" | "approved" | "declined";

export type MyVeriffState = {
  status: VeriffStatus;
  session_id: string | null;
  consents_to_recording: boolean;
};

/** Read current user's verification status + consent flag from profiles. */
export const getMyVeriffStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyVeriffState> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("verification_status, veriff_session_id, consents_to_recording")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      status: (data?.verification_status ?? "unverified") as VeriffStatus,
      session_id: data?.veriff_session_id ?? null,
      consents_to_recording: !!data?.consents_to_recording,
    };
  });

/**
 * Create a Veriff session for the current user.
 * - Saves session id + consent flag on profiles
 * - Sets verification_status = 'pending'
 * - If consent = true → session includes selfie/face-match step
 * - If consent = false → document-only session
 */
export const createVeriffSession = createServerFn({ method: "POST" })
  .inputValidator((input: { consents_to_recording: boolean; first_name?: string; last_name?: string }) =>
    z
      .object({
        consents_to_recording: z.boolean(),
        first_name: z.string().trim().max(80).optional(),
        last_name: z.string().trim().max(80).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const baseUrl = (process.env.VERIFF_BASE_URL || "https://stationapi.veriff.com").replace(/\/$/, "");
    const apiKey = process.env.VERIFF_API_KEY;
    const apiSecret = process.env.VERIFF_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error("Veriff is not configured.");

    // Build verification payload. `features: ["selfie"]` enables face-match;
    // omitting it yields a document-only flow.
    const verification: Record<string, unknown> = {
      vendorData: context.userId,
      ...(data.first_name || data.last_name
        ? { person: { firstName: data.first_name ?? "", lastName: data.last_name ?? "" } }
        : {}),
    };
    if (data.consents_to_recording) {
      verification.features = ["selfie"];
    }

    const body = JSON.stringify({ verification });

    // Sign the raw body with HMAC-SHA256 using the shared secret.
    const { createHmac } = await import("crypto");
    const signature = createHmac("sha256", apiSecret).update(body).digest("hex");

    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": apiKey,
        "X-HMAC-SIGNATURE": signature,
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      verification?: { id?: string; url?: string; sessionToken?: string };
    };
    if (!res.ok || !json.verification?.url || !json.verification?.id) {
      console.error("Veriff session create failed", res.status, json);
      throw new Error("Could not start verification. Please try again.");
    }

    // Persist session id + consent, mark pending.
    const { error: upErr } = await context.supabase
      .from("profiles")
      .update({
        veriff_session_id: json.verification.id,
        consents_to_recording: data.consents_to_recording,
        verification_status: "pending",
      })
      .eq("user_id", context.userId);
    if (upErr) throw new Error(upErr.message);

    return { url: json.verification.url, session_id: json.verification.id };
  });
