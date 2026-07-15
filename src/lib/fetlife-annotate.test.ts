import { describe, it, expect } from "vitest";
import { annotateFetlifeHandleInput } from "./fetlife-annotate";
import { normalizeFetlifeHandle, FETLIFE_HANDLE_MAX } from "./settings.functions";

/**
 * Contract tests for the live-preview annotator used by the FetLife handle
 * input in admin Settings. The union of segment texts MUST always equal the
 * raw input, and the concatenation of `kept` segments MUST always equal
 * `normalizeFetlifeHandle(raw)` (minus invalid-flagged chars) — these
 * invariants let the UI safely render segments concatenated without
 * losing user-typed characters.
 */

function joinAll(raw: string) {
  return annotateFetlifeHandleInput(raw)
    .map((s) => s.text)
    .join("");
}

function joinKept(raw: string) {
  return annotateFetlifeHandleInput(raw)
    .filter((s) => s.kind === "kept")
    .map((s) => s.text)
    .join("");
}

describe("annotateFetlifeHandleInput — invariants", () => {
  const samples = [
    "",
    "queen",
    "@queen",
    "  queen  ",
    "https://fetlife.com/queen",
    "https://www.fetlife.com/queen/photos",
    "queen?ref=x",
    "queen#bio",
    "bad space",
    "bad!chars",
    "queen\n",
    "queen\t",
    "queen\x00",
    "a".repeat(FETLIFE_HANDLE_MAX + 5),
    "@@//queen",
    "/queen",
    "https://evil.com/queen",
    "HTTPS://FetLife.com/queen",
  ];

  it.each(samples)("concatenated segments equal raw input: %j", (raw) => {
    expect(joinAll(raw)).toBe(raw);
  });

  it.each(samples)(
    "kept-only segments equal normalizeFetlifeHandle(raw) when no invalid chars remain: %j",
    (raw) => {
      const kept = joinKept(raw);
      const normalized = normalizeFetlifeHandle(raw);
      const invalidCount = annotateFetlifeHandleInput(raw).filter(
        (s) => s.kind === "invalid",
      ).length;
      if (invalidCount === 0) {
        expect(kept).toBe(normalized);
      } else {
        // When there are invalid chars, they were part of the normalized
        // string but flagged red — kept + invalid still equals normalized.
        const keptPlusInvalid = annotateFetlifeHandleInput(raw)
          .filter((s) => s.kind === "kept" || s.kind === "invalid")
          .map((s) => s.text)
          .join("");
        // Cap by FETLIFE_HANDLE_MAX because chars past the cap are marked
        // invalid even though `normalizeFetlifeHandle` doesn't truncate.
        expect(keptPlusInvalid).toBe(normalized);
      }
    },
  );
});

describe("annotateFetlifeHandleInput — segment classification", () => {
  it("marks a plain valid handle entirely kept", () => {
    expect(annotateFetlifeHandleInput("Gloryhole-Queen")).toEqual([
      { kind: "kept", text: "Gloryhole-Queen" },
    ]);
  });

  it("marks surrounding whitespace stripped", () => {
    expect(annotateFetlifeHandleInput("  queen  ")).toEqual([
      { kind: "stripped", text: "  " },
      { kind: "kept", text: "queen" },
      { kind: "stripped", text: "  " },
    ]);
  });

  it("marks a fetlife URL prefix stripped and the handle kept", () => {
    expect(annotateFetlifeHandleInput("https://fetlife.com/queen")).toEqual([
      { kind: "stripped", text: "https://fetlife.com/" },
      { kind: "kept", text: "queen" },
    ]);
  });

  it("marks www. subdomain and trailing sub-path stripped", () => {
    expect(
      annotateFetlifeHandleInput("https://www.fetlife.com/queen/photos"),
    ).toEqual([
      { kind: "stripped", text: "https://www.fetlife.com/" },
      { kind: "kept", text: "queen" },
      { kind: "stripped", text: "/photos" },
    ]);
  });

  it("marks a leading @ stripped", () => {
    expect(annotateFetlifeHandleInput("@queen")).toEqual([
      { kind: "stripped", text: "@" },
      { kind: "kept", text: "queen" },
    ]);
  });

  it("marks a disallowed character invalid (not stripped)", () => {
    expect(annotateFetlifeHandleInput("bad!chars")).toEqual([
      { kind: "kept", text: "bad" },
      { kind: "invalid", text: "!" },
      { kind: "kept", text: "chars" },
    ]);
  });

  it("marks whitespace inside the handle invalid (splits kept segments)", () => {
    // A space inside the handle isn't stripped by the normalizer — it
    // survives into the kept portion, so we flag it invalid.
    expect(annotateFetlifeHandleInput("bad space")).toEqual([
      { kind: "kept", text: "bad" },
      { kind: "invalid", text: " " },
      { kind: "kept", text: "space" },
    ]);
  });

  it("marks a trailing newline invalid", () => {
    // Trailing whitespace at the very end of the input is stripped, but
    // a newline that appears mid-handle (before any other whitespace) is
    // a control char and must be flagged.
    const segs = annotateFetlifeHandleInput("que\nen");
    expect(segs).toEqual([
      { kind: "kept", text: "que" },
      { kind: "invalid", text: "\n" },
      { kind: "kept", text: "en" },
    ]);
  });

  it("marks a NUL byte invalid", () => {
    expect(annotateFetlifeHandleInput("q\x00ueen")).toEqual([
      { kind: "kept", text: "q" },
      { kind: "invalid", text: "\x00" },
      { kind: "kept", text: "ueen" },
    ]);
  });

  it("marks characters past FETLIFE_HANDLE_MAX invalid", () => {
    const raw = "a".repeat(FETLIFE_HANDLE_MAX + 3);
    const segs = annotateFetlifeHandleInput(raw);
    expect(segs).toEqual([
      { kind: "kept", text: "a".repeat(FETLIFE_HANDLE_MAX) },
      { kind: "invalid", text: "aaa" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(annotateFetlifeHandleInput("")).toEqual([]);
    expect(annotateFetlifeHandleInput(null)).toEqual([]);
    expect(annotateFetlifeHandleInput(undefined)).toEqual([]);
  });

  it("handles a wrong-host URL by stripping nothing and flagging illegal chars", () => {
    // `https://evil.com/queen` isn't matched by the fetlife URL-prefix regex,
    // so the URL prefix isn't stripped. Path split at the first `/` drops
    // the second half, leaving `https:` in the head. Every char of `https:`
    // is either valid (letters) or invalid (`:`).
    expect(annotateFetlifeHandleInput("https://evil.com/queen")).toEqual([
      { kind: "kept", text: "https" },
      { kind: "invalid", text: ":" },
      { kind: "stripped", text: "//evil.com/queen" },
    ]);
  });
});
