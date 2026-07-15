import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, CheckCheck, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PendingRedemption = {
  id: string;
  reward_name: string;
  points_spent: number;
  created_at: string;
};

const SEEN_IDS_KEY = "admin:rewards-bell:seen-ids";

function readSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEEN_IDS_KEY, JSON.stringify([...ids]));
}

export function RewardRedemptionsBell() {
  const [items, setItems] = useState<PendingRedemption[]>([]);
  const [open, setOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => readSeenIds());

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
    const interval = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    const channel = supabase
      .channel("admin-reward-redemptions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_rewards" },
        () => {
          load();
        },
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  // Garbage-collect seen ids that no longer show up as pending, so localStorage
  // doesn't grow forever.
  useEffect(() => {
    if (items.length === 0) return;
    const pendingIds = new Set(items.map((i) => i.id));
    let changed = false;
    const next = new Set<string>();
    seenIds.forEach((id) => {
      if (pendingIds.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) {
      writeSeenIds(next);
      setSeenIds(next);
    }
  }, [items, seenIds]);

  const unseen = useMemo(
    () => items.filter((i) => !seenIds.has(i.id)).length,
    [items, seenIds],
  );

  const markOne = (id: string) => {
    const next = new Set(seenIds);
    next.add(id);
    writeSeenIds(next);
    setSeenIds(next);
  };

  const markAll = () => {
    const next = new Set(seenIds);
    items.forEach((i) => next.add(i.id));
    writeSeenIds(next);
    setSeenIds(next);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Reward redemptions${unseen ? `, ${unseen} unread` : ""}`}
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
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <span className="text-xs uppercase tracking-widest text-white/60">
              Pending redemptions
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={markAll}
                disabled={unseen === 0}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </button>
              <Link
                to="/admin/rewards"
                onClick={() => setOpen(false)}
                className="text-[10px] uppercase tracking-widest text-primary hover:underline"
              >
                Manage →
              </Link>
            </div>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-white/50">No pending redemptions.</li>
            )}
            {items.map((r) => {
              const isUnread = !seenIds.has(r.id);
              return (
                <li
                  key={r.id}
                  className={`flex items-start justify-between gap-2 border-b border-white/5 px-4 py-3 hover:bg-white/5 ${
                    isUnread ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isUnread && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                      )}
                      <div className="truncate text-sm font-semibold text-white">
                        {r.reward_name}
                      </div>
                    </div>
                    <div className="mt-0.5 text-xs text-white/60">
                      Cost: <span className="font-semibold text-white/80">{r.points_spent} pts</span>
                    </div>
                    <div
                      className="mt-1 text-[10px] uppercase tracking-widest text-white/40"
                      title={new Date(r.created_at).toLocaleString()}
                    >
                      Requested {formatRelativeTime(r.created_at)}
                    </div>
                  </div>
                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => markOne(r.id)}
                      aria-label={`Mark ${r.reward_name} as read`}
                      title="Mark as read"
                      className="mt-0.5 shrink-0 rounded-md border border-white/10 p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
