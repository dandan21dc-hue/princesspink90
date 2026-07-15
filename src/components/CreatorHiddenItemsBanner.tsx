import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyContent } from "@/lib/store.functions";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

/**
 * Signed-in creators only: surface a storefront banner explaining why their
 * newly-added items aren't visible in the boutique (pending moderation,
 * rejected, or unpublished draft). Silently renders nothing for signed-out
 * shoppers and for creators with everything approved+published.
 */
export function CreatorHiddenItemsBanner() {
  const listFn = useServerFn(listMyContent);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const { data } = useQuery({
    queryKey: ["my-content", "storefront-banner"],
    queryFn: () => listFn(),
    enabled: signedIn === true,
    staleTime: 30_000,
    retry: false,
  });

  if (!data?.length) return null;

  let pending = 0;
  let rejected = 0;
  let unpublished = 0;
  for (const it of data as Array<{
    published: boolean | null;
    moderation_status?: string | null;
  }>) {
    const mod = it.moderation_status ?? "approved";
    if (mod === "pending") pending += 1;
    else if (mod === "rejected") rejected += 1;
    else if (!it.published) unpublished += 1;
  }
  const hiddenTotal = pending + rejected + unpublished;
  if (hiddenTotal === 0) return null;

  const parts: string[] = [];
  if (pending) parts.push(`${pending} awaiting moderation`);
  if (rejected) parts.push(`${rejected} rejected`);
  if (unpublished) parts.push(`${unpublished} unpublished draft${unpublished === 1 ? "" : "s"}`);

  return (
    <div
      role="status"
      className="mt-6 flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <div className="font-semibold text-amber-200">
            {hiddenTotal} of your item{hiddenTotal === 1 ? " isn't" : "s aren't"} live in the boutique
          </div>
          <p className="mt-1 text-xs text-amber-100/90">
            {parts.join(" · ")}.{" "}
            {pending > 0 && "Pending items appear once an admin approves them. "}
            {rejected > 0 && "Rejected items need edits before they can be resubmitted. "}
            {unpublished > 0 && "Draft items become visible after you toggle Publish."}
          </p>
        </div>
      </div>
      <Link
        to="/content"
        className="shrink-0 self-start rounded-md border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-100 hover:bg-amber-500/30 sm:self-auto"
      >
        Fix in manage content →
      </Link>
    </div>
  );
}
