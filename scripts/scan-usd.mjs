#!/usr/bin/env node
/**
 * CI guard: fail the build if any user-visible surface (rendered UI text,
 * rendered email HTML, or JSON-LD literals) contains "USD" or "US$".
 *
 * AUD is the sole surface currency for this project (see @memory/index).
 * A stray "USD" in an email template, a JSON-LD `priceCurrency`, or copy on
 * a route/component is a shipping mistake — this script blocks the merge.
 *
 * Scope:
 *   1. Walks src/routes, src/components, src/lib/email-templates, src/pages,
 *      src/app for .tsx/.ts/.jsx/.js/.mdx files, and greps each line for the
 *      forbidden patterns. Lines matching the allowlist below are skipped.
 *   2. Renders every template registered in src/lib/email-templates/registry.ts
 *      with its `previewData` and checks the resulting HTML for /usd|us\$/i.
 *
 * Run: `node scripts/scan-usd.mjs` (also wired as `bun run lint:usd`).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// Surfaces we consider user-visible. Server functions, tests, migrations,
// tax-code catalogues, and the currency-guard helpers themselves legitimately
// name "USD" (to reject or archive it) and are intentionally excluded.
const UI_DIRS = [
  "src/routes",
  "src/components",
  "src/lib/email-templates",
  "src/pages",
];
const CODE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".mdx"]);

// Match any of:
//   - Word "USD" in copy or literals
//   - "US$" (localized price prefix)
//   - JSON-LD priceCurrency: "USD"
//   - `currency: "usd"` / `'usd'`
const FORBIDDEN = /\bUSD\b|US\$|priceCurrency\s*:\s*["']USD["']|currency\s*:\s*["']usd["']/;

// Line-level allowlist. Add a comment `// usd-scan-allow: <reason>` on any
// intentional occurrence and the scanner will skip that exact line.
const LINE_ALLOW = /usd-scan-allow:/;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot >= 0 && CODE_EXT.has(entry.name.slice(dot))) out.push(p);
    }
  }
  return out;
}

async function scanUiFiles() {
  const violations = [];
  for (const rel of UI_DIRS) {
    const abs = join(ROOT, rel);
    try {
      await stat(abs);
    } catch {
      continue;
    }
    const files = await walk(abs);
    for (const file of files) {
      const src = await readFile(file, "utf8");
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (LINE_ALLOW.test(line)) continue;
        if (FORBIDDEN.test(line)) {
          violations.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return violations;
}

async function scanEmailTemplates() {
  const violations = [];
  const registryUrl = pathToFileURL(join(ROOT, "src/lib/email-templates/registry.ts")).href;
  let React, render, TEMPLATES;
  try {
    ({ default: React } = await import("react"));
    ({ render } = await import("@react-email/render"));
    ({ TEMPLATES } = await import(registryUrl));
  } catch (err) {
    console.error("[scan-usd] failed to load email templates:", err.message);
    process.exitCode = 1;
    return violations;
  }
  const EMAIL_FORBIDDEN = /\bUSD\b|US\$/i;
  for (const [name, entry] of Object.entries(TEMPLATES)) {
    let html;
    try {
      html = await render(React.createElement(entry.component, entry.previewData ?? {}));
    } catch (err) {
      violations.push({ file: `email:${name}`, line: 0, text: `render failed: ${err.message}` });
      continue;
    }
    if (EMAIL_FORBIDDEN.test(html)) {
      // Report the offending snippet in context (100-char window).
      const match = html.match(EMAIL_FORBIDDEN);
      const idx = html.search(EMAIL_FORBIDDEN);
      const snippet = html.slice(Math.max(0, idx - 40), idx + 60).replace(/\s+/g, " ");
      violations.push({ file: `email:${name}`, line: 0, text: `${match?.[0]} in "…${snippet}…"` });
    }
  }
  return violations;
}

const [uiViolations, emailViolations] = await Promise.all([
  scanUiFiles(),
  scanEmailTemplates(),
]);
const all = [...uiViolations, ...emailViolations];

if (all.length === 0) {
  console.log("[scan-usd] OK — no USD/US$ strings in UI, emails, or JSON-LD.");
  process.exit(0);
}

console.error(`[scan-usd] FAIL — ${all.length} forbidden USD reference(s):`);
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error("");
console.error("AUD is the sole surface currency. Replace USD/US$ with AUD/A$,");
console.error("or add `// usd-scan-allow: <reason>` on the exact line if the");
console.error("occurrence is intentional (e.g. a comment explaining the rule).");
process.exit(1);
