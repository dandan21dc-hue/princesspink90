import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

/** Retry policy — 429 and 5xx are retryable, everything else is terminal. */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}

async function callGsc(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; attempts: number }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gscKey = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lovableKey || !gscKey) {
    throw new Error(
      "Google Search Console is not connected. Link the connector before submitting sitemaps.",
    );
  }

  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${GATEWAY}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": gscKey,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      // Network / DNS / abort — treat as retryable.
      lastStatus = 0;
      lastBody = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS));
      continue;
    }

    lastStatus = res.status;
    lastBody = await res.text();

    if (res.ok) return { status: res.status, body: lastBody, attempts: attempt };
    if (!isRetryable(res.status)) {
      return { status: res.status, body: lastBody, attempts: attempt };
    }

    if (attempt === MAX_ATTEMPTS) break;
    // Respect Retry-After when present, otherwise exponential backoff with jitter.
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    const jitter = Math.floor(Math.random() * 250);
    await sleep(backoff + jitter);
  }

  return { status: lastStatus, body: lastBody, attempts: MAX_ATTEMPTS };
}

/**
 * Submit (or resubmit) the project sitemap to Google Search Console with
 * automatic retries. Retries transient failures (network errors, 429, 5xx)
 * up to MAX_ATTEMPTS with exponential backoff; 4xx errors return immediately
 * so the caller can fix the request.
 *
 * Admin-only.
 */
export const submitSitemapToGsc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { siteUrl: string; sitemapUrl: string }) => {
    if (!/^https:\/\/.+\/$/.test(input.siteUrl)) {
      throw new Error("siteUrl must be an https URL with a trailing slash, e.g. https://example.com/");
    }
    if (!/^https:\/\/.+\.xml$/.test(input.sitemapUrl)) {
      throw new Error("sitemapUrl must be an https URL ending in .xml");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const site = encodeURIComponent(data.siteUrl);
    const sitemap = encodeURIComponent(data.sitemapUrl);
    const result = await callGsc(
      `/webmasters/v3/sites/${site}/sitemaps/${sitemap}`,
      { method: "PUT" },
    );

    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      attempts: result.attempts,
      body: result.body,
      siteUrl: data.siteUrl,
      sitemapUrl: data.sitemapUrl,
    };
  });
