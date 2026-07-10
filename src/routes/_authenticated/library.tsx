import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getMyLibrary, signMediaUrl } from "@/lib/store.functions";
import { getMyMembership, requestPrivateSession } from "@/lib/memberships.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({ meta: [{ title: "My library — Midnight Glory" }] }),
  component: LibraryPage,
});

type MediaEntry = { url: string; type: "image" | "video" };

function LibraryPage() {
  const libFn = useServerFn(getMyLibrary);
  const memFn = useServerFn(getMyMembership);
  const { data, isLoading } = useQuery({ queryKey: ["my-library"], queryFn: () => libFn() });
  const mem = useQuery({ queryKey: ["my-membership"], queryFn: () => memFn() });
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-8 pb-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Your library</div>
            <h1 className="mt-2 font-display text-3xl font-semibold">Unlocked collection</h1>
            {mem.data?.membership ? (
              <p className="mt-2 text-xs uppercase tracking-widest text-primary">💎 Lifetime member</p>
            ) : data?.hasSubscription ? (
              <p className="mt-2 text-xs uppercase tracking-widest text-neon">All-Access active</p>
            ) : null}
          </div>
          <Link
            to="/store"
            className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-widest hover:bg-secondary/40"
          >
            Browse store
          </Link>
        </div>

        {mem.data?.membership && <LifetimePerks membership={mem.data.membership} />}

        {isLoading ? (
          <div className="mt-10 text-sm text-muted-foreground">Loading…</div>
        ) : !data?.items.length ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border/60 p-16 text-center">
            <p className="font-display text-lg">Nothing unlocked yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              <Link to="/store" className="underline">Visit the store</Link> to buy an item or subscribe.
            </p>
          </div>
        ) : (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <li key={item.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <div className="aspect-[4/5] bg-secondary/30">
                  {item.cover_url ? (
                    <img src={item.cover_url} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="p-4">
                  <div className="truncate font-medium">{item.title}</div>
                  <button
                    onClick={() => setOpenItemId(item.id)}
                    className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
                  >
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openItemId && (
        <MediaViewer
          item={data!.items.find((i) => i.id === openItemId)!}
          onClose={() => setOpenItemId(null)}
        />
      )}
    </>
  );
}

function MediaViewer({
  item,
  onClose,
}: {
  item: { id: string; title: string; media_urls: unknown; kind: string };
  onClose: () => void;
}) {
  const signFn = useServerFn(signMediaUrl);
  const rawMedia = Array.isArray(item.media_urls) ? (item.media_urls as MediaEntry[]) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border/60 bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg">{item.title}</div>
          <button onClick={onClose} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">Close</button>
        </div>
        {rawMedia.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No media uploaded yet.</div>
        ) : (
          <div className="space-y-4">
            {rawMedia.map((m, i) => (
              <MediaTile key={i} media={m} itemId={item.id} signFn={signFn} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaTile({
  media,
  itemId,
  signFn,
}: {
  media: MediaEntry;
  itemId: string;
  signFn: (args: any) => Promise<any>;
}) {
  // If it's an http(s) URL, use directly; if it looks like a storage path, sign it.
  const isRemote = /^https?:\/\//i.test(media.url);
  const { data, isLoading } = useQuery({
    queryKey: ["signed-url", itemId, media.url],
    queryFn: () => (isRemote ? Promise.resolve({ url: media.url }) : signFn({ data: { path: media.url, contentItemId: itemId } })),
  });

  if (isLoading) return <div className="h-40 rounded bg-secondary/40 animate-pulse" />;
  const url = data?.url;
  if (!url) return null;
  return media.type === "video" ? (
    <video src={url} controls className="w-full rounded-lg" controlsList="nodownload" />
  ) : (
    <img src={url} alt="" className="w-full rounded-lg" />
  );
}

function LifetimePerks({ membership }: { membership: any }) {
  const qc = useQueryClient();
  const reqFn = useServerFn(requestPrivateSession);
  const request = useMutation({
    mutationFn: () => reqFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-membership"] }),
  });

  const kind: string = membership.kind ?? "lifetime";
  const isLifetime = kind === "lifetime";
  const isTerm12 = kind === "term_pass_12";
  const ticketUsed = !!membership.event_ticket_used_at;
  const sessionRequested = !!membership.private_session_requested_at;
  const sessionFulfilled = !!membership.private_session_fulfilled_at;

  const headerLabel = isLifetime
    ? "Lifetime perks"
    : isTerm12
      ? "12-month pass perks"
      : "Membership perks";
  const ticketHelper = ticketUsed
    ? "Redeemed. Thanks for coming!"
    : isTerm12
      ? "Redeemed automatically when you RSVP to any event during your 12-month pass."
      : "Redeemed automatically when you RSVP to any event.";

  return (
    <div className="mt-6 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-5">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">{headerLabel}</div>
      <div className={`mt-4 grid gap-4 ${isLifetime ? "sm:grid-cols-2" : ""}`}>
        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="font-medium">🎟️ Free event ticket</div>
          <p className="mt-1 text-xs text-muted-foreground">{ticketHelper}</p>
          {!ticketUsed && (
            <Link
              to="/"
              className="mt-3 inline-block rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              Browse events
            </Link>
          )}
        </div>
        {isLifetime && (
        <div className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="font-medium">
            🔥 Private session{" "}
            <span className="text-xs text-muted-foreground">
              ({membership.private_session_duration_minutes ?? 30} min · no anal)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {sessionFulfilled
              ? membership.private_session_bundle_granted_at
                ? "Fulfilled — your photo/video bundle is unlocked below."
                : "Fulfilled."
              : sessionRequested
                ? "Request sent — I'll reach out to schedule."
                : `One-time perk: a ${membership.private_session_duration_minutes ?? 30}-minute private session plus a picture & video bundle delivered afterwards. Press below and I'll DM you to schedule.`}
          </p>
          {membership.private_session_bundle_id && membership.private_session_bundle_granted_at && (
            <Link
              to="/store/$id"
              params={{ id: membership.private_session_bundle_id }}
              className="mt-3 inline-block rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              View your bundle
            </Link>
          )}
          {!sessionRequested && (
            <button
              onClick={() => request.mutate()}
              disabled={request.isPending}
              className="mt-3 ml-2 rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
            >
              {request.isPending ? "Sending…" : "Request session"}
            </button>
          )}
          {request.isError && (
            <p className="mt-2 text-xs text-destructive">
              {(request.error as Error).message}
            </p>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
