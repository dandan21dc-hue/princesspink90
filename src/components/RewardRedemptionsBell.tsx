import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PendingRedemption = {
  id: string;
  reward_name: string;
  points_spent: number;
  created_at: string;
};

const SEEN_KEY = "admin:rewards-bell:last-seen";

export function RewardRedemptionsBell() {
  const [items, setItems] = useState<PendingRedemption[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>(() => {
    if (typeof window === "undefined") return "1970-01-01T00:00:00Z";
    return window.localStorage.getItem(SEEN_KEY) ?? "1970-01-01T00:00:00Z";
  });

  const load = async () => {
    const { data } = await supabase
      .from("user_rewards")
      .select("id, reward_name, points_spent, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as PendingRedemption[]);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const unseen = useMemo(
    () => items.filter((i) => i.created_at > lastSeen).length,
    [items, lastSeen],
  );

  const markSeen = () => {
    const now = new Date().toISOString();
    window.localStorage.setItem(SEEN_KEY, now);
    setLastSeen(now);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markSeen();
        }}
        aria-label={`Reward redemptions${unseen ? `, ${unseen} new` : ""}`}
        className="relative rounded-md border border-white/10 bg-white/5 p-2.5 text-white/80 hover:bg-white/10"
      >
        <Gift className="h-4 w-4" />
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unseen}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Reward redemptions"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-white/10 bg-black/95 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-xs uppercase tracking-widest text-white/60">
              Pending redemptions
            </span>
            <Link
              to="/admin/rewards"
              onClick={() => setOpen(false)}
              className="text-[10px] uppercase tracking-widest text-primary hover:underline"
            >
              Manage →
            </Link>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-white/50">No pending redemptions.</li>
            )}
            {items.map((r) => (
              <li key={r.id} className="border-b border-white/5 px-4 py-3 hover:bg-white/5">
                <div className="text-sm font-semibold text-white">{r.reward_name}</div>
                <div className="mt-0.5 text-xs text-white/60">{r.points_spent} pts</div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
