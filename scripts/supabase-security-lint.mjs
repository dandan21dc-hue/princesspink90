#!/usr/bin/env node
/**
 * Runs the Supabase database linter (same checks surfaced in the
 * Lovable Cloud security panel) against the linked project and fails
 * CI on any WARN or ERROR level finding.
 *
 * Required env:
 *   SUPABASE_ACCESS_TOKEN   Personal access token (repo secret)
 *   SUPABASE_PROJECT_REF    Project ref, e.g. bxwwrlhtgrqbsgbmaxgq
 *
 * Optional env:
 *   SUPABASE_LINT_ALLOWLIST Comma-separated lint `name`s to ignore
 *                           (mirror anything intentionally ignored
 *                           in the security memory).
 */

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const allowlist = new Set(
  (process.env.SUPABASE_LINT_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

if (!token || !ref) {
  console.error(
    "supabase-security-lint: missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF; skipping.",
  );
  // Soft-skip so PRs from forks (no secrets) don't break; main-branch runs
  // in a trusted context will always have the secrets set.
  process.exit(0);
}

const url = `https://api.supabase.com/v1/projects/${ref}/database/lints`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
  console.error(
    `supabase-security-lint: API returned ${res.status} ${res.statusText}`,
  );
  console.error(await res.text());
  process.exit(1);
}

const lints = await res.json();
const findings = Array.isArray(lints) ? lints : [];

const blocking = findings.filter(
  (f) =>
    ["WARN", "ERROR"].includes(String(f.level ?? "").toUpperCase()) &&
    !allowlist.has(f.name),
);

if (blocking.length === 0) {
  console.log(
    `supabase-security-lint: OK (${findings.length} total findings, none blocking).`,
  );
  process.exit(0);
}

console.error(
  `supabase-security-lint: ${blocking.length} blocking finding(s):`,
);
for (const f of blocking) {
  console.error(
    `  [${f.level}] ${f.name} — ${f.title ?? ""}\n    ${f.description ?? ""}\n    ${f.remediation ?? ""}`,
  );
}
process.exit(1);
