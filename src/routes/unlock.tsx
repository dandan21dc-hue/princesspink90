import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { unlockEventByCode } from "@/lib/events.functions";

export const Route = createFileRoute("/unlock")({
  head: () => ({
    meta: [
      { title: "Enter your code · AFTERDARK" },
      { name: "description", content: "Unlock a private invitation with your access code." },
    ],
  }),
  component: Unlock,
});

function Unlock() {
  const unlockFn = useServerFn(unlockEventByCode);
  const [code, setCode] = useState("");
  const m = useMutation({
    mutationFn: (c: string) => unlockFn({ data: { code: c } }),
  });

  return (
    <section className="mx-auto max-w-md px-5 py-20">
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Private invitation</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Enter your code.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Codes are one line, case-insensitive. Ask your host if you don't have one.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); m.mutate(code.trim().toUpperCase()); }}
          className="mt-6 space-y-3"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="AFTERDARK-XXXX"
            className="w-full rounded-md border border-input bg-background px-4 py-3 font-mono text-lg tracking-widest text-center uppercase focus:border-primary focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={m.isPending || code.trim().length < 3}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-50"
          >
            {m.isPending ? "Unlocking…" : "Unlock"}
          </button>
        </form>

        {m.data && !m.data.ok && (
          <p className="mt-4 rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive-foreground">
            That code doesn't match any active invitation.
          </p>
        )}

        {m.data?.ok && m.data.event && (
          <div className="mt-6 rounded-xl border border-primary/50 bg-primary/5 p-5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary">You're on the list</div>
            <h2 className="mt-1 font-display text-2xl font-semibold">{m.data.event.title}</h2>
            {m.data.event.tagline && (
              <p className="mt-1 text-sm text-muted-foreground">{m.data.event.tagline}</p>
            )}
            <div className="mt-3 text-sm">
              <div>
                {new Date(m.data.event.starts_at).toLocaleString(undefined, {
                  weekday: "long", day: "numeric", month: "long",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>
              <div className="text-muted-foreground">
                {m.data.event.venue_name}{m.data.event.city ? `, ${m.data.event.city}` : ""}
              </div>
              {m.data.event.address && (
                <div className="text-muted-foreground">{m.data.event.address}</div>
              )}
              {m.data.event.dress_code && (
                <div className="mt-2 inline-block rounded-full border border-border/60 px-2 py-0.5 text-xs">
                  Dress code: {m.data.event.dress_code}
                </div>
              )}
            </div>
            {m.data.event.description && (
              <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/90">
                {m.data.event.description}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
