/**
 * Shared authentication helper for `/api/public/hooks/*` cron endpoints.
 *
 * Requires an `Authorization: Bearer <HOOKS_CRON_SECRET>` header (also
 * accepted via the legacy `apikey` header for backward compatibility with
 * pg_cron jobs configured before rotation).
 *
 * The prior implementation compared against `SUPABASE_PUBLISHABLE_KEY`,
 * which is intentionally embedded in the client bundle — any visitor
 * could invoke these hooks. HOOKS_CRON_SECRET is a server-only random
 * secret stored in Supabase secrets / Vault.
 */
export function checkHooksCronAuth(request: Request): Response | null {
  const expected = process.env.HOOKS_CRON_SECRET;
  if (!expected) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const apikey = request.headers.get("apikey") ?? "";
  const provided = bearer || apikey;
  if (!provided || !timingSafeEqual(provided, expected)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
