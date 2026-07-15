import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminGetIdSignedUrl,
  adminListAgeVerifications,
  adminReviewAgeVerification,
} from "@/lib/verification.functions";
import { amIAdmin } from "@/lib/admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/verifications")({
  head: () => ({ meta: [{ title: "Verifications · Admin" }] }),
  component: AdminVerifications,
});

function AdminVerifications() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(adminListAgeVerifications);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const q = useQuery({
    queryKey: ["admin-verifications"],
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
        <p className="text-muted-foreground">No submissions yet.</p>
      ) : (
        <ul className="space-y-4">
          {q.data.map((r) => (
            <Row key={r.id} row={r} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Row({
  row,
}: {
  row: {
    id: string;
    user_id: string;
    date_of_birth: string;
    status: string;
    submitted_at: string;
    id_file_path: string;
    notes: string | null;
    email: string | null;
  };
}) {
  const qc = useQueryClient();
  const signFn = useServerFn(adminGetIdSignedUrl);
  const reviewFn = useServerFn(adminReviewAgeVerification);
  const [notes, setNotes] = useState(row.notes ?? "");

  const view = useMutation({
    mutationFn: () => signFn({ data: { path: row.id_file_path } }),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
    onError: (e) => toast.error((e as Error).message),
  });
  const decide = useMutation({
    mutationFn: (status: "approved" | "rejected") =>
      reviewFn({ data: { id: row.id, status, notes: notes || undefined } }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-verifications"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dob = new Date(row.date_of_birth);
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
  const statusColor =
    row.status === "approved"
      ? "text-neon border-neon/40 bg-neon/10"
      : row.status === "rejected"
      ? "text-destructive border-destructive/40 bg-destructive/10"
      : "text-primary border-primary/40 bg-primary/10";

  return (
    <li className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm">{row.email ?? row.user_id}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            DOB {row.date_of_birth} · age {age} · submitted {new Date(row.submitted_at).toLocaleString()}
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest ${statusColor}`}>
          {row.status}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => view.mutate()}
          disabled={view.isPending}
          className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-secondary/40"
        >
          {view.isPending ? "…" : "View ID"}
        </button>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason (optional)"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
        />
        <button
          onClick={() => decide.mutate("approved")}
          disabled={decide.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
        >
          Approve
        </button>
        <button
          onClick={() => decide.mutate("rejected")}
          disabled={decide.isPending}
          className="rounded-md border border-destructive/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/10"
        >
          Reject
        </button>
      </div>
    </li>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">ID verifications</h1>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      {children}
    </div>
  );
}
