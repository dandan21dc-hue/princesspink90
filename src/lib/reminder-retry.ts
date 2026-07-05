/**
 * Exponential backoff schedule for reminder delivery retries.
 *
 * Attempt 1 fails → schedule attempt 2 in ~1min
 * Attempt 2 fails → schedule attempt 3 in ~2min
 * Attempt 3 fails → schedule attempt 4 in ~4min
 * Attempt 4 fails → schedule attempt 5 in ~8min
 * Attempt 5 fails → no further retry (stays 'failed' — admin visible).
 *
 * Capped at 60 minutes with ±20% jitter so many rows failing at the same time
 * don't retry in lockstep.
 */
export function computeNextRetryAt(attemptCount: number): Date | null {
  const MAX_ATTEMPTS = 5;
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const baseSeconds = 60; // 1 minute base
  const capSeconds = 60 * 60; // 60 minutes cap
  const delaySeconds = Math.min(
    capSeconds,
    baseSeconds * Math.pow(2, attemptCount - 1),
  );
  const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20%
  const finalMs = Math.round(delaySeconds * jitter * 1000);
  return new Date(Date.now() + finalMs);
}

export const DEFAULT_MAX_ATTEMPTS = 5;
