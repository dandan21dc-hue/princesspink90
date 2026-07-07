// Project-specific bearer attacher for TanStack server functions.
//
// Replaces the auto-generated `attachSupabaseAuth`. Same job — attach the
// Supabase access token as `Authorization: Bearer …` — but only when the
// stored session actually has a JWT-shaped access token.
//
// The auto-generated auth-middleware.ts rejects any bearer that isn't
// three dot-separated segments with `Error: Unauthorized: Invalid token`
// (auth-middleware.ts:71). If a stale session, a rotated signing key, or
// a Supabase opaque-token rollout leaves the client holding a non-JWT
// access token, sending it guarantees a server throw for every protected
// server-fn call — even ones the UI wraps in try/catch, because the global
// runtime-error listener still logs the rejection.
//
// Attaching only well-formed JWTs converts that hard failure into the
// same shape as "no session at all": the server middleware throws
// `No authorization header provided`, callers treat it as signed-out, and
// the UI's normal sign-in flow handles it.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

function isJwtShaped(token: string | undefined): token is string {
  return !!token && token.split(".").length === 3;
}

export const attachSupabaseBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: isJwtShaped(token) ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
