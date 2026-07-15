import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  adminListRewards,
  adminUpsertReward,
  adminDeleteReward,
  adminToggleRewardActive,
  adminListPendingRedemptions,
  adminFulfillRedemption,
  getAdminRewardAlertPrefs,
  updateAdminRewardAlertPrefs,
} from "@/lib/rewards-catalog.functions";

export const Route = createFileRoute("/_authenticated/admin/rewards")({
  head: () => ({ meta: [{ title: "Rewards Manager · Admin" }] }),
  component: AdminRewardsPage,
});

type Reward = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  points_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function AdminRewardsPage() {
  const meFn = useServerFn(amIAdmin);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });

  if (me.isLoading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Rewards Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create rewards members can redeem with their points, and fulfil
            pending redemptions.
          </p>
        </div>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>

      <CatalogSection />
      <AdminAlertPrefsSection />
      <PendingRedemptionsSection />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-5 py-10 space-y-10">{children}</main>;
}

// ---------------- Catalog ----------------

function CatalogSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewards);
  const upsertFn = useServerFn(adminUpsertReward);
  const deleteFn = useServerFn(adminDeleteReward);
  const toggleFn = useServerFn(adminToggleRewardActive);

  const rewards = useQuery({ queryKey: ["admin-rewards"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<Reward | null>(null);
  const [showForm, setShowForm] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Reward deleted");
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) =>
      toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-rewards"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const upsert = useMutation({
    mutationFn: (v: {
      id?: string;
      name: string;
      description?: string;
      image_url?: string;
      points_cost: number;
      is_active?: boolean;
    }) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success("Reward saved");
      setShowForm(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (rewards.data ?? []) as Reward[];

  return (
    <section className="rounded-2xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Rewards Catalog</h2>
        <button
          type="button"
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
        >
          + Add new reward
        </button>
      </div>

      {showForm && (
        <div className="border-b border-border/60 p-5">
          <RewardForm
            initial={editing}
            saving={upsert.isPending}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            onSubmit={(vals) => upsert.mutate(vals)}
          />
        </div>
      )}

      {rewards.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No rewards yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right">Points</th>
                <th className="px-4 py-2 text-center">Active</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.points_cost.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => toggle.mutate({ id: r.id, isActive: e.target.checked })}
                        className="h-4 w-4 accent-primary"
                        aria-label={`Toggle ${r.name} active`}
                      />
                      <span className="text-xs text-muted-foreground">
                        {r.is_active ? "On" : "Off"}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => { setEditing(r); setShowForm(true); }}
                      className="rounded-md border border-border px-3 py-1 text-xs font-semibold uppercase tracking-widest hover:bg-muted"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${r.name}"?`)) del.mutate(r.id);
                      }}
                      className="rounded-md border border-destructive/50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RewardForm({
  initial,
  saving,
  onCancel,
  onSubmit,
}: {
  initial: Reward | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (v: {
    id?: string;
    name: string;
    description?: string;
    image_url?: string;
    points_cost: number;
    is_active?: boolean;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [pointsCost, setPointsCost] = useState<string>(
    initial ? String(initial.points_cost) : "100",
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const cost = Math.floor(Number(pointsCost));
        if (!name.trim() || !Number.isFinite(cost) || cost <= 0) {
          toast.error("Name and a positive points cost are required.");
          return;
        }
        onSubmit({
          id: initial?.id,
          name: name.trim(),
          description: description.trim() || undefined,
          image_url: imageUrl.trim() || undefined,
          points_cost: cost,
          is_active: isActive,
        });
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="text-sm sm:col-span-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2"
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Description</span>
        <textarea
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Image URL (optional)</span>
        <input
          value={imageUrl ?? ""}
          onChange={(e) => setImageUrl(e.target.value)}
          type="url"
          placeholder="https://…"
          className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Points cost</span>
        <input
          value={pointsCost}
          onChange={(e) => setPointsCost(e.target.value)}
          type="number"
          min={1}
          step={1}
          required
          className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 tabular-nums"
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span>Active — visible in the members' Rewards Gallery</span>
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create reward"}
        </button>
      </div>
    </form>
  );
}

// ---------------- Pending Redemptions ----------------

function PendingRedemptionsSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPendingRedemptions);
  const fulfillFn = useServerFn(adminFulfillRedemption);

  const pending = useQuery({
    queryKey: ["admin-pending-redemptions"],
    queryFn: () => listFn(),
  });

  const fulfill = useMutation({
    mutationFn: (id: string) => fulfillFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Marked as fulfilled");
      qc.invalidateQueries({ queryKey: ["admin-pending-redemptions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (pending.data ?? []) as Array<{
    id: string;
    user_id: string;
    reward_id: string;
    reward_name: string;
    points_spent: number;
    status: string;
    created_at: string;
    user?: { email?: string; display_name?: string };
  }>;

  return (
    <section className="rounded-2xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Pending Redemptions</h2>
        <span className="text-xs text-muted-foreground">{rows.length} pending</span>
      </div>
      {pending.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No pending redemptions. All caught up.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Requested</th>
                <th className="px-4 py-2 text-left">Member</th>
                <th className="px-4 py-2 text-left">Reward</th>
                <th className="px-4 py-2 text-right">Points</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.user?.display_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.user?.email ?? r.user_id}</div>
                  </td>
                  <td className="px-4 py-3">{r.reward_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.points_spent.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => fulfill.mutate(r.id)}
                      disabled={fulfill.isPending}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
                    >
                      Mark as fulfilled
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
