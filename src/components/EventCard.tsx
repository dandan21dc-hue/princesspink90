import { Link } from "@tanstack/react-router";

type EventLike = {
  id: string;
  title: string;
  tagline?: string | null;
  venue_name: string;
  city?: string | null;
  starts_at: string;
  cover_image_url?: string | null;
  dress_code?: string | null;
  theme?: string | null;
};

export function EventCard({ event }: { event: EventLike }) {
  const d = new Date(event.starts_at);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <Link
      to="/events/$id"
      params={{ id: event.id }}
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card transition hover:border-primary/60 hover:shadow-[var(--shadow-glow-pink)]"
    >
      <div className="aspect-[4/5] w-full overflow-hidden bg-secondary/30">
        {event.cover_image_url ? (
          <img
            src={event.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/30 via-accent/20 to-background" />
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.25em] text-primary">
          <span>{day}</span><span className="opacity-40">·</span><span>{time}</span>
        </div>
        <h3 className="mt-2 font-display text-xl font-semibold leading-tight">{event.title}</h3>
        {event.tagline && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.tagline}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{event.venue_name}{event.city ? `, ${event.city}` : ""}</span>
          {event.dress_code && (
            <span className="rounded-full border border-border/60 px-2 py-0.5">{event.dress_code}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
