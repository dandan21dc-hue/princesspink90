// Lightweight click/event tracking. Pushes to window.dataLayer (GA4 / GTM
// convention) when present, and always dispatches a CustomEvent on window so
// other listeners (or tests) can hook in. Safe no-op if no analytics loaded.

type TrackProps = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function track(event: string, props: TrackProps = {}): void {
  if (typeof window === "undefined") return;
  const payload = { event, ...props, ts: Date.now() };
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent("app:track", { detail: payload }));
  } catch {
    // never let tracking break the UI
  }
}
