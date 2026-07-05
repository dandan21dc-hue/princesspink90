import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getPublicEventById } from "@/lib/events.functions";
import { rsvpToEvent, cancelRsvp, myRsvpForEvent } from "@/lib/rsvp.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
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

function RsvpBox({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const getMy = useServerFn(myRsvpForEvent);
  const rsvpFn = useServerFn(rsvpToEvent);
  const cancelFn = useServerFn(cancelRsvp);
  const router = useRouter();
  const { data: mine } = useQuery({
    queryKey: ["my-rsvp", eventId],
    queryFn: () => getMy({ data: { event_id: eventId } }),
  });
  const rsvp = useMutation({
    mutationFn: () => rsvpFn({ data: { event_id: eventId, guest_count: 1 } }),
    onSuccess: (r) => {
      toast.success(`Confirmed! Ticket ${r.ticket_code}`);
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
    return (
      <div className="rounded-lg border border-primary/50 bg-primary/10 p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-primary">You're in</div>
        <div className="mt-1 font-mono text-2xl font-bold tracking-widest text-neon">
          {mine.ticket_code}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Show this code at the door.</p>
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

  return (
    <button
      onClick={() => rsvp.mutate()}
      disabled={rsvp.isPending}
      className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-60"
    >
      {rsvp.isPending ? "Confirming…" : "RSVP · Reserve entry"}
    </button>
  );
}
