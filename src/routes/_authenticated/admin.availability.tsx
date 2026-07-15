import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  bulkCreateSessionSlots,
  createSessionSlot,
  deleteSessionSlot,
  listUpcomingSessionSlots,
  updateSessionSlot,
  type PrivateSessionSlot,
} from "@/lib/availability.functions";

export const Route = createFileRoute("/_authenticated/admin/availability")({
  head: () => ({ meta: [{ title: "Availability Manager · Admin" }] }),
  component: AvailabilityAdmin,
});

// Convert a Date to a value suitable for <input type="datetime-local">
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string) {
  // datetime-local returns local time without offset; new Date() parses as local.
  return new Date(s).toISOString();
}
function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAud(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `A$${(cents / 100).toFixed(2)}`;
}

type ConflictPair = { a: PrivateSessionSlot; b: PrivateSessionSlot };

function findConflicts(slots: PrivateSessionSlot[]): ConflictPair[] {
  const sorted = [...slots].sort(
    (x, y) => new Date(x.start_time).getTime() - new Date(y.start_time).getTime(),
  );
  const out: ConflictPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = new Date(a.end_time).getTime();
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = new Date(b.start_time).getTime();
      if (bStart >= aEnd) break;
      out.push({ a, b });
    }
  }
  return out;
}

function overlapsAny(
  startISO: string,
  endISO: string,
  slots: PrivateSessionSlot[],
  ignoreId?: string,
): PrivateSessionSlot[] {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
  return slots.filter((slot) => {
    if (ignoreId && slot.id === ignoreId) return false;
    const ss = new Date(slot.start_time).getTime();
    const se = new Date(slot.end_time).getTime();
    return s < se && e > ss;
  });
}

