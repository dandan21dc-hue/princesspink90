/**
 * Server-side error detection for h3/Nitro SSR errors.
 *
 * h3 catches exceptions raised in handlers and converts them to generic 500
 * responses with a normalized error body: `{ unhandled: true, message: "HTTPError" }`.
 * This makes the original error stack invisible to the client.
 *
 * This module uses the global error events to capture errors out-of-band so that
 * the server's main fetch handler can retrieve the stack trace and render a
 * proper error page (instead of sending raw JSON).
 *
 * ## How it works
 *
 * 1. Global error and unhandledrejection listeners record the error with a timestamp.
 * 2. server.ts calls `consumeLastCapturedError()` when it detects an h3-swallowed response.
 * 3. If an error was recorded recently (< 5s), it's returned; otherwise, a fallback error is used.
 * 4. The error is logged and a proper HTML error page is rendered.
 *
 * ## TTL
 *
 * Captured errors are kept for 5 seconds to prevent stale errors from being matched
 * to unrelated requests in high-concurrency scenarios.
 */

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown): void {
  lastCapturedError = { error, at: Date.now() };
}

// Only register listeners in the browser or Worker environment.
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event: Event) => {
    record(((event as ErrorEvent).error ?? event) as unknown);
  });
  globalThis.addEventListener("unhandledrejection", (event: Event) => {
    record(((event as PromiseRejectionEvent).reason) as unknown);
  });
}

/**
 * Retrieve the most recently captured error, if it's still fresh.
 * Errors older than TTL_MS are discarded.
 * Consuming an error clears it from the cache.
 */
export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
