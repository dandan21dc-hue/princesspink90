#!/usr/bin/env node
/**
 * Versioned changelog for Supabase security-linter findings.
 *
 * Compares the current WARN/ERROR findings (fetched from the same
 * database-lints API used by scripts/supabase-security-lint.mjs)
 * against the previous snapshot at security/findings-snapshot.json,
 * then prepends a versioned entry to security/CHANGELOG.md capturing
 * per-`internal_id` status transitions:
 *
 *   - added         (not present in previous snapshot, present now)
 *   - removed       (present previously, not present now — treated as
 *                    "fixed / no longer reported")
 *   - level_changed (same internal_id, level flipped WARN <-> ERROR)
 *   - unchanged     (not written to the changelog; recorded in
 *                    findings-snapshot.json only)
 *
 * Each changelog entry is a version block:
 *
 *   ## v<N> — <ISO timestamp> (scan <scan_id>)
 *   Previous: v<N-1> at <ISO timestamp>
 *
 *   ### Added (k)
 *   - [LEVEL] <name> — <internal_id>
 *     <title>
 *
 *   ### Removed (k)
 *   - [LEVEL] <name> — <internal_id>
 *
 *   ### Level changed (k)
 *   - <name> — <internal_id>: WARN → ERROR
 *
 * `internal_id` is the finding's stable fingerprint (linter `cache_key`
 * when present, else name|level|target — same shape as the lint
 * baseline uses). This is what lets us correlate findings across scans
 * even when title/description wording drifts.
 *
 * Required env (same as supabase-security-lint.mjs):
 *   SUPABASE_ACCESS_TOKEN
 *   SUPABASE_PROJECT_REF
 *
 * Optional env:
 *   SECURITY_CHANGELOG_SCAN_ID  Correlates the entry with the CI run
 *                               (defaults to a timestamp).
 *
 * Flags:
 *   --dry-run   Print the diff to stdout; don't touch snapshot or
 *               CHANGELOG.md.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECURITY_DIR = join(__dirname, "..", "security");
const SNAPSHOT_PATH = join(SECURITY_DIR, "findings-snapshot.json");
const CHANGELOG_PATH = join(SECURITY_DIR, "CHANGELOG.md");

const dryRun = process.argv.includes("--dry-run");
const scanId =
  process.env.SECURITY_CHANGELOG_SCAN_ID ||
  `scan-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;

if (!token || !ref) {
  console.error(
    "security-changelog: missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF; skipping.",
  );
  // Soft-skip so fork PRs (no secrets) don't fail.
  process.exit(0);
}

const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/lints`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!res.ok) {
  console.error(
    `security-changelog: API returned ${res.status} ${res.statusText}`,
  );
  console.error(await res.text());
  process.exit(1);
}
const findings = await res.json();
const warnOrError = (Array.isArray(findings) ? findings : []).filter((f) =>
  ["WARN", "ERROR"].includes(String(f.level ?? "").toUpperCase()),
);

// Same fingerprint shape as scripts/supabase-security-lint.mjs so
// changelog `internal_id`s line up 1:1 with baseline fingerprints.
function fingerprintOf(f) {
  if (f.cache_key) return String(f.cache_key);
  const meta = f.metadata ?? {};
  const target =
    meta.name ??
    [meta.schema, meta.table ?? meta.function ?? meta.object]
      .filter(Boolean)
      .join(".") ??
    "";
  return [f.name, String(f.level ?? "").toUpperCase(), target]
    .filter(Boolean)
    .join("|");
}

const now = new Date().toISOString();
const current = new Map();
for (const f of warnOrError) {
  const id = fingerprintOf(f);
  current.set(id, {
    internal_id: id,
    name: f.name,
    level: String(f.level ?? "").toUpperCase(),
    title: f.title ?? "",
  });
}

let previous = { version: 0, generated_at: null, findings: [] };
if (existsSync(SNAPSHOT_PATH)) {
  try {
    previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (err) {
    console.error(
      `security-changelog: could not parse ${SNAPSHOT_PATH}: ${err.message}`,
    );
    process.exit(1);
  }
}
const previousMap = new Map(
  (previous.findings ?? []).map((f) => [f.internal_id, f]),
);

const added = [];
const removed = [];
const levelChanged = [];
for (const [id, f] of current) {
  const prev = previousMap.get(id);
  if (!prev) added.push(f);
  else if (prev.level !== f.level)
    levelChanged.push({ ...f, from: prev.level, to: f.level });
}
for (const [id, f] of previousMap) {
  if (!current.has(id)) removed.push(f);
}

const noChange =
  added.length === 0 && removed.length === 0 && levelChanged.length === 0;
const nextVersion = (previous.version ?? 0) + (noChange ? 0 : 1);

// Always write a compact human-readable diff so CI logs / artifacts
// tell the reviewer what happened even when nothing changed.
console.log(
  `security-changelog: scan=${scanId} added=${added.length} removed=${removed.length} level_changed=${levelChanged.length} (v${previous.version ?? 0} → v${nextVersion})`,
);

if (noChange) {
  console.log("security-changelog: no status changes; snapshot unchanged.");
  process.exit(0);
}

function formatEntry() {
  const lines = [];
  lines.push(`## v${nextVersion} — ${now} (scan ${scanId})`);
  if (previous.generated_at) {
    lines.push(
      `Previous: v${previous.version} at ${previous.generated_at}`,
    );
  } else {
    lines.push(`Previous: (no prior snapshot — first recorded scan)`);
  }
  lines.push("");
  if (added.length) {
    lines.push(`### Added (${added.length})`);
    for (const f of added) {
      lines.push(`- [${f.level}] ${f.name} — \`${f.internal_id}\``);
      if (f.title) lines.push(`  ${f.title}`);
    }
    lines.push("");
  }
  if (removed.length) {
    lines.push(`### Removed (${removed.length})`);
    for (const f of removed) {
      lines.push(`- [${f.level}] ${f.name} — \`${f.internal_id}\``);
    }
    lines.push("");
  }
  if (levelChanged.length) {
    lines.push(`### Level changed (${levelChanged.length})`);
    for (const f of levelChanged) {
      lines.push(
        `- ${f.name} — \`${f.internal_id}\`: ${f.from} → ${f.to}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

const entry = formatEntry();

if (dryRun) {
  console.log("\n--- changelog entry (dry run) ---\n");
  console.log(entry);
  process.exit(0);
}

const header =
  "# Security Findings Changelog\n\n" +
  "Versioned record of status changes for Supabase security-linter\n" +
  "findings, keyed by stable `internal_id` (fingerprint). Regenerated\n" +
  "by `bun run security:changelog` on every CI security scan; new\n" +
  "entries are prepended.\n";

let existing = "";
if (existsSync(CHANGELOG_PATH)) {
  const raw = readFileSync(CHANGELOG_PATH, "utf8");
  // Strip the header if present so we only keep the version blocks
  // when re-prepending.
  const idx = raw.indexOf("\n## v");
  existing = idx >= 0 ? raw.slice(idx + 1) : "";
}
const nextChangelog = `${header}\n${entry}\n${existing ? existing : ""}`.trimEnd() + "\n";
writeFileSync(CHANGELOG_PATH, nextChangelog);

const snapshot = {
  version: nextVersion,
  generated_at: now,
  scan_id: scanId,
  findings: [...current.values()].sort((a, b) =>
    a.internal_id.localeCompare(b.internal_id),
  ),
};
writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");

console.log(
  `security-changelog: wrote v${nextVersion} to ${CHANGELOG_PATH} and refreshed snapshot.`,
);
