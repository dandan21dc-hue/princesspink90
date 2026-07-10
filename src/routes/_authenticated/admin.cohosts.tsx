import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  adminExportCohostReviews,
  adminListCohostApplications,
  adminListCohostApplicationReviews,
  adminReviewCohostApplication,
} from "@/lib/cohost.functions";
import {
  acknowledgeHandbook,
  getMyHandbookAck,
  HANDBOOK_VERSION,
} from "@/lib/cohost-handbook.functions";
import handbookAsset from "@/assets/princess-pink-cohost-handbook.pdf.asset.json";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";


type StatusFilter = "all" | "pending" | "approved" | "rejected" | "withdrawn";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

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

  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: 0, pending: 0, approved: 0, rejected: 0, withdrawn: 0,
    };
    for (const r of q.data ?? []) {
      c.all += 1;
      const s = (r as any).status as StatusFilter;
      if (s in c) c[s] += 1;
    }
    return c;
  }, [q.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((r: any) => {
      if (status !== "all" && r.status !== status) return false;
      if (!term) return true;
      return [r.display_name, r.email, r.city, r.instagram_handle]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(term));
    });
  }, [q.data, status, search]);

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
      <div className="mb-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, city, or Instagram…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <ExportAuditLogButton />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => {
            const active = status === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setStatus(t.value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest transition ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                <span className="ml-2 text-muted-foreground/80">{counts[t.value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ResourcesSection />

      {q.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !q.data?.length ? (
        <p className="text-muted-foreground">No applications yet.</p>
      ) : !filtered.length ? (
        <p className="text-muted-foreground">
          No applications match{search ? ` "${search}"` : ""}
          {status !== "all" ? ` in ${status}` : ""}.
        </p>
      ) : (
        <ul className="space-y-4">
          {filtered.map((r: any) => <Row key={r.id} row={r} />)}
        </ul>
      )}
    </Shell>
  );
}


function ResourcesSection() {
  const qc = useQueryClient();
  const getAck = useServerFn(getMyHandbookAck);
  const ackFn = useServerFn(acknowledgeHandbook);
  const ack = useQuery({ queryKey: ["my-handbook-ack"], queryFn: () => getAck() });

  const mutate = useMutation({
    mutationFn: () => ackFn(),
    onSuccess: () => {
      toast.success("Handbook acknowledgement recorded");
      qc.invalidateQueries({ queryKey: ["my-handbook-ack"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const acknowledged = !!ack.data;
  const ackedAt = ack.data?.acknowledged_at
    ? new Date(ack.data.acknowledged_at).toLocaleString()
    : null;

  return (
    <section className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
            Resources
          </div>
          <h2 className="mt-1 font-display text-xl">Co-host handbook</h2>
        </div>
        <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          v{HANDBOOK_VERSION}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        The Midnight Glory Co-Host Handbook covers guest verification, consent,
        safety, compliance and confidentiality. You must read and acknowledge it
        before you are cleared to manage an event.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={handbookAsset.url}
          download="Midnight-Glory-Co-Host-Handbook.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
        >
          Download handbook (PDF)
        </a>
        {acknowledged && (
          <span className="text-xs text-muted-foreground">
            Acknowledged {ackedAt}
          </span>
        )}
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary disabled:opacity-60"
          checked={acknowledged}
          disabled={acknowledged || mutate.isPending || ack.isLoading}
          onChange={(e) => {
            if (e.target.checked && !acknowledged) mutate.mutate();
          }}
        />
        <span>
          I confirm I have read and understood the Midnight Glory Co-Host
          Handbook (v{HANDBOOK_VERSION}) and agree to follow it while managing
          any event.
          {!acknowledged && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Event management is locked until this box is ticked.
            </span>
          )}
        </span>
      </label>
    </section>
  );
}


function ExportAuditLogButton() {
  const exportFn = useServerFn(adminExportCohostReviews);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const { csv, count } = await exportFn();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `cohost-audit-log-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${count} decision${count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="shrink-0 rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {busy ? "Exporting…" : "Export audit log (CSV)"}
    </button>
  );
}

function Row({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const pill =
    row.status === "approved"
      ? "border-neon/50 bg-neon/10 text-neon"
      : row.status === "rejected"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : row.status === "withdrawn"
      ? "border-border bg-muted text-muted-foreground"
      : "border-primary/40 bg-primary/10 text-primary";

  return (
    <>
      <li className="rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-display text-lg">
              {row.display_name} <span className="text-muted-foreground">· age {row.age}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.email ?? row.user_id} · {row.city} · submitted{" "}
              {new Date(row.submitted_at).toLocaleDateString()}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${pill}`}
          >
            {row.status}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            View details
          </button>
          {row.admin_notes && (
            <span className="text-[11px] text-muted-foreground">Has admin notes</span>
          )}
        </div>
      </li>

      <ApplicationDetailSheet row={row} open={open} onOpenChange={setOpen} />
    </>
  );
}

function ApplicationDetailSheet({
  row,
  open,
  onOpenChange,
}: {
  row: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(adminReviewCohostApplication);
  const listReviewsFn = useServerFn(adminListCohostApplicationReviews);
  const [notes, setNotes] = useState<string>(row.admin_notes ?? "");

  const reviews = useQuery({
    queryKey: ["cohost-application-reviews", row.id],
    queryFn: () => listReviewsFn({ data: { applicationId: row.id } }),
    enabled: open,
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
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pill =
    row.status === "approved"
      ? "border-neon/50 bg-neon/10 text-neon"
      : row.status === "rejected"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : row.status === "withdrawn"
      ? "border-border bg-muted text-muted-foreground"
      : "border-primary/40 bg-primary/10 text-primary";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <SheetTitle className="font-display text-2xl">
              {row.display_name}{" "}
              <span className="text-base font-normal text-muted-foreground">· age {row.age}</span>
            </SheetTitle>
            <span
              className={`ml-auto shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${pill}`}
            >
              {row.status}
            </span>
          </div>
          <SheetDescription>
            {row.email ?? row.user_id} · {row.city} · submitted{" "}
            {new Date(row.submitted_at).toLocaleString()}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {row.instagram_handle && <Info label="Instagram">{row.instagram_handle}</Info>}
            {row.other_socials && <Info label="Other socials">{row.other_socials}</Info>}
            {row.availability && <Info label="Availability">{row.availability}</Info>}
            {row.event_types && <Info label="Event types">{row.event_types}</Info>}
          </div>

          <div className="space-y-3 text-sm">
            {row.bio && <Info label="Bio">{row.bio}</Info>}
            <Info label="Experience">{row.hosting_experience}</Info>
            <Info label="Why join">{row.why_join}</Info>
            {row.co_host_agreement_signed_at && (
              <Info label="Handbook acknowledgement">
                <span className="text-neon">✓ Signed</span> by{" "}
                <span className="text-foreground">{row.handbook_signature_name}</span>{" "}
                on {new Date(row.co_host_agreement_signed_at).toLocaleString()}
                {row.handbook_version && (
                  <span className="text-muted-foreground"> · handbook v{row.handbook_version}</span>
                )}
              </Info>
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Admin notes{" "}
              <span className="normal-case tracking-normal text-muted-foreground/70">
                (required for rejection, visible in audit log)
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Reason for decision, follow-ups, context…"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">
              {notes.length}/2000
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
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
          </div>

          <div className="rounded-lg border border-border/60 bg-background/60 p-4">
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
        </div>
      </SheetContent>
    </Sheet>
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
