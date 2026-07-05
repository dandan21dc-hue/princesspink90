import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getPublicEventById } from "@/lib/events.functions";
import { rsvpToEvent, cancelRsvp, myRsvpForEvent } from "@/lib/rsvp.functions";
import { getMyAgeVerification, type VideoConsent } from "@/lib/verification.functions";
import { listMyHealthScreenings, isScreeningCurrent } from "@/lib/health.functions";
import { useWaiverPdfDownload } from "@/lib/useWaiverPdfDownload";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ConsentCompliance } from "@/components/ConsentCompliance";

const eventQuery = (id: string) =>
  queryOptions({
    queryKey: ["public-event", id],
    queryFn: () => getPublicEventById({ data: { id } }),
  });

export const Route = createFileRoute("/events/$id")({
  loader: async ({ context, params }) => {
    const e = await context.queryClient.ensureQueryData(eventQuery(params.id));
    if (!e) throw notFound();
    return e;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} · AFTERDARK` },
          { name: "description", content: loaderData.tagline ?? loaderData.description ?? "" },
          { property: "og:title", content: loaderData.title },
          { property: "og:description", content: loaderData.tagline ?? "" },
          ...(loaderData.cover_image_url
            ? [
                { property: "og:image", content: loaderData.cover_image_url },
                { name: "twitter:image", content: loaderData.cover_image_url },
              ]
            : []),
        ]
      : [],
  }),
  component: EventPage,
});

function EventPage() {
  const event = Route.useLoaderData();
  const params = Route.useParams();
  const { data } = useSuspenseQuery(eventQuery(params.id));
  const e = data ?? event;

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s);
      setUserId(s?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!e) return null;
  const d = new Date(e.starts_at);

  return (
    <article className="mx-auto max-w-4xl px-5 py-10">
      <div className="overflow-hidden rounded-3xl border border-border/60">
        <div className="aspect-[16/9] w-full bg-secondary/30">
          {e.cover_image_url ? (
            <img src={e.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-primary/30 via-accent/30 to-background" />
          )}
        </div>
      </div>
      <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_320px]">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">
            {d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {" · "}
            {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </div>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{e.title}</h1>
          {e.tagline && <p className="mt-3 text-lg text-muted-foreground">{e.tagline}</p>}
          {e.description && (
            <p className="mt-6 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
              {e.description}
            </p>
          )}
        </div>
        <aside className="space-y-4">
          <InfoRow label="Venue" value={e.venue_name} />
          {e.address && <InfoRow label="Address" value={e.address} />}
          {e.city && <InfoRow label="City" value={e.city} />}
          {e.dress_code && <InfoRow label="Dress code" value={e.dress_code} />}
          {e.theme && <InfoRow label="Theme" value={e.theme} />}
          {typeof e.capacity === "number" && <InfoRow label="Capacity" value={String(e.capacity)} />}
          <InfoRow
            label="Entry"
            value={e.ticket_price_cents > 0 ? `$${(e.ticket_price_cents / 100).toFixed(2)}` : "Free with RSVP"}
          />
          <div className="pt-2">
            {authed ? (
              <RsvpBox eventId={e.id} />
            ) : (
              <Link
                to="/auth"
                search={{ next: `/events/${e.id}` }}
                className="block w-full rounded-md bg-primary py-3 text-center text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
              >
                Sign in to RSVP
              </Link>
            )}
          </div>
          {userId && e.host_id === userId && (
            <Link
              to="/events/$id/checkin"
              params={{ id: e.id }}
              className="block w-full rounded-md border border-neon/40 bg-neon/10 py-3 text-center text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
            >
              Door check-in →
            </Link>
          )}
        </aside>
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

const DEFAULT_WAIVER = `LIABILITY WAIVER, ASSUMPTION OF RISK & RELEASE

By entering the event, I acknowledge that attendance is voluntary and involves inherent risks, including but not limited to physical contact, adult-themed performances, alcohol service, and interaction with other adult guests. I confirm I am at least 18 years old.

I assume all risk of personal injury, illness, or property loss arising from my participation. I release and hold harmless the host, venue, performers, staff, and other guests from any and all claims arising from my attendance, except in cases of gross negligence or wilful misconduct.

I agree to abide by the house rules, respect consent at all times, and follow all reasonable instructions from staff. I understand I may be removed without refund for violating these terms.

I confirm the video / photography preferences I selected are accurate and consent to their enforcement by staff.`;

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function RsvpBox({ eventId }: { eventId: string }) {
  const event = Route.useLoaderData();
  const waiverText = ((event as any)?.waiver_text ?? DEFAULT_WAIVER).trim();

  const qc = useQueryClient();
  const getMy = useServerFn(myRsvpForEvent);
  const getAge = useServerFn(getMyAgeVerification);
  const rsvpFn = useServerFn(rsvpToEvent);
  const cancelFn = useServerFn(cancelRsvp);
  const router = useRouter();
  const pdf = useWaiverPdfDownload();

  const { data: mine } = useQuery({
    queryKey: ["my-rsvp", eventId],
    queryFn: () => getMy({ data: { event_id: eventId } }),
  });
  const { data: age, isLoading: ageLoading } = useQuery({
    queryKey: ["my-age-verification"],
    queryFn: () => getAge(),
  });
  const getScreenings = useServerFn(listMyHealthScreenings);
  const { data: screenings, isLoading: screeningsLoading } = useQuery({
    queryKey: ["my-health-screenings"],
    queryFn: () => getScreenings(),
  });

  const [ageOk, setAgeOk] = useState(false);
  const [waiverOk, setWaiverOk] = useState(false);
  const [signature, setSignature] = useState("");
  const [showWaiver, setShowWaiver] = useState(false);
  const [consent, setConsent] = useState<VideoConsent>({
    private_archive: false,
    public_promo: false,
    face_blurred_only: false,
    no_filming: true,
  });
  const [complianceOk, setComplianceOk] = useState(false);

  const rsvp = useMutation({
    mutationFn: async () => {
      const hash = await sha256Hex(waiverText);
      return rsvpFn({
        data: {
          event_id: eventId,
          guest_count: 1,
          age_confirmed: true,
          video_consent: consent,
          waiver_accepted: true,
          waiver_signature: signature.trim(),
          waiver_text_hash: hash,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`Confirmed! Entry code ${r.entry_code}`);
      qc.invalidateQueries({ queryKey: ["my-rsvp", eventId] });
      router.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { event_id: eventId } }),
    onSuccess: () => {
      toast.success("RSVP cancelled");
      qc.invalidateQueries({ queryKey: ["my-rsvp", eventId] });
    },
  });

  if (mine) {
    const signed = Boolean(mine.waiver_signature && mine.waiver_accepted_at);
    return (
      <div className="rounded-lg border border-primary/50 bg-primary/10 p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-primary">RSVP confirmed · Entry code</div>
        <div className="mt-1 font-mono text-3xl font-bold tracking-widest text-neon">
          {mine.entry_code}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Show this Entry Code at the door.{" "}
          <span className="opacity-70">Scan code: <span className="font-mono">{mine.ticket_code}</span></span>
        </p>

        <div
          className={
            "mt-3 rounded-md border p-3 " +
            (signed
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-amber-500/40 bg-amber-500/10")
          }
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]">
            <StatusDot ok={signed} />
            <span className={signed ? "text-emerald-300" : "text-amber-300"}>
              {signed ? "Waiver accepted & signed" : "Waiver not on file"}
            </span>
          </div>
          {signed ? (
            <>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Signed as <span className="text-foreground">{mine.waiver_signature}</span> on{" "}
                {new Date(mine.waiver_accepted_at!).toLocaleDateString()}. Your entry is
                cleared.
              </p>
              <button
                type="button"
                onClick={() => pdf.download(mine.id)}
                disabled={pdf.isPending(mine.id)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-widest text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {pdf.isPending(mine.id) ? "Preparing…" : "Download signed waiver (PDF)"}
              </button>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Cancel and re-RSVP to sign the current waiver — required at the door.
            </p>
          )}
        </div>

        <button
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="mt-4 w-full rounded-md border border-border py-2 text-xs uppercase tracking-widest hover:bg-destructive/20"
        >
          {cancel.isPending ? "…" : "Cancel RSVP"}
        </button>
      </div>
    );
  }

  if (ageLoading) return <div className="h-24 animate-pulse rounded-lg bg-card" />;

  if (!age || age.status !== "approved") {
    const label =
      !age ? "Verify your age" :
      age.status === "pending" ? "ID under review" :
      "Resubmit ID";
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-primary">18+ only</div>
        <p className="text-sm text-muted-foreground">
          {!age
            ? "Every event requires ID on file. It only takes a minute."
            : age.status === "pending"
            ? "Your ID is being reviewed — you'll be able to RSVP once it's approved."
            : `Your last submission wasn't accepted${age.notes ? `: ${age.notes}` : "."}`}
        </p>
        <Link
          to="/verify"
          className="block w-full rounded-md bg-primary py-3 text-center text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)]"
        >
          {label}
        </Link>
      </div>
    );
  }

  if (screeningsLoading) return <div className="h-24 animate-pulse rounded-lg bg-card" />;

  const screeningList = screenings ?? [];
  const screeningCurrent = isScreeningCurrent(screeningList);
  const latestScreening = screeningList[0];

  const toggle = (key: keyof VideoConsent) => (v: boolean) => {
    setConsent((c) => {
      const next = { ...c, [key]: v };
      // "No filming" is exclusive
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

  const canSubmit = ageOk && waiverOk && complianceOk && screeningCurrent && signature.trim().length >= 2 && !rsvp.isPending;

  const waiverRead = showWaiver || waiverOk;
  const waiverSigned = signature.trim().length >= 2;
  const waiverComplete = waiverOk && waiverSigned;

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <ScreeningGate
        current={screeningCurrent}
        latestStatus={latestScreening?.status ?? null}
        validUntil={latestScreening?.valid_until ?? null}
      />
      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Waiver status
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <StatusChip label="Read" ok={waiverRead} />
          <StatusChip label="Accepted" ok={waiverOk} />
          <StatusChip label="Signed" ok={waiverSigned} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {waiverComplete
            ? "Waiver ready — you can confirm your RSVP."
            : "Read, accept, and sign below before confirming."}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ageOk}
          onChange={(e) => setAgeOk(e.target.checked)}
          className="mt-1"
        />
        <span>I confirm I am 18+ and my ID on file is current.</span>
      </label>

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-primary">Video consent</div>
        <div className="space-y-1.5 text-sm">
          <Check label="Private archive only (Princess Pink's records)" checked={consent.private_archive} onChange={toggle("private_archive")} />
          <Check label="OK to use in public promo / social" checked={consent.public_promo} onChange={toggle("public_promo")} />
          <Check label="Only if my face is blurred" checked={consent.face_blurred_only} onChange={toggle("face_blurred_only")} />
          <Check label="Do not film me at all" checked={consent.no_filming} onChange={toggle("no_filming")} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Door team is briefed on your choices. You can change them by re-RSVPing before the event.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary">Liability waiver</div>
            <span
              className={
                "rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest " +
                (waiverComplete
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300")
              }
            >
              {waiverComplete ? "Ready to sign" : "Action needed"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowWaiver((v) => !v)}
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            {showWaiver ? "Hide" : "Read full waiver"}
          </button>
        </div>
        {showWaiver && (
          <div className="max-h-56 overflow-auto rounded-md border border-border/50 bg-background p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {waiverText}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={waiverOk}
            onChange={(e) => setWaiverOk(e.target.checked)}
            className="mt-1"
          />
          <span>
            I have read and accept the liability waiver, assumption of risk & release.
            {!showWaiver && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setShowWaiver(true)}
                  className="text-primary underline underline-offset-2"
                >
                  Read it
                </button>
                .
              </>
            )}
          </span>
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Type your full legal name to sign
          </div>
          <input
            type="text"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="e.g. Alex Rivera"
            maxLength={120}
            autoComplete="off"
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-serif italic text-base focus:border-primary focus:outline-none"
          />
          {signature.trim().length > 0 && signature.trim().length < 2 && (
            <p className="mt-1 text-[11px] text-red-400">Please type your full name.</p>
          )}
        </label>
      </div>

      <ConsentCompliance checked={complianceOk} onChange={setComplianceOk} />

      <button
        onClick={() => rsvp.mutate()}
        disabled={!canSubmit}
        title={
          !canSubmit
            ? !screeningCurrent
              ? "Upload a current admin-approved health screening to finalize your RSVP."
              : "Confirm age, accept the waiver and code of conduct, and sign your name to RSVP."
            : undefined
        }
        className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-50"
      >
        {rsvp.isPending ? "Confirming…" : "Sign & RSVP · Reserve entry"}
      </button>
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

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={
        "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold " +
        (ok ? "bg-emerald-500/25 text-emerald-300" : "bg-amber-500/25 text-amber-300")
      }
    >
      {ok ? "✓" : "!"}
    </span>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-1.5 rounded-md border px-2 py-1.5 " +
        (ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-amber-500/30 bg-amber-500/5 text-amber-200/80")
      }
    >
      <StatusDot ok={ok} />
      <span className="uppercase tracking-widest text-[10px]">{label}</span>
    </div>
  );
}



function ScreeningGate({
  current,
  latestStatus,
  validUntil,
}: {
  current: boolean;
  latestStatus: "pending" | "approved" | "rejected" | null;
  validUntil: string | null;
}) {
  if (current) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2">
          <StatusDot ok />
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-300">
            Health screening cleared
          </div>
        </div>
        {validUntil && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Admin-approved, valid until {validUntil}.
          </p>
        )}
      </div>
    );
  }

  const { headline, body, cta } =
    latestStatus === "pending"
      ? {
          headline: "Health screening — awaiting admin review",
          body:
            "Your uploaded document is queued for manual admin approval. You'll be able to finalize your RSVP once it's approved.",
          cta: "View screening",
        }
      : latestStatus === "rejected"
      ? {
          headline: "Health screening was not accepted",
          body:
            "Your most recent submission was rejected. Upload a current document (test taken within the last 90 days) so an admin can approve it.",
          cta: "Upload a new screening",
        }
      : latestStatus === "approved"
      ? {
          headline: "Health screening expired",
          body:
            "Your approved screening is more than 90 days old. Upload a current document so an admin can review it.",
          cta: "Upload a current screening",
        }
      : {
          headline: "Health screening required",
          body:
            "You must upload a valid STD screening (test within the last 90 days) before you can finalize an RSVP. An admin manually reviews and approves each document.",
          cta: "Upload screening",
        };

  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <StatusDot ok={false} />
        <div className="text-[10px] uppercase tracking-[0.25em] text-destructive">
          {headline}
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{body}</p>
      <Link
        to="/verify"
        className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-primary py-2 text-[11px] font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
      >
        {cta}
      </Link>
    </div>
  );
}
