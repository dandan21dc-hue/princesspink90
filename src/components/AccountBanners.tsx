import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "@/hooks/useSubscription";

/**
 * App-wide banners for account-level states the user should always see —
 * failed payment (dunning) and pending account deletion.
 *
 * Rendered from `__root.tsx` so it appears on every page after sign-in.
 */
export function AccountBanners() {
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingDeletionAt, setPendingDeletionAt] = useState<string | null>(null);
  const { isPastDue } = useSubscription(userId);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setPendingDeletionAt(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("pending_deletion_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPendingDeletionAt((data as any)?.pending_deletion_at ?? null);
      });
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return null;

  return (
    <>
      {isPastDue && (
        <div className="bg-red-600/95 text-white text-sm">
          <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-4">
            <span>Your last renewal payment failed. Update your card to keep your access.</span>
            <Link
              to="/account/billing"
              className="rounded bg-white text-red-700 px-3 py-1 font-semibold hover:bg-red-50"
            >
              Update card
            </Link>
          </div>
        </div>
      )}
      {pendingDeletionAt && (
        <div className="bg-amber-600/95 text-white text-sm">
          <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-4">
            <span>
              Your account is scheduled for deletion on{" "}
              {new Date(pendingDeletionAt).toLocaleDateString()}.
            </span>
            <Link
              to="/account"
              className="rounded bg-white text-amber-700 px-3 py-1 font-semibold hover:bg-amber-50"
            >
              Undo
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
