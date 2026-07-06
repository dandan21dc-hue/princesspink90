// Lightweight click/event tracking. Pushes to window.dataLayer (GA4 / GTM
// convention) when present, and always dispatches a CustomEvent on window so
// other listeners (or tests) can hook in. Safe no-op if no analytics loaded.
//
// A whitelist of events (tier clicks, checkout completions) is also persisted
// to the analytics_events table via a fire-and-forget server function so the
// admin analytics page can show counts and conversion rates.

import { logAnalyticsEvent } from "@/lib/analytics.functions";

// Accept `null` alongside `undefined` so call sites can pass optional values
// (e.g. `currentPlan ?? null`) without a type error; both are stripped from
// the emitted payload so downstream consumers only see defined scalars.
export type TrackProps = Record<string, string | number | boolean | null | undefined>;
type EmittedProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

const PERSISTED_EVENTS = new Set([
  "boutique_tier_click",
  "all_access_tier_click",
  "checkout_completed",
]);

export function track(event: string, props: TrackProps = {}): void {
  if (typeof window === "undefined") return;
  const payload = { event, ...props, ts: Date.now() };
  const clean: EmittedProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    clean[k] = v;
  }
  const payload = { event, ...clean, ts: Date.now() };
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent("app:track", { detail: payload }));
  } catch {
    // never let tracking break the UI
  }

  if (PERSISTED_EVENTS.has(event)) {
    const plan =
      typeof props.plan === "string"
        ? props.plan
        : typeof props.plan_id === "string"
          ? (props.plan_id as string)
          : null;
    const action = typeof props.action === "string" ? props.action : null;
    const tierKind = typeof props.tier_kind === "string" ? props.tier_kind : null;
    const sessionId = typeof props.session_id === "string" ? props.session_id : null;
    // fire-and-forget; never surface errors to the UI
    void logAnalyticsEvent({
      data: {
        event,
        plan,
        action,
        tier_kind: tierKind,
        session_id: sessionId,
        props: payload,
      },
    }).catch(() => {});
  }
}
