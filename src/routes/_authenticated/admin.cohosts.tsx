import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  adminListCohostApplications,
  adminListCohostApplicationReviews,
  adminReviewCohostApplication,
} from "@/lib/cohost.functions";


export const Route = createFileRoute("/_authenticated/admin/cohosts")({
  head: () => ({ meta: [{ title: "Co-host applications · Admin" }] }),
  component: AdminCohosts,
});

function AdminCohosts() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(adminListCohostApplications);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const q = useQuery({
    queryKey: ["admin-cohost-applications"],
    queryFn: () => listFn(),
    enabled: me.data?.isAdmin === true,
  });

  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          No admin access. <Link to="/dashboard" className="text-primary underline">Back</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {q.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !q.data?.length ? (
        <p className="text-muted-foreground">No applications yet.</p>
      ) : (
        <ul className="space-y-4">
          {q.data.map((r: any) => <Row key={r.id} row={r} />)}
        </ul>
      )}
    </Shell>
  );
}

function Row({ row }: { row: any }) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(adminReviewCohostApplication);
  const listReviewsFn = useServerFn(adminListCohostApplicationReviews);
  const [notes, setNotes] = useState<string>(row.admin_notes ?? "");
  const [showLog, setShowLog] = useState(false);

  const reviews = useQuery({
    queryKey: ["cohost-application-reviews", row.id],
    queryFn: () => listReviewsFn({ data: { applicationId: row.id } }),
    enabled: showLog,
  });

  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") => {
      if (decision === "rejected" && !notes.trim()) {
        throw new Error("Add a reviewer note before rejecting.");
      }
      return reviewFn({ data: { id: row.id, decision, notes: notes.trim() || undefined } });
    },
    onSuccess: (_data, decision) => {
      toast.success(decision === "approved" ? "Application approved" : "Application rejected");
      qc.invalidateQueries({ queryKey: ["admin-cohost-applications"] });
      qc.invalidateQueries({ queryKey: ["cohost-application-reviews", row.id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pill =
    row.status === "approved"
      ? "border-neon/50 bg-neon/10 text-neon"
      : row.status === "rejected"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-primary/40 bg-primary/10 text-primary";

  return (
    <li className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-lg">{row.display_name} <span className="text-muted-foreground">· age {row.age}</span></div>
          <div className="text-xs text-muted-foreground">
            {row.email ?? row.user_id} · {row.city} · submitted {new Date(row.submitted_at).toLocaleString()}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${pill}`}>
          {row.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {row.instagram_handle && <Info label="Instagram">{row.instagram_handle}</Info>}
        {row.other_socials && <Info label="Other socials">{row.other_socials}</Info>}
        {row.availability && <Info label="Availability">{row.availability}</Info>}
        {row.event_types && <Info label="Event types">{row.event_types}</Info>}
      </div>
      <div className="mt-3 space-y-3 text-sm">
        {row.bio && <Info label="Bio">{row.bio}</Info>}
        <Info label="Experience">{row.hosting_experience}</Info>
        <Info label="Why join">{row.why_join}</Info>
      </div>

      <div className="mt-4">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Admin notes <span className="normal-case tracking-normal text-muted-foreground/70">(required for rejection, visible in audit log)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Reason for decision, follow-ups, context…"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="mt-1 text-right text-[10px] text-muted-foreground">{notes.length}/2000</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => decide.mutate("approved")}
          disabled={decide.isPending}
          className="rounded-md border border-neon/40 bg-neon/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => decide.mutate("rejected")}
          disabled={decide.isPending}
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="ml-auto rounded-md border border-border px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {showLog ? "Hide" : "Show"} audit log
        </button>
      </div>

      {showLog && (
        <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Decision history
          </div>
          {reviews.isLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
          ) : !reviews.data?.length ? (
            <p className="mt-2 text-xs text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {reviews.data.map((r: any) => (
                <li key={r.id} className="border-l-2 border-border pl-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                        r.decision === "approved"
                          ? "border-neon/50 bg-neon/10 text-neon"
                          : "border-red-500/40 bg-red-500/10 text-red-300"
                      }`}
                    >
                      {r.decision}
                    </span>
                    {r.previous_status && (
                      <span className="text-muted-foreground">from {r.previous_status}</span>
                    )}
                    <span className="text-muted-foreground">
                      · {new Date(r.created_at).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">
                      · by {r.reviewer_email ?? r.reviewer_id}
                    </span>
                  </div>
                  {r.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{r.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}


function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-4xl px-5 py-12">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Co-host applications</h1>
        </div>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-foreground">{children}</div>
    </div>
  );
}
