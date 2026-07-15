#!/usr/bin/env node
/**
 * Security regression scanner (static analysis).
 *
 * Blocks reintroduction of three vulnerability classes previously fixed in
 * this project:
 *
 *   1. Open-redirect on payment / billing flows
 *      → success/cancel/IPN URLs must be built from resolveAppOrigin(request),
 *        never from client-supplied `returnOrigin` / `origin` / `redirect_uri`.
 *
 *   2. Select-* leak on guest-exposed tables
 *      → server-side reads of public event data must use an explicit column
 *        allowlist, not `select('*')` / `SELECT *`.
 *
 *   3. Unsafe SECURITY DEFINER migration patterns
 *      → every new `SECURITY DEFINER` function must pin `SET search_path`
 *        in the same statement.
 *
 * Exits non-zero on any violation. Run in CI (`bun run lint:security-regression`)
 * and locally before commit.
 *
 * Findings are attributed to the internal_id of the original security
 * finding so a regression links straight back to the review that fixed it.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const violations = []
const record = (finding, file, line, message) =>
  violations.push({ finding, file: path.relative(ROOT, file), line, message })

/** Walk a directory yielding files matching `test`. */
async function* walk(dir, test) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.output', '.tanstack'].includes(entry.name)) continue
      yield* walk(full, test)
    } else if (test(full)) {
      yield full
    }
  }
}

// --------------------------------------------------------------------------
// 1. Open-redirect: client-supplied origin used in payment redirect URLs.
// --------------------------------------------------------------------------
// Trigger: a server function file that builds a URL string from a variable
// named like `returnOrigin` / `originOverride` / `redirectOrigin` /
// `clientOrigin` and passes it to a NOWPayments / Stripe / billing helper.
// Allowed: reading such a value ONLY to log or ignore it. To prove the
// build uses `resolveAppOrigin`, any file that references `returnOrigin`
// must ALSO import `resolveAppOrigin` and must not use `returnOrigin` as
// part of a template literal / string concatenation that also contains
// "success_url", "cancel_url", "ipn_callback_url", "return_url".
const REDIRECT_KEYWORDS = /(success_url|cancel_url|ipn_callback_url|return_url|redirect_uri)/i
const CLIENT_ORIGIN_VAR = /\b(returnOrigin|originOverride|redirectOrigin|clientOrigin)\b/
async function scanOpenRedirect() {
  for await (const file of walk(path.join(ROOT, 'src'), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))) {
    const src = await fs.readFile(file, 'utf8')
    if (!CLIENT_ORIGIN_VAR.test(src)) continue
    const lines = src.split('\n')
    // Look ahead: within 6 lines of a client-origin var reference, does a
    // redirect-URL keyword appear on the same "assignment island"?
    for (let i = 0; i < lines.length; i++) {
      if (!CLIENT_ORIGIN_VAR.test(lines[i])) continue
      const windowStart = Math.max(0, i - 3)
      const windowEnd = Math.min(lines.length, i + 6)
      const chunk = lines.slice(windowStart, windowEnd).join('\n')
      if (REDIRECT_KEYWORDS.test(chunk) && !/resolveAppOrigin\s*\(/.test(chunk)) {
        record(
          'nowpayments_redirect / billing_portal_open_redirect',
          file,
          i + 1,
          'Client-supplied origin flows into a redirect URL without resolveAppOrigin(request). Rebuild success/cancel/IPN URLs from resolveAppOrigin(getRequest()).',
        )
      }
    }
  }
}

// --------------------------------------------------------------------------
// 2. Select-* on guest-exposed tables.
// --------------------------------------------------------------------------
// Public event reads must enumerate columns. Same rule for any other table
// listed in EXPOSED_TABLES.
const EXPOSED_TABLES = ['events', 'profiles', 'memberships']
const SELECT_STAR_JS = new RegExp(
  String.raw`\.from\(\s*['"\`](${EXPOSED_TABLES.join('|')})['"\`]\s*\)[\s\S]{0,120}?\.select\(\s*['"\`]\*['"\`]`,
  'g',
)
async function scanSelectStar() {
  for await (const file of walk(path.join(ROOT, 'src'), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))) {
    // Only care about server-executed code (functions files, server routes,
    // *.server.ts). Client-side reads are RLS-gated per-user.
    if (
      !/\.functions\.tsx?$/.test(file) &&
      !/\.server\.tsx?$/.test(file) &&
      !file.includes(`${path.sep}routes${path.sep}api${path.sep}`)
    ) {
      continue
    }
    const src = await fs.readFile(file, 'utf8')
    let match
    SELECT_STAR_JS.lastIndex = 0
    while ((match = SELECT_STAR_JS.exec(src))) {
      const line = src.slice(0, match.index).split('\n').length
      record(
        'events_public_select_star_leak',
        file,
        line,
        `.select('*') on public.${match[1]} in server code — replace with an explicit column allowlist that excludes sensitive fields (host_id, compliance_notes, insurance_*, permit_details, legal_capacity).`,
      )
    }
  }
}

// --------------------------------------------------------------------------
// 3. Unsafe SECURITY DEFINER functions in migrations.
// --------------------------------------------------------------------------
// Every CREATE FUNCTION ... SECURITY DEFINER block must pin search_path.
const CREATE_FN_RE = /create\s+(or\s+replace\s+)?function\s+([\s\S]*?)(?:\$\$|\$_\$|LANGUAGE\s+sql\s+[^\n;]*;)/gi
async function scanSecurityDefiner() {
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations')
  for await (const file of walk(migrationsDir, (f) => f.endsWith('.sql'))) {
    const src = await fs.readFile(file, 'utf8')
    let m
    CREATE_FN_RE.lastIndex = 0
    while ((m = CREATE_FN_RE.exec(src))) {
      const body = m[0]
      if (!/security\s+definer/i.test(body)) continue
      if (/set\s+search_path\s*(=|to)/i.test(body)) continue
      const line = src.slice(0, m.index).split('\n').length
      record(
        'SUPA_*_security_definer_function_executable',
        file,
        line,
        'SECURITY DEFINER function without `SET search_path = public` (or similar). Pin search_path in the CREATE FUNCTION statement to prevent search-path hijack.',
      )
    }
  }
}

// --------------------------------------------------------------------------
await Promise.all([scanOpenRedirect(), scanSelectStar(), scanSecurityDefiner()])

if (violations.length === 0) {
  console.log('✓ security-regression-scan: no regressions detected')
  process.exit(0)
}

console.error(`✗ security-regression-scan: ${violations.length} violation(s)\n`)
for (const v of violations) {
  console.error(`  [${v.finding}]`)
  console.error(`    ${v.file}:${v.line}`)
  console.error(`    ${v.message}\n`)
}
console.error(
  'These patterns were previously fixed as security findings. If a hit is a false positive, refactor to satisfy the rule or extend the allowlist in scripts/security-regression-scan.mjs with a documented rationale.',
)
process.exit(1)
