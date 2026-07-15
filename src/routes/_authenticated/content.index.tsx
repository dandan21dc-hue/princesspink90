import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listMyContent, deleteContentItem } from "@/lib/store.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/content/")({
  head: () => ({ meta: [{ title: "My content — Midnight Glory" }] }),
  component: ContentAdminPage,
});

function ContentAdminPage() {
  const listFn = useServerFn(listMyContent);
  const deleteFn = useServerFn(deleteContentItem);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["my-content"], queryFn: () => listFn() });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["my-content"] });
      qc.invalidateQueries({ queryKey: ["store-items"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <section className="mx-auto max-w-4xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Manage</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Your content</h1>
        </div>
        <Link
          to="/content/new"
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)]"
        >
          + New item
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
      ) : !data?.length ? (
        <div className="mt-8 rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No content yet. <Link to="/content/new" className="underline">Add your first item.</Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {data.map((it) => {
            const mod = (it as { moderation_status?: string | null }).moderation_status ?? null;
            const notes = (it as { moderation_notes?: string | null }).moderation_notes ?? null;
            const badge =
              mod === "pending"
                ? {
                    label: "Pending moderation",
                    cls: "border-amber-500/40 bg-amber-500/10 text-amber-300",
                    reason: "Waiting on admin review — hidden from the store until approved.",
                  }
                : mod === "rejected"
                ? {
                    label: "Rejected",
                    cls: "border-red-500/40 bg-red-500/10 text-red-300",
                    reason: notes?.trim() || "Rejected by admin — not visible in the store.",
                  }
                : null;
            return (
              <li key={it.id} className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-card p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{it.title}</div>
                    {badge && (
                      <span
                        title={badge.reason}
                        aria-label={`${badge.label}: ${badge.reason}`}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {it.kind} · {it.price_cents ? `$${(it.price_cents / 100).toFixed(2)}` : "—"}
                    {it.subscribers_only && " · Subs only"}
                    {!it.published && " · Draft"}
                  </div>
                  {badge && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">Why it's not showing: </span>
                      {badge.reason}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (confirm("Delete this item permanently?")) del.mutate(it.id);
                  }}
                  className="shrink-0 text-xs uppercase tracking-widest text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
