import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Veriff decision webhook.
 * Veriff signs the raw request body with HMAC-SHA256 using the shared API
 * secret and sends the hex digest in the `x-hmac-signature` header.
 *
 * Decision payload shape (v1):
 *   { verification: { id, status, vendorData, ... } }
 *   status ∈ approved | declined | resubmission_requested | expired | abandoned
 */
export const Route = createFileRoute("/api/public/hooks/veriff-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.VERIFF_API_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const signature = (request.headers.get("x-hmac-signature") ?? "").toLowerCase();
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");

        const sigBuf = Buffer.from(signature, "utf8");
        const expBuf = Buffer.from(expected, "utf8");
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          verification?: { id?: string; status?: string; vendorData?: string };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const v = payload.verification ?? {};
        const veriffStatus = (v.status ?? "").toLowerCase();
        const sessionId = v.id ?? null;
        const userId = v.vendorData ?? null;
        if (!sessionId && !userId) return new Response("ok"); // event we don't care about

        const nextStatus: "approved" | "declined" | "pending" =
          veriffStatus === "approved"
            ? "approved"
            : veriffStatus === "declined" ||
                veriffStatus === "expired" ||
                veriffStatus === "abandoned"
              ? "declined"
              : "pending"; // resubmission_requested & anything else → stay pending

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Prefer matching by session id; fall back to vendorData (user id).
        let query = supabaseAdmin.from("profiles").update({ verification_status: nextStatus });
        if (sessionId) {
          query = query.eq("veriff_session_id", sessionId);
        } else if (userId) {
          query = query.eq("user_id", userId);
        }
        const { error } = await query;
        if (error) {
          console.error("Veriff webhook update failed", error);
          return new Response("DB error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
