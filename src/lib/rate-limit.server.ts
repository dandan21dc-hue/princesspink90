/**
 * Simple in-memory rate limiter for public API endpoints.
 *
 * This is a basic rate limiter suitable for Cloudflare Workers deployments.
 * For production with multiple instances, consider using Redis or a distributed cache.
 *
 * ## Usage
 *
 * ```typescript
 * import { rateLimitByIp } from "@/lib/rate-limit.server";
 *
 * export async function GET(request: Request) {
 *   const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
 *   const limit = rateLimitByIp(clientIp, { maxRequests: 10, windowMs: 60_000 });
 *
 *   if (!limit.allowed) {
 *     return new Response("Too Many Requests", {
 *       status: 429,
 *       headers: {
 *         "Retry-After": String(Math.ceil(limit.resetInMs / 1000)),
 *       },
 *     });
 *   }
 *
 *   // Handle request...
 * }
 * ```
 */

interface RateLimitOptions {
  /** Maximum number of requests allowed per window. Default: 30 */
  maxRequests?: number;
  /** Time window in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number;
}

interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** Milliseconds until the window resets. */
  resetInMs: number;
}

/**
 * In-memory store of request counts keyed by identifier and time window.
 * Format: `${key}:${windowStart}` => count
 */
const store = new Map<string, { count: number; expiresAt: number }>();

/**
 * Rate limit by a string identifier (IP, user ID, API key, etc.).
 *
 * Requests within the same time window increment a counter.
 * Expired entries are cleaned up on access.
 */
export function rateLimit(
  key: string,
  options: RateLimitOptions = {},
): RateLimitResult {
  const maxRequests = options.maxRequests ?? 30;
  const windowMs = options.windowMs ?? 60_000;

  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const storeKey = `${key}:${windowStart}`;

  // Clean up expired entries (and the next window's entry if it exists).
  store.forEach((val, k) => {
    if (val.expiresAt < now) store.delete(k);
  });

  let entry = store.get(storeKey);
  if (!entry) {
    entry = { count: 0, expiresAt: windowStart + windowMs * 2 };
    store.set(storeKey, entry);
  }

  entry.count++;

  const allowed = entry.count <= maxRequests;
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetInMs = Math.max(0, entry.expiresAt - now);

  return { allowed, remaining, resetInMs };
}

/**
 * Rate limit by client IP address.
 * Assumes Cloudflare Workers context where `cf-connecting-ip` is set.
 * Falls back to "unknown" if the header is missing.
 */
export function rateLimitByIp(
  request: Request,
  options: RateLimitOptions = {},
): RateLimitResult {
  const clientIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return rateLimit(clientIp, options);
}

/**
 * Rate limit by a custom key (e.g., user ID, API key).
 * Same as `rateLimit` but with a clearer name for explicit key-based limiting.
 */
export function rateLimitByKey(
  key: string,
  options: RateLimitOptions = {},
): RateLimitResult {
  return rateLimit(key, options);
}
