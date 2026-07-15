import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The `supabase.auth.oauth` namespace is beta and not always visible in the
// generated types — declare a narrow local shape so this route type-checks
// without grepping node_modules or hand-rolling raw /oauth/authorizations calls.
type AuthorizationDetails = {
  client?: { name?: string | null; client_uri?: string | null } | null;
  redirect_uri?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
};
type OAuthAuth = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthAuth }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase client reads its session from localStorage
  // (absent during SSR). Without ssr:false, getSession() returns null on the
  // server and bounces signed-in users to the login page.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) {
      throw new Error("Missing authorization_id");
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // Preserve the full consent URL as a same-origin relative path so the
      // user comes back with the same authorization_id after signing in.
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    // Already-approved client — provider resolved immediately, bounce to it.
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-lg px-5 py-16">
      <h1 className="font-display text-2xl font-bold">Authorization unavailable</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn't load this authorization request. It may have expired.
      </p>
      <pre className="mt-6 overflow-auto rounded bg-muted p-3 text-xs">
        {(error as Error)?.message ?? String(error)}
      </pre>
    </div>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "an external app";
  const scopes = (details?.scope ?? "").split(/\s+/).filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Authorize</div>
      <h1 className="mt-2 font-display text-3xl font-extrabold">
        Connect {clientName} to your account
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This lets {clientName} use Princess Pink as you. It can read the events,
        RSVPs, and memberships you can already see in the app — nothing more.
        Your app permissions and backend policies still decide what's accessible.
      </p>

      {scopes.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {scopes.map((s: string) => (
            <li key={s} className="text-muted-foreground">
              Requested permission: <code className="rounded bg-muted px-1">{s}</code>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          className="inline-flex items-center rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          className="inline-flex items-center rounded-md border border-border px-5 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          Cancel connection
        </button>
      </div>
    </div>
  );
}
