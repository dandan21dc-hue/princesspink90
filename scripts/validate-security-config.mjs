#!/usr/bin/env node
/**
 * Pre-flight validator for the security gate. Runs BEFORE the Supabase
 * linter and migrations jobs so structural mistakes (bad JSON, missing
 * fields, unapproved allowlist entries, drifted approved-map) fail fast
 * with a targeted error instead of a confusing linter/gate failure.
 *
 * Checks:
 *   1. security/lint-baseline.json parses as JSON and matches the expected
 *      schema: `{ $schema, description, findings: [{ fingerprint, name,
 *      level: WARN|ERROR, note }] }`. All fields required and typed;
 *      fingerprints unique; findings sorted by fingerprint.
 *   2. scripts/supabase-security-lint.mjs contains a parseable
 *      APPROVED_ALLOWLIST with a non-empty rationale per entry.
 *   3. The SUPABASE_LINT_ALLOWLIST value in .github/workflows/ci.yml is
 *      well-formed (comma-separated, no blank entries after trimming) and
 *      every non-`${{ vars.* }}` entry is present in APPROVED_ALLOWLIST.
 *
 * Exits non-zero on any failure with a specific fix-it message.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "security", "lint-baseline.json");
const LINTER_PATH = join(REPO_ROOT, "scripts", "supabase-security-lint.mjs");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");

const errors = [];
const fail = (msg) => errors.push(msg);

// -------------------------------------------------------------------
// 1. Baseline schema
// -------------------------------------------------------------------
let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (err) {
  fail(`security/lint-baseline.json: invalid JSON (${err.message})`);
}

if (baseline) {
  const allowedTopKeys = new Set(["$schema", "description", "findings"]);
  for (const k of Object.keys(baseline)) {
    if (!allowedTopKeys.has(k)) {
      fail(`security/lint-baseline.json: unknown top-level key "${k}"`);
    }
  }
  if (typeof baseline.description !== "string" || !baseline.description.trim()) {
    fail(`security/lint-baseline.json: "description" must be a non-empty string`);
  }
  if (!Array.isArray(baseline.findings)) {
    fail(`security/lint-baseline.json: "findings" must be an array`);
  } else {
    const allowedFindingKeys = new Set(["fingerprint", "name", "level", "note"]);
    const validLevels = new Set(["WARN", "ERROR"]);
    const seen = new Set();
    const fingerprints = [];
    baseline.findings.forEach((f, i) => {
      const at = `security/lint-baseline.json: findings[${i}]`;
      if (!f || typeof f !== "object") {
        fail(`${at}: not an object`);
        return;
      }
      for (const k of Object.keys(f)) {
        if (!allowedFindingKeys.has(k)) fail(`${at}: unknown field "${k}"`);
      }
      for (const k of ["fingerprint", "name", "level", "note"]) {
        if (typeof f[k] !== "string") fail(`${at}: "${k}" must be a string`);
      }
      if (typeof f.fingerprint === "string") {
        if (!f.fingerprint.trim()) fail(`${at}: "fingerprint" is empty`);
        if (seen.has(f.fingerprint)) {
          fail(`${at}: duplicate fingerprint "${f.fingerprint}"`);
        }
        seen.add(f.fingerprint);
        fingerprints.push(f.fingerprint);
      }
      if (typeof f.name === "string" && !f.name.trim()) {
        fail(`${at}: "name" is empty`);
      }
      if (typeof f.level === "string" && !validLevels.has(f.level)) {
        fail(`${at}: "level" must be WARN or ERROR (got "${f.level}")`);
      }
      if (typeof f.note === "string" && !f.note.trim()) {
        fail(`${at}: "note" is empty — record the rationale, do not accept blindly`);
      }
    });
    // Sorted-by-fingerprint invariant (matches --update-baseline output;
    // stable ordering keeps diffs reviewable).
    const sorted = [...fingerprints].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < fingerprints.length; i++) {
      if (fingerprints[i] !== sorted[i]) {
        fail(
          `security/lint-baseline.json: findings not sorted by fingerprint. ` +
            `Regenerate with \`bun run security:baseline:update -- --no-commit\` to fix ordering.`,
        );
        break;
      }
    }
  }
}

// -------------------------------------------------------------------
// 2. Parse APPROVED_ALLOWLIST from the linter script
// -------------------------------------------------------------------
let approvedKeys = new Set();
try {
  const linterSrc = readFileSync(LINTER_PATH, "utf8");
  const mapMatch = linterSrc.match(
    /const\s+APPROVED_ALLOWLIST\s*=\s*new\s+Map\(\[([\s\S]*?)\]\);/,
  );
  if (!mapMatch) {
    fail(
      `scripts/supabase-security-lint.mjs: could not locate APPROVED_ALLOWLIST — did the declaration shape change?`,
    );
  } else {
    // Extract each ["key", "rationale"] pair. The rationale strings contain
    // commas, quotes, and semicolons, so match by the balanced tuple shape:
    // [\s* "key" \s*,\s* "rationale" \s*,?\s* ]
    const entryRe =
      /\[\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,?\s*\]/g;
    const body = mapMatch[1];
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      // eslint-disable-next-line no-eval
      const key = eval(m[1]);
      // eslint-disable-next-line no-eval
      const rationale = eval(m[2]);
      if (typeof key !== "string" || !key.trim()) {
        fail(`APPROVED_ALLOWLIST: empty key`);
        continue;
      }
      if (typeof rationale !== "string" || !rationale.trim()) {
        fail(`APPROVED_ALLOWLIST["${key}"]: rationale is empty — record why it's accepted`);
      }
      approvedKeys.add(key);
    }
    if (approvedKeys.size === 0) {
      fail(
        `scripts/supabase-security-lint.mjs: APPROVED_ALLOWLIST parsed as empty — check the tuple shape`,
      );
    }
  }
} catch (err) {
  fail(`scripts/supabase-security-lint.mjs: could not read (${err.message})`);
}

// -------------------------------------------------------------------
// 3. Workflow allowlist value
// -------------------------------------------------------------------
try {
  const wf = readFileSync(WORKFLOW_PATH, "utf8");
  // Grab the SUPABASE_LINT_ALLOWLIST: "..." line inside the env block.
  const allowlistLine = wf.match(/SUPABASE_LINT_ALLOWLIST:\s*"([^"]*)"/);
  if (!allowlistLine) {
    fail(
      `.github/workflows/ci.yml: SUPABASE_LINT_ALLOWLIST env value not found or not a double-quoted string`,
    );
  } else {
    const raw = allowlistLine[1];
    const entries = raw.split(",").map((s) => s.trim());
    entries.forEach((entry, idx) => {
      if (entry === "") {
        // Trailing ${{ vars.SUPABASE_LINT_ALLOWLIST }} that expands to
        // empty is fine; a bare "" in the middle is not.
        const isTrailing = idx === entries.length - 1 || idx === 0;
        if (!isTrailing) {
          fail(
            `.github/workflows/ci.yml: SUPABASE_LINT_ALLOWLIST contains an empty entry at position ${idx}`,
          );
        }
        return;
      }
      // Allow GitHub expression pass-throughs (repo vars merged in at runtime).
      if (entry.startsWith("${{") && entry.endsWith("}}")) return;
      if (approvedKeys.size > 0 && !approvedKeys.has(entry)) {
        // Case-insensitive fallback (matches the linter's own lookup).
        const ci = [...approvedKeys].find(
          (k) => k.toLowerCase() === entry.toLowerCase(),
        );
        if (!ci) {
          fail(
            `.github/workflows/ci.yml: SUPABASE_LINT_ALLOWLIST entry "${entry}" is not in APPROVED_ALLOWLIST. ` +
              `Add it (with @security-memory rationale) to scripts/supabase-security-lint.mjs first.`,
          );
        }
      }
    });
  }
} catch (err) {
  fail(`.github/workflows/ci.yml: could not read (${err.message})`);
}

// -------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`validate-security-config: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `validate-security-config: OK (${baseline?.findings?.length ?? 0} baseline finding(s), ${approvedKeys.size} approved allowlist key(s)).`,
);
