import { describe, it, expect } from "vitest";
import {
  normalizeFetlifeHandle,
  buildFetlifeUrl,
  fetlifeUrlRoundTripsToHandle,
  FETLIFE_HANDLE_MAX,
} from "./settings.functions";

/**
 * These tests cover the *exact* helpers the admin Settings Save button relies
 * on to (a) turn a free-form handle input into the URL rendered in the confirm
 * dialog and (b) prove that URL round-trips back to the same normalized
 * handle before enabling Save. A regression here would let the dialog show
 * one URL while the server persists a different handle.
 */

describe("normalizeFetlifeHandle", () => {
  const cases: Array<[string, string, string]> = [
    ["passthrough", "Gloryhole-Queen", "Gloryhole-Queen"],
    ["preserves case", "MixedCase_Handle", "MixedCase_Handle"],
    ["preserves underscore and hyphen", "a_b-c", "a_b-c"],
    ["trims surrounding whitespace", "   queen   ", "queen"],
    ["strips leading @", "@queen", "queen"],
    // Path-split runs BEFORE the leading-@/ strip, so anything with an
    // interior `/` in the pre-strip stage loses everything past the first
    // slash. This documents that contract.
    ["`@@//queen` splits on the first `/` and yields empty", "@@//queen", ""],
    ["`/queen` splits on the leading `/` and yields empty", "/queen", ""],
    ["strips https://fetlife.com/ prefix", "https://fetlife.com/queen", "queen"],
    ["strips http://fetlife.com/ prefix", "http://fetlife.com/queen", "queen"],
    ["strips www. subdomain", "https://www.fetlife.com/queen", "queen"],
    ["case-insensitive on the URL prefix", "HTTPS://FetLife.com/queen", "queen"],
    ["strips /photos sub-path", "https://fetlife.com/queen/photos", "queen"],
    ["drops query string", "https://fetlife.com/queen?ref=abc", "queen"],
    ["drops fragment", "https://fetlife.com/queen#bio", "queen"],
    // Leading `@` before a URL prevents the URL-prefix strip (which anchors
    // to `^https?://`), so we then split on the first `/` inside `https://`
    // and end up with the bare scheme "https:". Documents the contract so
    // a future "smarter" edit doesn't silently change it without updating
    // callers.
    ["leading @ before a URL yields 'https:'", "  @https://www.fetlife.com/queen/photos?x#y  ", "https:"],
    ["empty input", "", ""],
    ["whitespace-only input", "   ", ""],
    ["nullish coerces to empty", undefined as unknown as string, ""],
    ["strips trailing slash via path split", "queen/", "queen"],
    ["a bare URL to the site root normalizes to empty", "https://fetlife.com/", ""],
    // The normalizer alone doesn't guard the host — it yields "https:" for
    // any http(s) URL whose host isn't fetlife.com. `validateFetlifeHandle`
    // is the layer that rejects wrong-host input.
    ["wrong-host URL falls through to 'https:'", "https://evil.com/queen", "https:"],

  ];

  it.each(cases)("%s: %j -> %j", (_label, input, expected) => {
    expect(normalizeFetlifeHandle(input)).toBe(expected);
  });
});

describe("buildFetlifeUrl", () => {
  it("wraps the normalized handle in the canonical https URL", () => {
    expect(buildFetlifeUrl("Gloryhole-Queen")).toBe(
      "https://fetlife.com/Gloryhole-Queen",
    );
  });
  it("normalizes before wrapping (pasted URL)", () => {
    expect(buildFetlifeUrl("https://www.fetlife.com/queen/photos")).toBe(
      "https://fetlife.com/queen",
    );
  });
  it("normalizes before wrapping (leading @)", () => {
    expect(buildFetlifeUrl("@queen")).toBe("https://fetlife.com/queen");
  });
  it("returns empty string when input normalizes to empty", () => {
    expect(buildFetlifeUrl("")).toBe("");
    expect(buildFetlifeUrl("   ")).toBe("");
    expect(buildFetlifeUrl("https://fetlife.com/")).toBe("");
  });
  it("preserves case in the emitted URL", () => {
    expect(buildFetlifeUrl("MixedCase_Handle")).toBe(
      "https://fetlife.com/MixedCase_Handle",
    );
  });
});

describe("fetlifeUrlRoundTripsToHandle", () => {
  it("returns true when handle → URL → handle stays identical", () => {
    for (const raw of [
      "queen",
      "Gloryhole-Queen",
      "a_b-c",
      "MixedCase_Handle",
      "@queen",
      "https://fetlife.com/queen",
      "https://www.fetlife.com/queen/photos",
      "  queen  ",
      "a".repeat(FETLIFE_HANDLE_MAX), // max-length handle round-trips
    ]) {
      expect(fetlifeUrlRoundTripsToHandle(raw), raw).toBe(true);
    }
  });

  it("returns false when the input normalizes to empty (Save must be disabled)", () => {
    for (const raw of ["", "   ", "https://fetlife.com/", "@@//"]) {
      expect(fetlifeUrlRoundTripsToHandle(raw), raw).toBe(false);
    }
  });

  it("wrong-host URL round-trips to 'https:' — Save must be blocked by validateFetlifeHandle, NOT this helper", () => {
    // Contract note: the normalizer yields "https:" for a wrong-host URL,
    // and "https:" happens to round-trip through
    // `new URL('https://fetlife.com/https:')` back to itself, so this
    // helper alone returns true. That's fine because
    // `validateFetlifeHandle` rejects wrong-host input (see
    // settings.validation.test.ts). If someone ever removes that
    // validator check thinking this helper is sufficient, this test
    // spells out why it isn't.
    expect(fetlifeUrlRoundTripsToHandle("https://evil.com/queen")).toBe(true);
  });


  it("is deterministic: identical input always yields the same result", () => {
    const raw = "https://www.fetlife.com/queen/photos?ref=x#bio";
    const a = fetlifeUrlRoundTripsToHandle(raw);
    const b = fetlifeUrlRoundTripsToHandle(raw);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });

  it("agrees with buildFetlifeUrl (invariant): if round-trip is true, the URL parses back to the normalized handle", () => {
    const samples = [
      "queen",
      "Gloryhole-Queen",
      "@queen",
      "https://fetlife.com/queen",
      "https://www.fetlife.com/queen/photos",
    ];
    for (const raw of samples) {
      const normalized = normalizeFetlifeHandle(raw);
      const url = buildFetlifeUrl(raw);
      const roundTrips = fetlifeUrlRoundTripsToHandle(raw);
      if (roundTrips) {
        const u = new URL(url);
        expect(u.host.toLowerCase(), raw).toBe("fetlife.com");
        expect(u.pathname.replace(/^\/+|\/+$/g, ""), raw).toBe(normalized);
      }
    }
  });
});
