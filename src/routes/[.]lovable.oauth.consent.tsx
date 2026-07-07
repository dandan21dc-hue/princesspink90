import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Typed wrapper around the beta `supabase.auth.oauth` namespace.
type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };
type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
function oauth(): OAuthNs {
  return (supabase.auth as unknown as { oauth: OAuthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-5 py-16 text-sm text-muted-foreground">
      <h1 className="font-display text-2xl font-bold text-foreground">
        Authorization unavailable
      </h1>
      <p className="mt-3">
        We couldn't load this authorization request:{" "}
        <span className="text-foreground">
          {String((error as Error)?.message ?? error)}
        </span>
      </p>
      <p className="mt-3">Return to the app you were connecting from and try again.</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
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

  const clientName = details?.client?.name ?? "an app";
  const redirectUri = details?.client?.redirect_uri;
  const scopes = (details?.scope ?? "").split(/\s+/).filter(Boolean);

  return (
    <main className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-2xl border border-primary/30 bg-card/60 p-8">
        <div className="text-xs uppercase tracking-[0.3em] text-neon">Authorize access</div>
        <h1 className="mt-2 font-display text-2xl font-bold">
          Connect <span className="text-neon">{clientName}</span> to Princess Pink
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          This lets {clientName} use Princess Pink's tools while signed in as you.
          It does not bypass Princess Pink's permissions or backend policies.
        </p>

        {redirectUri && (
          <p className="mt-3 text-xs text-muted-foreground">
            Callback: <code className="text-foreground">{redirectUri}</code>
          </p>
        )}

        {scopes.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {scopes.map((s) => (
              <li key={s} className="text-muted-foreground">
                • {s === "openid" || s === "profile"
                  ? "Share your basic profile"
                  : s === "email"
                    ? "Share your email address"
                    : `Additional permission: ${s}`}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Working…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            Cancel connection
          </button>
        </div>
      </div>
    </main>
  );
}
