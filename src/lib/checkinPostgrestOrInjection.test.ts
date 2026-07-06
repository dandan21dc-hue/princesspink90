/**
 * Regression guard for the `postgrest_or_injection` security finding.
 *
 * The original vulnerability interpolated user-supplied `ticket_code`
 * into a PostgREST `.or()` filter string, which let a caller inject
 * extra clauses / wildcards. The fix routes every lookup through
 * parameterised `.eq()` / `.ilike()` builder calls.
 *
 * This test fails the build if either:
 *   1. `checkin.functions.ts` starts using `.or(` again, or
 *   2. Somebody adds `postgrest_or_injection` to the Supabase linter
 *      allowlist (which would silently re-permit the finding in CI).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("postgrest_or_injection regression guard", () => {
  it("checkin.functions.ts does not use PostgREST .or() filters", () => {
    const src = readFileSync(
      resolve(__dirname, "checkin.functions.ts"),
      "utf8",
    );
    // Strip line + block comments so documentation mentioning `.or(`
    // can't accidentally satisfy or trip the check.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(stripped).not.toMatch(/\.or\s*\(/);
  });

  it("Supabase linter allowlist does not silence postgrest_or_injection", () => {
    const ci = readFileSync(
      resolve(__dirname, "../../.github/workflows/ci.yml"),
      "utf8",
    );
    // The allowlist is passed via the SUPABASE_LINT_ALLOWLIST env var,
    // either from repo `vars` or inline. Guard against either shape
    // sneaking the finding name into the ignore list.
    expect(ci).not.toMatch(/postgrest_or_injection/i);
  });
});
