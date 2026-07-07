import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { assertAudCurrency, AUD_CURRENCY } from "./stripe.server";

// ---------------------------------------------------------------------------
// Unit tests for the AUD-only guard used at every Stripe price call site.
// ---------------------------------------------------------------------------
describe("assertAudCurrency", () => {
  it("accepts 'aud' in any casing and returns the canonical constant", () => {
    expect(assertAudCurrency("aud")).toBe(AUD_CURRENCY);
    expect(assertAudCurrency("AUD")).toBe("aud");
    expect(assertAudCurrency(" Aud ")).toBe("aud");
  });

  it("treats blank/undefined/null as AUD (default)", () => {
    expect(assertAudCurrency(undefined)).toBe("aud");
    expect(assertAudCurrency(null)).toBe("aud");
    expect(assertAudCurrency("")).toBe("aud");
    expect(assertAudCurrency("   ")).toBe("aud");
  });

  it("throws a USD-specific error for any USD casing", () => {
    for (const v of ["usd", "USD", "Usd", " usd "]) {
      expect(() => assertAudCurrency(v)).toThrow(/USD is not supported/i);
    }
  });

  it("throws for any non-AUD currency", () => {
    for (const v of ["eur", "gbp", "jpy", "cad", "nzd"]) {
      expect(() => assertAudCurrency(v)).toThrow(/must be created in AUD/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Repo-wide static guard: every literal `currency:` inside a Stripe payload
// (checkout session, price_data, shipping_rate_data.fixed_amount, prices.create)
// must be "aud". A regression that types `currency: "usd"` anywhere in the
// production code paths fails this test.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip vendor, generated, and test-only dirs.
      if (["node_modules", "dist", ".git", ".turbo", ".next"].includes(entry)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SRC_ROOT = join(process.cwd(), "src");
const SOURCE_FILES = walk(SRC_ROOT);

// Files that legitimately contain the string 'usd' for reasons unrelated to
// live Stripe payloads (guard implementation, error messages, legacy audit
// lookups). Anything outside this allowlist is a regression.
const USD_STRING_ALLOWLIST = new Set<string>([
  join(SRC_ROOT, "lib", "stripe.server.ts"),
  join(SRC_ROOT, "lib", "audCurrencyGuard.test.ts"),
  join(SRC_ROOT, "lib", "stripeMaintenance.functions.ts"),
  join(SRC_ROOT, "routes", "_authenticated", "admin.settings.tsx"),
  join(SRC_ROOT, "lib", "store.functions.ts"),
]);

describe("Stripe payloads never use USD", () => {
  it("has no `currency: \"usd\"` (or 'usd') literal anywhere in src/", () => {
    const offenders: string[] = [];
    const literal = /currency\s*:\s*["'`]usd["'`]/i;
    for (const file of SOURCE_FILES) {
      const src = readFileSync(file, "utf8");
      if (literal.test(src)) offenders.push(file);
    }
    expect(offenders, `Found USD currency literal in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every literal `currency:` inside a Stripe payload in src/lib/store.functions.ts is 'aud'", () => {
    const src = readFileSync(join(SRC_ROOT, "lib", "store.functions.ts"), "utf8");
    const matches = [...src.matchAll(/currency\s*:\s*["'`]([a-zA-Z]{3})["'`]/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m[1].toLowerCase(), `Non-AUD currency literal: ${m[0]}`).toBe("aud");
    }
  });

  it("does not leak any USD string outside the audit/guard allowlist", () => {
    const usdWord = /\busd\b/i;
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      if (USD_STRING_ALLOWLIST.has(file)) continue;
      const src = readFileSync(file, "utf8");
      if (usdWord.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `Unexpected USD reference outside allowlist:\n  - ${offenders.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("every stripe.prices.create call site passes the value through assertAudCurrency", () => {
    // Files that call stripe.prices.create MUST import assertAudCurrency and
    // use it on the currency argument. This is the runtime backstop that
    // rejects a copied USD source price before hitting Stripe.
    const filesWithPriceCreate: string[] = [];
    for (const file of SOURCE_FILES) {
      const src = readFileSync(file, "utf8");
      if (/stripe\.prices\.create\s*\(/.test(src)) filesWithPriceCreate.push(file);
    }
    expect(filesWithPriceCreate.length).toBeGreaterThan(0);
    for (const file of filesWithPriceCreate) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} calls stripe.prices.create but doesn't import assertAudCurrency`)
        .toMatch(/assertAudCurrency/);
      // Every prices.create block should contain `assertAudCurrency(` nearby.
      const blocks = [...src.matchAll(/stripe\.prices\.create\s*\(([\s\S]*?)\}\s*\)/g)];
      for (const [, body] of blocks) {
        expect(body, `stripe.prices.create in ${file} missing assertAudCurrency:\n${body}`)
          .toMatch(/assertAudCurrency\s*\(/);
      }
    }
  });
});
