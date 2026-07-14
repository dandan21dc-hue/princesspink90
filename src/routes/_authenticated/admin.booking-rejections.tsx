import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { amIAdmin } from "@/lib/admin.functions";
import {
  listBookingRejections,
  type BookingRejectionRow,
} from "@/lib/booking-rejections.functions";

export const Route = createFileRoute("/_authenticated/admin/booking-rejections")({
  head: () => ({
    meta: [
      { title: "Rejected bookings — Admin" },
      {
        name: "description",
        content:
          "Report of private-room booking attempts that were rejected, with the specific conflict reason and timestamp.",
      },
    ],
  }),
  component: BookingRejectionsAdmin,
});

type KindFilter = "all" | "create" | "reschedule_self" | "reschedule_admin";

const KIND_LABEL: Record<BookingRejectionRow["attempt_kind"], string> = {
  create: "New booking",
  reschedule_self: "Guest reschedule",
  reschedule_admin: "Admin reschedule",
};

const REASON_LABEL: Record<string, string> = {
  slot_conflict: "Slot conflict",
  lead_time_too_short: "Not enough lead time",
  outside_operating_hours: "Outside operating hours",
};

function BookingRejectionsAdmin() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listBookingRejections);

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });

  const [kind, setKind] = useState<KindFilter>("all");
  const [reason, setReason] = useState<string>("all");
  const [sinceDays, setSinceDays] = useState<string>("7");

  const query = useQuery({
    queryKey: ["admin-booking-rejections", kind, reason, sinceDays],
    queryFn: () =>
      listFn({
        data: {
          attemptKind: kind,
          reasonCode: reason,
          sinceDays: sinceDays ? Number(sinceDays) : null,
          limit: 500,
        },
      }),
    enabled: me.data?.isAdmin === true,
    refetchInterval: 30_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  const reasonOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.reason_code);
    return Array.from(seen).sort();
  }, [rows]);

  if (me.isLoading) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don&apos;t have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">
            Back to dashboard
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Rejected booking attempts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every private-room booking or reschedule attempt that the server
          rejected — with the specific reason and the exact time it happened.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-3">
        <FilterSelect
          label="Attempt kind"
          value={kind}
          onChange={(v) => setKind(v as KindFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "create", label: KIND_LABEL.create },
            { value: "reschedule_self", label: KIND_LABEL.reschedule_self },
            { value: "reschedule_admin", label: KIND_LABEL.reschedule_admin },
          ]}
        />
        <FilterSelect
          label="Reason"
          value={reason}
          onChange={setReason}
          options={[
            { value: "all", label: "All" },
            ...reasonOptions.map((code) => ({
              value: code,
              label: REASON_LABEL[code] ?? code,
            })),
          ]}
        />
        <FilterSelect
          label="Window"
          value={sinceDays}
          onChange={setSinceDays}
          options={[
            { value: "1", label: "Last 24h" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "", label: "All time" },
          ]}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Rejections" value={summary?.total ?? 0} />
        <SummaryTile
          label="Slot conflicts"
          value={summary?.byReason.slot_conflict ?? 0}
        />
        <SummaryTile
          label="Lead time"
          value={summary?.byReason.lead_time_too_short ?? 0}
        />
        <SummaryTile
          label="Off-hours"
          value={summary?.byReason.outside_operating_hours ?? 0}
        />
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading rejections…</p>
      )}
      {query.error && (
        <p className="text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}

      {!query.isLoading && rows.length === 0 && (
        <div className="rounded-lg border border-border/60 bg-secondary/20 p-8 text-center text-sm text-muted-foreground">
          No rejected booking attempts in this window. 🎉
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Attempted slot</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Conflict / booking</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RejectionRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function RejectionRow({ row }: { row: BookingRejectionRow }) {
  const created = new Date(row.created_at);
  const attempted = row.attempted_starts_at ? new Date(row.attempted_starts_at) : null;
  return (
    <tr className="border-t border-border/40 align-top">
      <td className="whitespace-nowrap px-3 py-2 text-foreground">
        <div>{created.toLocaleString()}</div>
        <div className="text-[11px] text-muted-foreground">
          {timeAgo(created)}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-foreground">
        {KIND_LABEL[row.attempt_kind]}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-foreground">
        {attempted ? attempted.toLocaleString() : "—"}
        {row.duration_minutes ? (
          <div className="text-[11px] text-muted-foreground">
            {row.duration_minutes} min
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${reasonStyle(row.reason_code)}`}
        >
          {REASON_LABEL[row.reason_code] ?? row.reason_code}
        </span>
        <div className="mt-1 max-w-md text-[12px] text-muted-foreground">
          {row.reason_message}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {row.user_id ? row.user_id.slice(0, 8) : "—"}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {row.booking_id && (
          <div>
            <span className="text-foreground/70">booking:</span>{" "}
            {row.booking_id.slice(0, 8)}
          </div>
        )}
        {row.conflict_booking_ids.length > 0 && (
          <div>
            <span className="text-foreground/70">conflicts:</span>{" "}
            {row.conflict_booking_ids.map((id) => id.slice(0, 8)).join(", ")}
          </div>
        )}
      </td>
    </tr>
  );
}

function reasonStyle(code: string) {
  switch (code) {
    case "slot_conflict":
      return "bg-destructive/15 text-destructive";
    case "lead_time_too_short":
      return "bg-amber-500/15 text-amber-400";
    case "outside_operating_hours":
      return "bg-muted/40 text-foreground/70";
    default:
      return "bg-muted/40 text-foreground/70";
  }
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12">{children}</section>;
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-foreground">
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col text-[11px] uppercase tracking-widest text-muted-foreground">
      <span className="mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
