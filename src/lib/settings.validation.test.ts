import { describe, it, expect } from "vitest";
import {
  validateContactEmail,
  validateFetlifeHandle,
  normalizeFetlifeHandle,
  contactSettingsUpdateSchema,
  CONTACT_EMAIL_MAX,
  FETLIFE_HANDLE_MAX,
  SESSION_PRICE_MIN_CENTS,
  SESSION_PRICE_MAX_CENTS,
  SESSION_DURATION_MIN_MINUTES,
  SESSION_DURATION_MAX_MINUTES,
} from "./settings.functions";

// A payload that, apart from the field under test, always passes.
const validPayload = {
  email: "midnight-glory@princesspink90.com",
  fetlife_handle: "Gloryhole-Queen",
  reddit_handle: "19pink-princess90",
  glory_holes_enabled: true,
  session_price_cents: 27_500,
  session_duration_minutes: 60,
};

describe("client-side validators (mirror of server schema)", () => {
  describe("validateContactEmail", () => {
    it("accepts a normal address", () => {
      expect(validateContactEmail("midnight-glory@princesspink90.com")).toBeNull();
    });
    it("trims surrounding whitespace before validating", () => {
      expect(validateContactEmail("  a@b.co  ")).toBeNull();
    });
    it("rejects empty / whitespace-only", () => {
      expect(validateContactEmail("")).toMatch(/required/i);
      expect(validateContactEmail("   ")).toMatch(/required/i);
    });
    it("rejects obviously malformed addresses", () => {
      for (const bad of ["not-an-email", "a@b", "@b.co", "a@ b.co", "a b@c.co"]) {
        expect(validateContactEmail(bad), bad).toMatch(/valid email/i);
      }
    });
    it("rejects addresses over the max length", () => {
      const long = "a".repeat(CONTACT_EMAIL_MAX) + "@b.co";
      expect(validateContactEmail(long)).toMatch(/255/);
    });
  });

  describe("validateFetlifeHandle / normalizeFetlifeHandle", () => {
    it("accepts a plain handle", () => {
      expect(validateFetlifeHandle("Gloryhole-Queen")).toBeNull();
    });
    it("normalizes @, /, and full profile URLs", () => {
      expect(normalizeFetlifeHandle("@Gloryhole-Queen")).toBe("Gloryhole-Queen");
      expect(normalizeFetlifeHandle("https://fetlife.com/Gloryhole-Queen")).toBe(
        "Gloryhole-Queen",
      );
      expect(
        normalizeFetlifeHandle("https://www.fetlife.com/Gloryhole-Queen/photos"),
      ).toBe("Gloryhole-Queen");
    });
    it("rejects empty, too-short, too-long, and illegal characters", () => {
      expect(validateFetlifeHandle("")).toMatch(/required/i);
      expect(validateFetlifeHandle("ab")).toMatch(/at least/i);
      expect(validateFetlifeHandle("a".repeat(FETLIFE_HANDLE_MAX + 1))).toMatch(
        /or fewer/i,
      );
      expect(validateFetlifeHandle("bad space")).toMatch(/letters, digits/i);
      expect(validateFetlifeHandle("bad!chars")).toMatch(/letters, digits/i);
    });
  });
});

