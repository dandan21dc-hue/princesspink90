#!/usr/bin/env node
/**
 * Concise "scheduled rescan" summary for the Supabase security linter.
 *
 * Runs the same database-lints fetch the CI gate uses, then compares
 * the current WARN/ERROR findings against:
 *   - security/lint-baseline.json      (accepted findings)
 *   - security/findings-snapshot.json  (last recorded scan)
 * and emits a short human-readable markdown block suitable for a
 * GitHub issue comment, a Slack post, or an email body.
 *
 * Intended for the nightly cron job in .github/workflows/ci.yml — the
 * gating checks stay in supabase-security-lint.mjs, this script only
 * *reports*, so it never exits non-zero on findings (only on infra
 * failure). CI can pipe the stdout straight into a github-script
 * `createComment` call.
 *
 * Env (same as supabase-security-lint.mjs):
 *   SUPABASE_ACCESS_TOKEN
 *   SUPABASE_PROJECT_REF
 *
 * Optional:
 *   SECURITY_SCAN_RUN_URL  Link to the CI run; included in the footer.
 *   SECURITY_SCAN_TRIGGER  Human label ("nightly cron", "manual", …).
 *
 * Flags:
 *   --out=<path>  Also write the summary to <path> (stdout always used).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, "..", "security", "lint-baseline.json");
const SNAPSHOT_PATH = join(
  __dirname,
  "..",
  "security",
  "findings-snapshot.json",
);

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.split("=")[1] : null;

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const runUrl = process.env.SECURITY_SCAN_RUN_URL || "";
const trigger = process.env.SECURITY_SCAN_TRIGGER || "scheduled rescan";

if (!token || !ref) {
  const body =
    `# 🔒 Security rescan (${trigger})\n\n` +
    "_Skipped: SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF is not set in this environment._\n";
  process.stdout.write(body);
  if (outPath) writeFileSync(outPath, body);
  process.exit(0);
}

const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/lints`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!res.ok) {
  console.error(
    `security-scan-summary: API returned ${res.status} ${res.statusText}`,
  );
  console.error(await res.text());
  process.exit(1);
}
const findings = await res.json();
const warnOrError = (Array.isArray(findings) ? findings : []).filter((f) =>
  ["WARN", "ERROR"].includes(String(f.level ?? "").toUpperCase()),
);

// Match the fingerprint shape used by supabase-security-lint.mjs and
// security-changelog.mjs so IDs correlate across all three surfaces.
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

let baseline = { findings: [] };
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {}
}
let snapshot = { version: 0, generated_at: null, findings: [] };
if (existsSync(SNAPSHOT_PATH)) {
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {}
}

const baselineIds = new Set((baseline.findings ?? []).map((f) => f.fingerprint));
const snapshotIds = new Set((snapshot.findings ?? []).map((f) => f.internal_id));

const current = warnOrError.map((f) => ({
  id: fingerprintOf(f),
  level: String(f.level ?? "").toUpperCase(),
  name: f.name,
  title: f.title ?? "",
}));
const currentIds = new Set(current.map((f) => f.id));

const newVsBaseline = current.filter((f) => !baselineIds.has(f.id));
const newVsSnapshot = current.filter((f) => !snapshotIds.has(f.id));
const fixedVsSnapshot = [...snapshotIds].filter((id) => !currentIds.has(id));

const counts = current.reduce(
  (acc, f) => ((acc[f.level] = (acc[f.level] ?? 0) + 1), acc),
  {},
);

const status =
  newVsBaseline.length === 0 ? "✅ clean vs baseline" : "❌ new findings vs baseline";
const now = new Date().toISOString();

const lines = [];
lines.push(`# 🔒 Security rescan (${trigger}) — ${status}`);
lines.push("");
lines.push(`_Scan time: ${now}_`);
lines.push("");
lines.push(
  `- **Current WARN/ERROR:** ${current.length} (ERROR: ${counts.ERROR ?? 0}, WARN: ${counts.WARN ?? 0})`,
);
lines.push(`- **Baseline accepted:** ${baselineIds.size}`);
lines.push(
  `- **New vs baseline:** ${newVsBaseline.length}${newVsBaseline.length ? " ← would block merge" : ""}`,
);
lines.push(
  `- **New since last snapshot (v${snapshot.version ?? 0}):** ${newVsSnapshot.length}`,
);
lines.push(`- **Fixed since last snapshot:** ${fixedVsSnapshot.length}`);
lines.push("");

function listBlock(header, items, format, limit = 10) {
  if (items.length === 0) return;
  lines.push(`### ${header} (${items.length})`);
  for (const it of items.slice(0, limit)) lines.push(`- ${format(it)}`);
  if (items.length > limit) lines.push(`- …and ${items.length - limit} more`);
  lines.push("");
}

listBlock(
  "New vs baseline",
  newVsBaseline,
  (f) => `[${f.level}] \`${f.id}\` — ${f.name}${f.title ? ` — ${f.title}` : ""}`,
);
listBlock(
  "New since last snapshot",
  // Only surface deltas that aren't already in the "new vs baseline"
  // list, so reviewers see each finding once.
  newVsSnapshot.filter((f) => baselineIds.has(f.id)),
  (f) => `[${f.level}] \`${f.id}\` — ${f.name}`,
);
listBlock("Fixed since last snapshot", fixedVsSnapshot, (id) => `\`${id}\``);

lines.push("---");
if (runUrl) lines.push(`CI run: ${runUrl}`);
lines.push(
  "Full details: download the `supabase-security-lint-report` and `security-findings-summary` artifacts from the run, or see `security/CHANGELOG.md`.",
);
lines.push("");

const body = lines.join("\n");
process.stdout.write(body);
if (outPath) writeFileSync(outPath, body);
