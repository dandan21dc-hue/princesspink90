import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { lookupCheckin, performCheckin, listCheckins } from "@/lib/checkin.functions";
import type { VideoConsent } from "@/lib/verification.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/events/$id/checkin")({
  head: () => ({ meta: [{ title: "Door check-in · AFTERDARK" }] }),
  component: CheckinPage,
});

type Lookup = Awaited<ReturnType<typeof lookupCheckin>>;
type FoundLookup = Extract<Lookup, { found: true }>;

function CheckinPage() {
  const { id: eventId } = Route.useParams();
  const lookupFn = useServerFn(lookupCheckin);
  const checkinFn = useServerFn(performCheckin);
  const rosterFn = useServerFn(listCheckins);
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [scanner, setScanner] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep focus on the input while scanner mode is on so a keyboard-wedge
  // barcode/QR scanner always lands its keystrokes here.
  useEffect(() => {
    if (!scanner) return;
    inputRef.current?.focus();
    const onFocus = () => inputRef.current?.focus();
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // Don't steal focus from actual form controls (buttons, checkboxes, other inputs)
      if (t?.closest("button, input, textarea, select, a, label")) return;
      inputRef.current?.focus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("click", onClick);
    };
  }, [scanner]);

  const roster = useQuery({
    queryKey: ["checkin-roster", eventId],
    queryFn: () => rosterFn({ data: { event_id: eventId } }),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  // Realtime nudge: when the rsvps row updates, refetch immediately.
  useEffect(() => {
    const channel = supabase
      .channel(`checkin-roster-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rsvps", filter: `event_id=eq.${eventId}` },
        () => qc.invalidateQueries({ queryKey: ["checkin-roster", eventId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  const lookup = useMutation({
    mutationFn: (t: string) => lookupFn({ data: { event_id: eventId, ticket_code: t } }),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Door</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Check-in</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/events/$id/checkin/print"
            params={{ id: eventId }}
            target="_blank"
            className="rounded-md border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground hover:bg-accent"
          >
            Print door sheet
          </Link>
          <Link
            to="/events/$id"
            params={{ id: eventId }}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Event
          </Link>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          setResult(null);
          lookup.mutate(code.trim());
        }}
        className="flex gap-2"
      >
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Ticket code"
          className="flex-1 rounded-md border border-border bg-background px-4 py-3 font-mono text-lg tracking-widest"
          maxLength={50}
        />
        <button
          type="submit"
          disabled={lookup.isPending}
          className="rounded-md bg-primary px-6 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {lookup.isPending ? "…" : "Look up"}
        </button>
      </form>

      {result?.found === false && (
        <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          No RSVP matches that code for this event.
        </p>
      )}

      {result?.found && (
        <GuestPanel
          data={result}
          eventId={eventId}
          onCheckedIn={() => {
            setCode("");
            setResult(null);
            qc.invalidateQueries({ queryKey: ["checkin-roster", eventId] });
            toast.success("Checked in — welcome them in.");
          }}
          checkinFn={checkinFn}
        />
      )}

      <Roster
        guests={roster.data?.guests ?? []}
        totalHeads={roster.data?.total_heads ?? 0}
        loading={roster.isLoading}
        fetching={roster.isFetching}
      />
    </main>
  );
}

function Roster({
  guests,
  totalHeads,
  loading,
  fetching,
}: {
  guests: {
    id: string;
    ticket_code: string;
    guest_count: number;
    checked_in_at: string;
    display_name: string | null;
    consent: VideoConsent | null;
    door_notes: string | null;
  }[];
  totalHeads: number;
  loading: boolean;
  fetching: boolean;
}) {
  return (
    <section className="mt-10 rounded-2xl border border-border/60 bg-card/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Admitted tonight</div>
          <div className="mt-1 font-display text-2xl font-bold">
            {guests.length}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              check-in{guests.length === 1 ? "" : "s"} · {totalHeads} head{totalHeads === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${fetching ? "bg-neon animate-pulse" : "bg-neon/40"}`} />
          Live
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-xs text-muted-foreground">Loading roster…</p>
      ) : guests.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No one has been admitted yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/50">
          {guests.map((g) => (
            <li key={g.id} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{g.display_name ?? "Guest"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono tracking-widest text-neon">{g.ticket_code}</span>
                  {" · "}Party of {g.guest_count}
                  {" · "}
                  {new Date(g.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                {g.door_notes && (
                  <div className="mt-1 text-xs italic text-muted-foreground">“{g.door_notes}”</div>
                )}
              </div>
              <ConsentBadges consent={g.consent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConsentBadges({ consent }: { consent: VideoConsent | null }) {
  if (!consent) {
    return <span className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">No consent recorded</span>;
  }
  const items: { key: keyof VideoConsent; short: string; cls: string }[] = [
    { key: "no_filming", short: "No film", cls: "border-destructive/60 bg-destructive/10 text-destructive" },
    { key: "face_blurred_only", short: "Blur only", cls: "border-primary/50 bg-primary/10 text-primary" },
    { key: "private_archive", short: "Archive", cls: "border-neon/50 bg-neon/10 text-neon" },
    { key: "public_promo", short: "Promo OK", cls: "border-neon/50 bg-neon/10 text-neon" },
  ];
  const active = items.filter((i) => consent[i.key]);
  if (!active.length) {
    return <span className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">No preference</span>;
  }
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {active.map((i) => (
        <span
          key={i.key}
          className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest ${i.cls}`}
        >
          {i.short}
        </span>
      ))}
    </div>
  );
}

function GuestPanel({
  data,
  eventId,
  onCheckedIn,
  checkinFn,
}: {
  data: FoundLookup;
  eventId: string;
  onCheckedIn: () => void;
  checkinFn: ReturnType<typeof useServerFn<typeof performCheckin>>;
}) {
  const [consent, setConsent] = useState<VideoConsent>(
    (data.rsvp.video_consent as VideoConsent) ?? {
      private_archive: false,
      public_promo: false,
      face_blurred_only: false,
      no_filming: true,
    },
  );
  const [ageOk, setAgeOk] = useState(false);
  const [notes, setNotes] = useState("");

  const ageStatus = data.age?.status ?? "missing";
  const ageOkOnFile = ageStatus === "approved";

  const check = useMutation({
    mutationFn: () =>
      checkinFn({
        data: {
          rsvp_id: data.rsvp.id,
          event_id: eventId,
          consent,
          door_notes: notes || undefined,
        },
      }),
    onSuccess: onCheckedIn,
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (key: keyof VideoConsent) => (v: boolean) => {
    setConsent((c) => {
      const next = { ...c, [key]: v };
      if (key === "no_filming" && v) {
        next.private_archive = false;
        next.public_promo = false;
        next.face_blurred_only = false;
      } else if (v && key !== "no_filming") {
        next.no_filming = false;
      }
      return next;
    });
  };

  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-border/60 bg-card/40 p-6">
      <header>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Guest</div>
        <div className="mt-1 font-display text-2xl font-bold">
          {data.guest.display_name ?? data.guest.email ?? "Unknown"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {data.guest.email} · Ticket{" "}
          <span className="font-mono tracking-widest">{data.rsvp.ticket_code}</span> · Party of{" "}
          {data.rsvp.guest_count}
        </div>
        {data.rsvp.checked_in_at && (
          <div className="mt-3 rounded-md border border-neon/40 bg-neon/10 px-3 py-2 text-xs uppercase tracking-widest text-neon">
            Already checked in {new Date(data.rsvp.checked_in_at).toLocaleTimeString()}
          </div>
        )}
      </header>

      <AgeBadge status={ageStatus} dob={data.age?.date_of_birth ?? null} />

      <div>
        <div className="mb-2 text-xs uppercase tracking-widest text-primary">
          Confirm video consent (ask the guest)
        </div>
        <div className="space-y-1.5 text-sm">
          <Check label="Private archive only" checked={consent.private_archive} onChange={toggle("private_archive")} />
          <Check label="OK for public promo / social" checked={consent.public_promo} onChange={toggle("public_promo")} />
          <Check label="Only if face is blurred" checked={consent.face_blurred_only} onChange={toggle("face_blurred_only")} />
          <Check label="Do not film" checked={consent.no_filming} onChange={toggle("no_filming")} />
        </div>
      </div>

      <label className="block">
        <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">Door notes (optional)</div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} className="mt-1" />
        <span>I visually matched the guest to their approved ID and confirmed they are 18+.</span>
      </label>

      <button
        onClick={() => check.mutate()}
        disabled={check.isPending || !ageOk || !ageOkOnFile}
        className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
      >
        {!ageOkOnFile
          ? "Refuse entry — no approved ID"
          : check.isPending
          ? "Checking in…"
          : "Admit guest & record consent"}
      </button>
    </section>
  );
}

function AgeBadge({ status, dob }: { status: string; dob: string | null }) {
  const map: Record<string, string> = {
    approved: "border-neon/50 bg-neon/10 text-neon",
    pending: "border-primary/50 bg-primary/10 text-primary",
    rejected: "border-destructive/60 bg-destructive/10 text-destructive",
    missing: "border-destructive/60 bg-destructive/10 text-destructive",
  };
  const label: Record<string, string> = {
    approved: "ID approved",
    pending: "ID pending review",
    rejected: "ID rejected",
    missing: "No ID on file",
  };
  const age = dob
    ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  return (
    <div className={`rounded-lg border p-3 text-xs uppercase tracking-widest ${map[status] ?? map.missing}`}>
      {label[status] ?? label.missing}
      {age !== null && ` · age ${age}`}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span>{label}</span>
    </label>
  );
}
