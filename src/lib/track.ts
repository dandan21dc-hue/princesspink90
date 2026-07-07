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
  // Panty checkout funnel — persisted so the admin reconciliation page
  // can rebuild the start → confirmed/pending/cancelled trail per
  // client_order_ref.
  "panty_checkout_start",
  "panty_checkout_started",
  "panty_checkout_confirmed",
  "panty_checkout_pending",
  "panty_checkout_cancelled",
  "stripe_checkout_return_failed",
]);

export function track(event: string, props: TrackProps = {}): void {
  if (typeof window === "undefined") return;
  
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
    const sessionId =
      typeof props.session_id === "string" && props.session_id
        ? props.session_id
        : getOrCreateSessionId();
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

// Per-tab UUID used as a rate-limit key on the server. Kept in sessionStorage
// so the same tab reuses one id across navigations without following the user
// across tabs (making volumetric abuse from a single origin easier to bound).
function getOrCreateSessionId(): string {
  try {
    const KEY = "app:analytics_session_id";
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : // Fallback: RFC4122-ish v4 from Math.random (only when crypto is unavailable).
          "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    window.sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage disabled — still return a valid UUID so the server accepts the event.
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000000";
  }
}
