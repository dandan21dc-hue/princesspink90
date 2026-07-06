#!/usr/bin/env node
/**
 * Runs the Supabase database linter (same checks surfaced in the
 * Lovable Cloud security panel) against the linked project and fails
 * CI on any WARN or ERROR finding that isn't already recorded in the
 * baseline at security/lint-baseline.json.
 *
 * Required env:
 *   SUPABASE_ACCESS_TOKEN   Personal access token (repo secret)
 *   SUPABASE_PROJECT_REF    Project ref, e.g. bxwwrlhtgrqbsgbmaxgq
 *
 * Optional env:
 *   SUPABASE_LINT_ALLOWLIST Comma-separated lint `name`s to ignore
 *                           unconditionally (legacy — prefer baseline).
 *
 * Flags:
 *   --update-baseline       Rewrite security/lint-baseline.json from the
 *                           current WARN/ERROR findings instead of diffing.
 *                           Review the resulting diff carefully — every
 *                           new entry is an accepted security finding.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, "..", "security", "lint-baseline.json");

const updateBaseline = process.argv.includes("--update-baseline");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const allowlist = new Set(
  (process.env.SUPABASE_LINT_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Any allowlist entry outside this set must go through a code review — it's
// how we prevent someone widening the ignore list via repo `vars` or a stray
// commit and silently accepting a new security finding. The baseline file is
// the preferred mechanism; this env stays for backwards compatibility.
const APPROVED_ALLOWLIST = new Set([
  "authenticated_security_definer_function_executable",
  "0029_authenticated_security_definer_function_executable",
]);
const unapproved = [...allowlist].filter((name) => !APPROVED_ALLOWLIST.has(name));
if (unapproved.length > 0) {
  console.error(
    `supabase-security-lint: SUPABASE_LINT_ALLOWLIST contains unapproved entries: ${unapproved.join(", ")}`,
  );
  console.error(`  Approved entries: ${[...APPROVED_ALLOWLIST].join(", ")}`);
  console.error(
    "  To widen the allowlist, update APPROVED_ALLOWLIST in scripts/supabase-security-lint.mjs via PR.",
  );
  process.exit(1);
}

if (!token || !ref) {
  console.error(
    "supabase-security-lint: missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF; skipping.",
  );
  // Soft-skip so PRs from forks (no secrets) don't break; main-branch runs
  // in a trusted context will always have the secrets set.
  process.exit(0);
}

const url = `https://api.supabase.com/v1/projects/${ref}/database/lints`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

if (!res.ok) {
  console.error(
    `supabase-security-lint: API returned ${res.status} ${res.statusText}`,
  );
  console.error(await res.text());
  process.exit(1);
}

const lints = await res.json();
const findings = Array.isArray(lints) ? lints : [];

// Build a stable fingerprint for each finding. `cache_key` is the linter's
// own stable identifier when present; otherwise fall back to name+level plus
// any schema/table/object metadata so different offenders with the same rule
// don't collapse into one entry.
function fingerprintOf(f) {
  if (f.cache_key) return String(f.cache_key);
  const meta = f.metadata ?? {};
  const target =
    meta.name ??
    [meta.schema, meta.table ?? meta.function ?? meta.object].filter(Boolean).join(".") ??
    "";
  return [f.name, String(f.level ?? "").toUpperCase(), target].filter(Boolean).join("|");
}

const warnOrError = findings.filter((f) =>
  ["WARN", "ERROR"].includes(String(f.level ?? "").toUpperCase()),
);

if (updateBaseline) {
  const baseline = {
    $schema: "./lint-baseline.schema.md",
    description:
      "Fingerprints of Supabase database-linter findings that are known and accepted. CI (scripts/supabase-security-lint.mjs) fails on any WARN/ERROR finding whose fingerprint is not present here. Regenerate with `node scripts/supabase-security-lint.mjs --update-baseline` and commit the diff via PR.",
    findings: warnOrError
      .map((f) => ({
        fingerprint: fingerprintOf(f),
        name: f.name,
        level: String(f.level ?? "").toUpperCase(),
        note: f.title ?? "",
      }))
      .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(
    `supabase-security-lint: baseline rewritten with ${baseline.findings.length} finding(s) → ${BASELINE_PATH}`,
  );
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (err) {
  console.error(
    `supabase-security-lint: could not read baseline at ${BASELINE_PATH}: ${err.message}`,
  );
  process.exit(1);
}
const baselineFingerprints = new Set(
  (baseline.findings ?? []).map((f) => f.fingerprint),
);

const currentFingerprints = new Set();
const blocking = [];
for (const f of warnOrError) {
  if (allowlist.has(f.name)) continue;
  const fp = fingerprintOf(f);
  currentFingerprints.add(fp);
  if (!baselineFingerprints.has(fp)) blocking.push({ ...f, __fp: fp });
}

// Warn (don't fail) on stale baseline entries so we can prune them in a PR
// without an emergency red build.
const stale = [...baselineFingerprints].filter((fp) => !currentFingerprints.has(fp));
if (stale.length > 0) {
  console.log(
    `supabase-security-lint: ${stale.length} baseline entry/entries no longer reported (safe to prune):`,
  );
  for (const fp of stale) console.log(`  - ${fp}`);
}

if (blocking.length === 0) {
  console.log(
    `supabase-security-lint: OK (${findings.length} total findings, ${warnOrError.length} WARN/ERROR, all in baseline).`,
  );
  process.exit(0);
}

console.error(
  `supabase-security-lint: ${blocking.length} new WARN/ERROR finding(s) not in baseline:`,
);
for (const f of blocking) {
  console.error(
    `  [${f.level}] ${f.name} (${f.__fp}) — ${f.title ?? ""}\n    ${f.description ?? ""}\n    ${f.remediation ?? ""}`,
  );
}
console.error(
  "\nFix these findings, or — if intentionally accepted — regenerate the baseline with:",
);
console.error("  node scripts/supabase-security-lint.mjs --update-baseline");
console.error("and submit the baseline diff for review.");
process.exit(1);
