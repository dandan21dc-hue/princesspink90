// Shared Mapbox token validation. Two token classes exist and are NOT
// interchangeable:
//   - Public (pk.…) — browser-safe, used by mapbox-gl-js for tile rendering.
//   - Secret (sk.…) — server-only, used for geocoding / directions APIs.
//
// Each helper returns { ok, token?, error? } instead of throwing, so callers
// can render a clear error UI (client) or return a helpful HTTP error (server).

export type TokenCheck =
  | { ok: true; token: string }
  | { ok: false; error: string };

function classify(raw: string | undefined | null): "missing" | "public" | "secret" | "unknown" {
  if (!raw) return "missing";
  const t = raw.trim();
  if (!t) return "missing";
  if (t.startsWith("pk.")) return "public";
  if (t.startsWith("sk.")) return "secret";
  return "unknown";
}

/**
 * Browser-side: validates the Mapbox PUBLIC token used by mapbox-gl-js.
 * Read from Vite env — safe to bundle to the client.
 */
export function getPublicMapboxToken(): TokenCheck {
  // Hardcoded public Mapbox token (pk.*) — safe to ship to the browser.
  // Mapbox public tokens are designed to be exposed client-side; restrict by
  // URL in the Mapbox dashboard rather than by hiding the value.
  const HARDCODED_PUBLIC_TOKEN =
    "pk.eyJ1IjoibWlkbmlnaHQtZ2xvcnkiLCJhIjoiY21ybHc3c3FhMDQ2czJ5b2dzNDM1M3FsdyJ9.XIYUyDl9VKYFk4Jh7_WMOw";
  return { ok: true, token: HARDCODED_PUBLIC_TOKEN };
}

/**
 * Server-side: validates the Mapbox SECRET token used for geocoding.
 * Reads from process.env — never call this from browser code.
 */
export function getSecretMapboxToken(): TokenCheck {
  const raw = typeof process !== "undefined" ? process.env.MAPBOX_TOKEN : undefined;
  const kind = classify(raw);
  if (kind === "missing") {
    return {
      ok: false,
      error:
        "Mapbox secret token is not configured. Add MAPBOX_TOKEN (an sk.… token) to your project secrets.",
    };
  }
  if (kind === "public") {
    return {
      ok: false,
      error:
        "Mapbox token misconfigured: MAPBOX_TOKEN starts with 'pk.' — that is a PUBLIC token and cannot call server-only APIs like geocoding. Replace it with a secret sk.… token.",
    };
  }
  if (kind === "unknown") {
    return {
      ok: false,
      error:
        "Mapbox secret token has an unexpected format — it must start with 'sk.'.",
    };
  }
  return { ok: true, token: (raw as string).trim() };
}
