import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Gift, Activity, Users } from "lucide-react";
import { getMyRewards, getMyRewardActivity, getMyReferralHistory } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/account/rewards")({
  head: () => ({ meta: [{ title: "Rewards · AFTERDARK" }] }),
  component: RewardsTab,
});

function RewardsTab() {
  const fetchRewards = useServerFn(getMyRewards);
  const fetchActivity = useServerFn(getMyRewardActivity);
  const rewards = useQuery({
    queryKey: ["my-rewards"],
    queryFn: () => fetchRewards(),
  });
  const activity = useQuery({
    queryKey: ["my-reward-activity"],
    queryFn: () => fetchActivity(),
  });
  const fetchReferralHistory = useServerFn(getMyReferralHistory);
  const referralHistory = useQuery({
    queryKey: ["my-referral-history"],
    queryFn: () => fetchReferralHistory(),
  });

  const code = rewards.data?.referral_code ?? "";
  const points = rewards.data?.reward_points ?? 0;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = code ? `${origin}/auth?ref=${encodeURIComponent(code)}` : "";

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Rewards</div>
        <h1 className="mt-2 font-display text-3xl">Brand ambassador</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Friends who sign up with your code earn you 50 points.
        </p>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-[var(--shadow-panel)]">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <Gift className="h-4 w-4 text-primary" /> Current balance
        </div>
        <div className="mt-2 font-display text-5xl font-semibold text-neon">
          {rewards.isLoading ? "…" : points.toLocaleString()}
          <span className="ml-2 text-base text-muted-foreground">points</span>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-6">
        <h2 className="font-display text-lg">Your referral code</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your code or link. Every friend who signs up with it adds 50 points to your balance.
        </p>

        <div className="mt-4 space-y-3">
          <CopyRow
            label="Referral code"
            value={code}
            placeholder={rewards.isLoading ? "Loading…" : "—"}
            mono
          />
          <CopyRow
            label="Referral link"
            value={referralLink}
            placeholder={rewards.isLoading ? "Loading…" : "—"}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Activity className="h-4 w-4 text-primary" /> Activity
        </div>
        <h2 className="mt-2 font-display text-lg">Point history</h2>

        <div className="mt-4">
          {activity.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading activity…</div>
          ) : activity.data && activity.data.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {activity.data.map((item) => {
                const positive = item.delta > 0;
                return (
                  <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{item.reason}</div>
                      {item.detail ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                      ) : null}
                      {item.referral_code ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] tracking-widest">
                          {item.referral_code}
                        </div>
                      ) : null}
                      <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                        {item.status ? ` · ${item.status}` : ""}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 font-mono text-sm ${positive ? "text-neon" : "text-muted-foreground"}`}
                    >
                      {positive ? "+" : ""}
                      {item.delta.toLocaleString()} pts
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">
              No point activity yet. Share your referral code to earn your first points.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CopyRow({
  label,
  value,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = value.length > 0;

  async function copy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — try selecting it manually.");
    }
  }

  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-stretch gap-2">
        <div
          className={`min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm ${mono ? "font-mono tracking-widest" : ""}`}
        >
          {value || placeholder}
        </div>
        <button
          type="button"
          onClick={copy}
          disabled={!canCopy}
          aria-label={`Copy ${label}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs uppercase tracking-widest hover:bg-secondary/40 disabled:opacity-40"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
