#!/usr/bin/env node
/**
 * Exports the set of security-linter findings that transitioned to
 * "fixed" (i.e. the `Removed` list in the security changelog) as a
 * GitHub-issue-flavored Markdown body, ready to paste into a security
 * ticket.
 *
 * Sources:
 *   security/CHANGELOG.md         Version blocks produced by
 *                                 scripts/security-changelog.mjs.
 *   security/findings-snapshot.json  For the "still open" count in the
 *                                 issue footer.
 *
 * Modes:
 *   (default)   Only the most recent version's Removed entries.
 *   --all       All Removed entries across every changelog version,
 *               deduplicated by internal_id (first-seen wins so the
 *               oldest fix date is reported).
 *   --since=vN  All Removed entries from version N+1 onward.
 *
 * Flags:
 *   --out=<path>   Also write the body to <path> (defaults to stdout
 *                  only). Use e.g. --out=/tmp/security-fixed-issue.md
 *                  for CI pipelines.
 *   --title=<s>   Override the default issue title on the first line.
 *
 * Output shape (stdout, also written to --out):
 *
 *   # <title>
 *
 *   The following Supabase security-linter findings have been marked
 *   fixed since <baseline>. Please confirm the underlying remediation
 *   before closing this ticket.
 *
 *   ## Fixed findings (k)
 *   - [ ] `<internal_id>` — [LEVEL] <name> (fixed in v<N>, <ISO date>)
 *   ...
 *
 *   ## Context
 *   - Snapshot version: v<N>
 *   - Still-open findings: <k>
 *   - Source: `security/CHANGELOG.md`
 *
 * The list is emitted as a GitHub task list so reviewers can tick each
 * ID off as they verify it in the underlying schema / policy.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = join(__dirname, "..", "security", "CHANGELOG.md");
const SNAPSHOT_PATH = join(__dirname, "..", "security", "findings-snapshot.json");

const args = process.argv.slice(2);
const all = args.includes("--all");
const sinceArg = args.find((a) => a.startsWith("--since="));
const since = sinceArg ? Number(sinceArg.split("=")[1].replace(/^v/i, "")) : null;
const outArg = args.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.split("=")[1] : null;
const titleArg = args.find((a) => a.startsWith("--title="));
const title = titleArg
  ? titleArg.split("=")[1]
  : "Security findings marked fixed — please verify";

if (!existsSync(CHANGELOG_PATH)) {
  console.error(`security-fixed-issue: no changelog at ${CHANGELOG_PATH}`);
  process.exit(1);
}
const changelog = readFileSync(CHANGELOG_PATH, "utf8");

// Parse `## v<N> — <ISO> (scan <id>)` blocks. Each block runs until
// the next `## v` header. We intentionally scan only the version
// headers we emit ourselves — the file's top-level `# Security ...`
// header and prose sit above the first `## v` and are ignored.
const blockRe = /^## v(\d+) — (\S+) \(scan ([^)]+)\)\s*$/gm;
const blocks = [];
let m;
const matches = [];
while ((m = blockRe.exec(changelog)) !== null) matches.push(m);
for (let i = 0; i < matches.length; i++) {
  const cur = matches[i];
  const next = matches[i + 1];
  const body = changelog.slice(cur.index, next ? next.index : undefined);
  blocks.push({
    version: Number(cur[1]),
    timestamp: cur[2],
    scanId: cur[3],
    body,
  });
}

// Extract the `### Removed (k)` list items from a block body. Each
// item is `- [LEVEL] <name> — \`<internal_id>\``.
function removedFrom(block) {
  const idx = block.body.indexOf("### Removed");
  if (idx < 0) return [];
  const rest = block.body.slice(idx);
  const endIdx = rest.slice(1).search(/^### /m);
  const section = endIdx >= 0 ? rest.slice(0, endIdx + 1) : rest;
  const items = [];
  const itemRe = /^- \[(WARN|ERROR)\] (\S.*?) — `([^`]+)`/gm;
  let im;
  while ((im = itemRe.exec(section)) !== null) {
    items.push({
      level: im[1],
      name: im[2].trim(),
      internal_id: im[3],
      version: block.version,
      timestamp: block.timestamp,
    });
  }
  return items;
}

let selectedBlocks;
if (all) selectedBlocks = blocks;
else if (since !== null) selectedBlocks = blocks.filter((b) => b.version > since);
else selectedBlocks = blocks.slice(0, 1); // most recent version only

const seen = new Set();
const fixed = [];
for (const b of selectedBlocks) {
  for (const item of removedFrom(b)) {
    if (seen.has(item.internal_id)) continue;
    seen.add(item.internal_id);
    fixed.push(item);
  }
}

let snapshot = { version: 0, findings: [] };
if (existsSync(SNAPSHOT_PATH)) {
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch {
    // Non-fatal — snapshot is only used for the context footer.
  }
}

const baseline = all
  ? "the first recorded scan"
  : since !== null
    ? `snapshot v${since}`
    : selectedBlocks[0]
      ? `the previous scan (before v${selectedBlocks[0].version})`
      : "the previous scan";

const lines = [];
lines.push(`# ${title}`);
lines.push("");
lines.push(
  `The following Supabase security-linter findings have been marked fixed since ${baseline}. Please confirm the underlying remediation before closing this ticket.`,
);
lines.push("");

if (fixed.length === 0) {
  lines.push("_No fixed findings to report for the selected range._");
} else {
  lines.push(`## Fixed findings (${fixed.length})`);
  for (const f of fixed) {
    lines.push(
      `- [ ] \`${f.internal_id}\` — [${f.level}] ${f.name} (fixed in v${f.version}, ${f.timestamp})`,
    );
  }
}

lines.push("");
lines.push("## Context");
lines.push(`- Snapshot version: v${snapshot.version ?? 0}`);
lines.push(`- Still-open findings: ${(snapshot.findings ?? []).length}`);
lines.push("- Source: `security/CHANGELOG.md`");
if (all) lines.push("- Range: all changelog versions");
else if (since !== null) lines.push(`- Range: versions after v${since}`);
else lines.push("- Range: latest changelog version only");
lines.push("");

const body = lines.join("\n");
process.stdout.write(body);
if (outPath) {
  writeFileSync(outPath, body);
  console.error(`security-fixed-issue: wrote ${fixed.length} fixed finding(s) → ${outPath}`);
}