function AvailabilityAdmin() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listUpcomingSessionSlots);
  const createFn = useServerFn(createSessionSlot);
  const updateFn = useServerFn(updateSessionSlot);
  const deleteFn = useServerFn(deleteSessionSlot);
  const bulkFn = useServerFn(bulkCreateSessionSlots);

  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const slotsQ = useQuery({
    queryKey: ["admin-availability-slots"],
    queryFn: () => listFn(),
    enabled: me.data?.isAdmin === true,
  });

  const [editing, setEditing] = useState<PrivateSessionSlot | "new" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-availability-slots"] });

  const createMut = useMutation({
    mutationFn: (v: {
      startTime: string;
      endTime: string;
      isBooked: boolean;
      notes: string;
      durationMinutes: number | null;
      priceCents: number | null;
    }) => createFn({ data: { ...v, notes: v.notes || null } }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (v: {
      id: string;
      startTime: string;
      endTime: string;
      isBooked: boolean;
      notes: string;
      durationMinutes: number | null;
      priceCents: number | null;
    }) =>
      updateFn({
        data: {
          id: v.id,
          startTime: v.startTime,
          endTime: v.endTime,
          isBooked: v.isBooked,
          notes: v.notes || null,
          durationMinutes: v.durationMinutes,
          priceCents: v.priceCents,
        },
      }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => setError(e.message),
  });
  const bulkMut = useMutation({
    mutationFn: (v: {
      slots: Array<{ startTime: string; endTime: string }>;
      durationMinutes: number | null;
      priceCents: number | null;
    }) => bulkFn({ data: v }),
    onSuccess: (res) => {
      setBulkOpen(false);
      invalidate();
      const skippedNote = res.skipped > 0 ? ` (${res.skipped} skipped — overlap with closed/existing)` : "";
      toast.success(`Created ${res.created} slot${res.created === 1 ? "" : "s"}${skippedNote}`);
    },
    onError: (e: Error) => setError(e.message),
  });

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
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">
            Back to dashboard
          </Link>
        </p>
      </Shell>
    );
  }

  const slots = slotsQ.data ?? [];
  const availableCount = slots.filter((s) => !s.is_booked).length;
  const bookedCount = slots.filter((s) => s.is_booked).length;
  const conflicts = useMemo(() => findConflicts(slots), [slots]);
  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) {
      set.add(c.a.id);
      set.add(c.b.id);
    }
    return set;
  }, [conflicts]);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Availability Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the windows when the Private Room is bookable. Customers can only pick times inside an "available" slot. Marking a slot "booked / blocked" hides it from the public picker.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Dashboard
          </Link>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setBulkOpen(true);
            }}
            className="rounded-md border border-primary/50 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            Bulk add slots
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
          >
            + Create new slot
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <SummaryTile label="Upcoming" value={slots.length} />
        <SummaryTile label="Available" value={availableCount} tone="available" />
        <SummaryTile label="Booked / blocked" value={bookedCount} tone="used" />
      </div>

      {conflicts.length > 0 && (
        <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2 font-semibold">
            <span aria-hidden>⚠</span>
            {conflicts.length} scheduling conflict{conflicts.length === 1 ? "" : "s"} — resolve before publishing new slots
          </div>
          <ul className="mt-2 space-y-2 text-xs">
            {conflicts.map((c, i) => {
              const overlapStart = new Date(
                Math.max(new Date(c.a.start_time).getTime(), new Date(c.b.start_time).getTime()),
              );
              const overlapEnd = new Date(
                Math.min(new Date(c.a.end_time).getTime(), new Date(c.b.end_time).getTime()),
              );
              const overlapMin = Math.round(
                (overlapEnd.getTime() - overlapStart.getTime()) / 60000,
              );
              const earlier = new Date(c.a.start_time) <= new Date(c.b.start_time) ? c.a : c.b;
              const later = earlier === c.a ? c.b : c.a;
              return (
                <li
                  key={i}
                  className="rounded border border-destructive/30 bg-background/40 px-3 py-2 text-foreground"
                >
                  <div className="text-destructive">
                    Overlap of {overlapMin} min ({fmt(overlapStart.toISOString())} → {fmt(overlapEnd.toISOString())})
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    <strong className="text-foreground">A:</strong> {fmt(earlier.start_time)} → {fmt(earlier.end_time)}
                    {earlier.is_booked ? " (booked/blocked)" : " (available)"}
                    <br />
                    <strong className="text-foreground">B:</strong> {fmt(later.start_time)} → {fmt(later.end_time)}
                    {later.is_booked ? " (booked/blocked)" : " (available)"}
                  </div>
                  <div className="mt-1 text-xs">
                    Fix: shorten <strong>A</strong> to end by {fmt(later.start_time)}, or move
                    <strong> B</strong> to start at or after {fmt(earlier.end_time)}, or delete one of them.
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {slotsQ.isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading slots…</p>
      ) : slotsQ.error ? (
        <p className="mt-8 text-destructive">
          Failed to load: {(slotsQ.error as Error).message}
        </p>
      ) : slots.length === 0 ? (
        <p className="mt-8 text-muted-foreground">
          No upcoming slots yet. Create one to start offering private sessions.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const inConflict = conflictIds.has(s.id);
                return (
                <tr
                  key={s.id}
                  className={`border-t border-border/40 ${inConflict ? "bg-destructive/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    {inConflict && (
                      <span
                        title="This slot overlaps another — see conflict warning above"
                        className="mr-2 inline-block rounded border border-destructive/50 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-destructive"
                      >
                        Conflict
                      </span>
                    )}
                    {fmt(s.start_time)}
                  </td>
                  <td className="px-4 py-3">{fmt(s.end_time)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.duration_minutes != null ? `${s.duration_minutes} min` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {fmtAud(s.price_cents)}
                  </td>
                  <td className="px-4 py-3">
                    {s.is_booked ? (
                      <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        Booked
                      </span>
                    ) : (
                      <span className="rounded-md border border-neon/40 bg-neon/10 px-2 py-0.5 text-[11px] text-neon">
                        Available
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px] truncate">
                    {s.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEditing(s);
                        }}
                        className="rounded border border-border px-3 py-1 text-xs hover:bg-secondary/40"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (!confirm("Delete this slot? This can't be undone.")) return;
                          setError(null);
                          deleteMut.mutate(s.id);
                        }}
                        className="rounded border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <SlotDialog
          initial={editing === "new" ? null : editing}
          existingSlots={slots}
          pending={createMut.isPending || updateMut.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(v) => {
            setError(null);
            if (editing === "new") {
              createMut.mutate(v);
            } else {
              updateMut.mutate({ id: editing.id, ...v });
            }
          }}
        />
      )}

      {bulkOpen && (
        <BulkAddDialog
          pending={bulkMut.isPending}
          onCancel={() => setBulkOpen(false)}
          onSubmit={(payload) => {
            setError(null);
            bulkMut.mutate(payload);
          }}
        />
      )}
    </Shell>
  );
}

function SlotDialog({
  initial,
  existingSlots,
  pending,
  onCancel,
  onSubmit,
}: {
  initial: PrivateSessionSlot | null;
  existingSlots: PrivateSessionSlot[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: {
    startTime: string;
    endTime: string;
    isBooked: boolean;
    notes: string;
    durationMinutes: number | null;
    priceCents: number | null;
  }) => void;
}) {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const [start, setStart] = useState(
    initial ? toLocalInput(new Date(initial.start_time)) : toLocalInput(now),
  );
  const [end, setEnd] = useState(
    initial ? toLocalInput(new Date(initial.end_time)) : toLocalInput(later),
  );
  const [isBooked, setIsBooked] = useState(initial?.is_booked ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [duration, setDuration] = useState<string>(
    initial?.duration_minutes != null ? String(initial.duration_minutes) : "",
  );
  const [priceAud, setPriceAud] = useState<string>(
    initial?.price_cents != null ? (initial.price_cents / 100).toFixed(2) : "",
  );
  const [localErr, setLocalErr] = useState<string | null>(null);

  const startISO = start ? fromLocalInput(start) : "";
  const endISO = end ? fromLocalInput(end) : "";
  const rangeInvalid =
    !!start && !!end && new Date(end).getTime() <= new Date(start).getTime();
  const overlaps = useMemo(
    () =>
      rangeInvalid
        ? []
        : overlapsAny(startISO, endISO, existingSlots, initial?.id),
    [startISO, endISO, existingSlots, initial?.id, rangeInvalid],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) {
      setLocalErr("Start and end are required");
      return;
    }
    if (rangeInvalid) {
      setLocalErr("End time must be after start time");
      return;
    }
    if (overlaps.length > 0) {
      setLocalErr(
        `This slot overlaps ${overlaps.length} existing slot${overlaps.length === 1 ? "" : "s"}. Adjust the times before saving.`,
      );
      return;
    }
    let durationMinutes: number | null = null;
    if (duration.trim() !== "") {
      const n = Number(duration);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        setLocalErr("Duration must be a whole number of minutes.");
        return;
      }
      durationMinutes = n;
    }
    let priceCents: number | null = null;
    if (priceAud.trim() !== "") {
      const n = Number(priceAud);
      if (!Number.isFinite(n) || n < 0) {
        setLocalErr("Price must be A$0 or greater.");
        return;
      }
      priceCents = Math.round(n * 100);
    }
    setLocalErr(null);
    onSubmit({
      startTime: startISO,
      endTime: endISO,
      isBooked,
      notes,
      durationMinutes,
      priceCents,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2 className="font-display text-xl font-semibold">
          {initial ? "Edit slot" : "Create new slot"}
        </h2>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Start time
            </span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              End time
            </span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isBooked}
              onChange={(e) => setIsBooked(e.target.checked)}
            />
            <span>
              Mark as <strong>booked / unavailable</strong> (hidden from the public
              picker)
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Duration (minutes)
              </span>
              <input
                type="number"
                min={1}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="auto from start/end"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Price (A$)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={priceAud}
                onChange={(e) => setPriceAud(e.target.value)}
                placeholder="e.g. 60.00"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Internal notes, e.g. held for VIP, maintenance…"
            />
          </label>
        </div>

        {rangeInvalid && (
          <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            End time must be after start time. Move the end time later than {start || "the start"}.
          </p>
        )}
        {!rangeInvalid && overlaps.length > 0 && (
          <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <div className="font-semibold">
              ⚠ Overlaps {overlaps.length} existing slot{overlaps.length === 1 ? "" : "s"} — fix before saving
            </div>
            <ul className="mt-2 space-y-1 text-xs text-foreground">
              {overlaps.slice(0, 5).map((o) => {
                const oStart = new Date(o.start_time).getTime();
                const newStart = new Date(startISO).getTime();
                const suggestion =
                  newStart >= oStart
                    ? `start at or after ${fmt(o.end_time)}`
                    : `end by ${fmt(o.start_time)}`;
                return (
                  <li key={o.id}>
                    Conflicts with {fmt(o.start_time)} → {fmt(o.end_time)}
                    {o.is_booked ? " (booked/blocked)" : " (available)"}. Try: {suggestion}.
                  </li>
                );
              })}
              {overlaps.length > 5 && (
                <li className="text-muted-foreground">…and {overlaps.length - 5} more.</li>
              )}
            </ul>
          </div>
        )}
        {localErr && (
          <p className="mt-3 text-sm text-destructive">{localErr}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-widest hover:bg-secondary/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || rangeInvalid || overlaps.length > 0}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Saving…" : initial ? "Save changes" : "Create slot"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-5 py-12">{children}</section>;
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "used" | "available";
}) {
  const toneCls =
    tone === "used"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "available"
        ? "border-neon/40 bg-neon/10 text-neon"
        : "border-border/60 bg-secondary/30 text-foreground";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

function BulkAddDialog({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: {
    slots: Array<{ startTime: string; endTime: string }>;
    durationMinutes: number | null;
    priceCents: number | null;
  }) => void;
}) {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dateOnly = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const [dateFrom, setDateFrom] = useState(dateOnly(today));
  const [dateTo, setDateTo] = useState(dateOnly(tomorrow));
  const [timeStart, setTimeStart] = useState("10:00");
  const [timeEnd, setTimeEnd] = useState("17:00");
  const [duration, setDuration] = useState(60);
  const [gap, setGap] = useState(15);
  const [priceAud, setPriceAud] = useState<string>("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    try {
      return generateBulkSlots({ dateFrom, dateTo, timeStart, timeEnd, duration, gap });
    } catch {
      return [];
    }
  }, [dateFrom, dateTo, timeStart, timeEnd, duration, gap]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let slots: Array<{ startTime: string; endTime: string }> = [];
    try {
      slots = generateBulkSlots({ dateFrom, dateTo, timeStart, timeEnd, duration, gap });
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "Invalid configuration");
      return;
    }
    if (slots.length === 0) {
      setLocalErr("No slots would be generated with these settings.");
      return;
    }
    if (slots.length > 500) {
      setLocalErr(`Too many slots (${slots.length}). Max 500 per bulk add — narrow the range.`);
      return;
    }
    setLocalErr(null);
    onSubmit(slots);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2 className="font-display text-xl font-semibold">Bulk add slots</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Generates slots across a date range. Any proposed slot that overlaps an
          existing slot (booked, blocked, or available) is skipped automatically.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">From date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">To date</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Start time</span>
            <input
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">End time</span>
            <input
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Duration (minutes)
            </span>
            <input
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Gap between (minutes)
            </span>
            <input
              type="number"
              min={0}
              step={5}
              value={gap}
              onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
          Will generate <strong className="text-foreground">{preview.length}</strong>{" "}
          slot{preview.length === 1 ? "" : "s"} before overlap-skip.
        </div>

        {localErr && <p className="mt-3 text-sm text-destructive">{localErr}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-widest hover:bg-secondary/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || preview.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function generateBulkSlots(cfg: {
  dateFrom: string;
  dateTo: string;
  timeStart: string;
  timeEnd: string;
  duration: number;
  gap: number;
}): Array<{ startTime: string; endTime: string }> {
  const { dateFrom, dateTo, timeStart, timeEnd, duration, gap } = cfg;
  if (!dateFrom || !dateTo) throw new Error("Pick a date range");
  const [sh, sm] = timeStart.split(":").map(Number);
  const [eh, em] = timeEnd.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) throw new Error("Invalid time");
  if (duration <= 0) throw new Error("Duration must be > 0");
  if (gap < 0) throw new Error("Gap cannot be negative");
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) throw new Error("End time must be after start time");

  const [fy, fm, fd] = dateFrom.split("-").map(Number);
  const [ty, tm, td] = dateTo.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  if (to.getTime() < from.getTime()) throw new Error("End date is before start date");

  const step = duration + gap;
  const slots: Array<{ startTime: string; endTime: string }> = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    for (let m = startMin; m + duration <= endMin; m += step) {
      const s = new Date(cursor);
      s.setHours(Math.floor(m / 60), m % 60, 0, 0);
      const e = new Date(s.getTime() + duration * 60 * 1000);
      slots.push({ startTime: s.toISOString(), endTime: e.toISOString() });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}
