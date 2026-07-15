import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gift, Sparkles } from "lucide-react";
import {
  listActiveRewards,
  redeemReward,
  listMyRedemptions,
} from "@/lib/rewards-catalog.functions";
import { getMyRewards } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/rewards")({
  head: () => ({ meta: [{ title: "Rewards Gallery · AFTERDARK" }] }),
  component: RewardsGalleryPage,
});

function RewardsGalleryPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listActiveRewards);
  const balanceFn = useServerFn(getMyRewards);
  const historyFn = useServerFn(listMyRedemptions);
  const redeemFn = useServerFn(redeemReward);

  const rewards = useQuery({ queryKey: ["rewards-gallery"], queryFn: () => listFn() });
  const balance = useQuery({ queryKey: ["my-rewards"], queryFn: () => balanceFn() });
  const history = useQuery({ queryKey: ["my-redemptions"], queryFn: () => historyFn() });

  const redeem = useMutation({
    mutationFn: (rewardId: string) => redeemFn({ data: { rewardId } }),
    onSuccess: (r) => {
      toast.success(`Redeemed "${r.reward_name}" — we'll fulfil it soon.`);
      qc.invalidateQueries({ queryKey: ["my-rewards"] });
      qc.invalidateQueries({ queryKey: ["my-redemptions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const points = balance.data?.reward_points ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Loyalty</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Rewards Gallery</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Redeem your reward points for perks below. Redemptions are marked
            pending until an admin fulfils them.
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card px-5 py-3 text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Your balance
          </div>
          <div className="mt-1 font-display text-2xl font-semibold text-neon tabular-nums">
            {balance.isLoading ? "…" : points.toLocaleString()}{" "}
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
        </div>
      </header>

      {rewards.isLoading ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading rewards…</p>
      ) : (rewards.data ?? []).length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No rewards are available right now. Check back soon.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.data!.map((r) => {
            const canAfford = points >= r.points_cost;
            const busy = redeem.isPending && redeem.variables === r.id;
            return (
              <li
                key={r.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card"
              >
                {r.image_url ? (
                  <img
                    src={r.image_url}
                    alt=""
                    className="h-40 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-muted/40">
                    <Gift className="h-10 w-10 text-primary/60" aria-hidden />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="font-display text-lg font-semibold">{r.name}</h2>
                  {r.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                    <span className="font-semibold tabular-nums">
                      {r.points_cost.toLocaleString()} pts
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!canAfford || busy}
                    onClick={() => redeem.mutate(r.id)}
                    className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
                  >
                    {busy
                      ? "Redeeming…"
                      : canAfford
                        ? "Redeem"
                        : `Need ${(r.points_cost - points).toLocaleString()} more pts`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold">Your redemptions</h2>
        {history.isLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No redemptions yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
            {history.data!.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div>
                  <div className="font-medium">{r.reward_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} ·{" "}
                    {r.points_spent.toLocaleString()} pts
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                    r.status === "fulfilled"
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : r.status === "cancelled"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