describe("server-side schema (contactSettingsUpdateSchema)", () => {
  it("accepts a valid payload and normalizes the fetlife handle", () => {
    const parsed = contactSettingsUpdateSchema.parse({
      ...validPayload,
      fetlife_handle: "https://fetlife.com/Gloryhole-Queen",
      email: "  midnight-glory@princesspink90.com  ",
    });
    expect(parsed.fetlife_handle).toBe("Gloryhole-Queen");
    expect(parsed.email).toBe("midnight-glory@princesspink90.com");
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["blank email", { email: "" }],
    ["malformed email", { email: "not-an-email" }],
    ["email over 255 chars", { email: "a".repeat(260) + "@b.co" }],
    ["blank fetlife handle", { fetlife_handle: "" }],
    ["fetlife handle too short", { fetlife_handle: "ab" }],
    ["fetlife handle too long", { fetlife_handle: "a".repeat(FETLIFE_HANDLE_MAX + 1) }],
    ["fetlife handle with spaces", { fetlife_handle: "bad handle" }],
    ["fetlife handle with illegal chars", { fetlife_handle: "bad!chars" }],
    ["fetlife handle with control char (newline)", { fetlife_handle: "queen\n" }],
    ["fetlife handle with tab", { fetlife_handle: "que\tueen" }],
    ["fetlife handle with NUL byte", { fetlife_handle: "queen\x00" }],
    ["fetlife URL with wrong host", { fetlife_handle: "https://evil.com/queen" }],
    ["fetlife URL with only slashes", { fetlife_handle: "https://fetlife.com///" }],
    ["fetlife raw input over cap", { fetlife_handle: "a".repeat(600) }],
    ["fetlife handle non-string", { fetlife_handle: 42 }],
    ["fetlife handle null", { fetlife_handle: null }],
    ["blank reddit handle", { reddit_handle: "" }],
    ["non-boolean glory_holes_enabled", { glory_holes_enabled: "yes" }],
    ["price below minimum", { session_price_cents: SESSION_PRICE_MIN_CENTS - 1 }],
    ["price above maximum", { session_price_cents: SESSION_PRICE_MAX_CENTS + 1 }],
    ["non-integer price", { session_price_cents: 27_500.5 }],
    ["duration below minimum", { session_duration_minutes: SESSION_DURATION_MIN_MINUTES - 1 }],
    ["duration above maximum", { session_duration_minutes: SESSION_DURATION_MAX_MINUTES + 1 }],
    ["non-integer duration", { session_duration_minutes: 45.5 }],
  ];

  it.each(cases)("rejects: %s", (_label, override) => {
    const result = contactSettingsUpdateSchema.safeParse({ ...validPayload, ...override });
    expect(result.success).toBe(false);
  });

  it("surfaces the exact FetLife handle reason (wrong host)", () => {
    const r = contactSettingsUpdateSchema.safeParse({
      ...validPayload,
      fetlife_handle: "https://evil.com/queen",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" | ");
      expect(msg).toMatch(/host must be fetlife\.com/i);
    }
  });

  it("surfaces the exact FetLife handle reason (control char)", () => {
    const r = contactSettingsUpdateSchema.safeParse({
      ...validPayload,
      fetlife_handle: "queen\n",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" | ");
      expect(msg).toMatch(/control character/i);
    }
  });


  it("accepts the min/max boundary values for price and duration", () => {
    expect(
      contactSettingsUpdateSchema.safeParse({
        ...validPayload,
        session_price_cents: SESSION_PRICE_MIN_CENTS,
        session_duration_minutes: SESSION_DURATION_MIN_MINUTES,
      }).success,
    ).toBe(true);
    expect(
      contactSettingsUpdateSchema.safeParse({
        ...validPayload,
        session_price_cents: SESSION_PRICE_MAX_CENTS,
        session_duration_minutes: SESSION_DURATION_MAX_MINUTES,
      }).success,
    ).toBe(true);
  });
});

describe("client and server validators agree", () => {
  const emailSamples = [
    "midnight-glory@princesspink90.com",
    "",
    "   ",
    "not-an-email",
    "a@b",
    "a".repeat(300) + "@b.co",
  ];
  it.each(emailSamples)("email %j: client-null iff server-ok", (sample) => {
    const clientOk = validateContactEmail(sample) === null;
    const serverOk = contactSettingsUpdateSchema.safeParse({
      ...validPayload,
      email: sample,
    }).success;
    expect(clientOk).toBe(serverOk);
  });

  const handleSamples = [
    "Gloryhole-Queen",
    "@Gloryhole-Queen",
    "https://fetlife.com/Gloryhole-Queen",
    "",
    "ab",
    "a".repeat(FETLIFE_HANDLE_MAX + 1),
    "bad space",
    "bad!chars",
  ];
  it.each(handleSamples)("fetlife %j: client-null iff server-ok", (sample) => {
    const clientOk = validateFetlifeHandle(sample) === null;
    const serverOk = contactSettingsUpdateSchema.safeParse({
      ...validPayload,
      fetlife_handle: sample,
    }).success;
    expect(clientOk).toBe(serverOk);
  });
});
