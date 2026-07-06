import { describe, expect, it, vi } from "vitest";
import {
  escapePostgrestLikePattern,
  lookupCheckinQuery,
} from "@/lib/checkin.functions";

/**
 * These tests lock in the injection-safe query shape for lookupCheckin:
 *
 *   - user-supplied ticket_code is filtered via parameterised .eq() /
 *     .ilike() builder calls, never spliced into a raw .or() string;
 *   - PostgREST ilike wildcards (%, _, \) in user input are escaped, so
 *     a caller can't match every row in the event with "%" or bypass
 *     narrowing with "_";
 *   - the event_id AND-filter is always applied first so cross-event
 *     access is impossible regardless of what the user pastes.
 */

type Call = { method: string; args: unknown[] };

function makeSupabaseSpy(rows: Record<string, any> = {}) {
  const calls: Call[] = [];

  const makeBuilder = () => {
    // Track filters applied to this builder so the maybeSingle() at the
    // end can look up the "expected" match row.
    const filters: Record<string, unknown> = {};
    const builder: any = {
      _kind: "builder",
      select: vi.fn((cols: string) => {
        calls.push({ method: "select", args: [cols] });
        return builder;
      }),
      eq: vi.fn((col: string, value: unknown) => {
        calls.push({ method: "eq", args: [col, value] });
        filters[`eq:${col}`] = value;
        return builder;
      }),
      ilike: vi.fn((col: string, value: unknown) => {
        calls.push({ method: "ilike", args: [col, value] });
        filters[`ilike:${col}`] = value;
        return builder;
      }),
      or: vi.fn((expr: string) => {
        calls.push({ method: "or", args: [expr] });
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        calls.push({ method: "maybeSingle", args: [] });
        // Return a hit only for the specific parameterised column the test
        // seeded, e.g. rows["eq:ticket_code:ABC123"] = { id: "..." }.
        for (const [key, value] of Object.entries(filters)) {
          const hit = rows[`${key}:${String(value)}`];
          if (hit) return { data: hit, error: null };
        }
        return { data: null, error: null };
      }),
    };
    return builder;
  };

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ method: "from", args: [table] });
      return makeBuilder();
    }),
  };

  return { supabase, calls };
}

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

describe("escapePostgrestLikePattern", () => {
  it("escapes %, _, and backslash so PostgREST treats them as literals", () => {
    expect(escapePostgrestLikePattern("%")).toBe("\\%");
    expect(escapePostgrestLikePattern("_")).toBe("\\_");
    expect(escapePostgrestLikePattern("\\")).toBe("\\\\");
    expect(escapePostgrestLikePattern("100%_off\\now")).toBe(
      "100\\%\\_off\\\\now",
    );
  });

  it("leaves non-wildcard characters untouched", () => {
    expect(escapePostgrestLikePattern("Velvet Night")).toBe("Velvet Night");
    expect(escapePostgrestLikePattern("PINK-42")).toBe("PINK-42");
    // Commas and dots (PostgREST .or() separators) don't need escaping here
    // because we never build a raw .or() string.
    expect(escapePostgrestLikePattern("a,b.c")).toBe("a,b.c");
  });
});

describe("lookupCheckinQuery", () => {
  it("never calls .or() — every filter is a parameterised builder call", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "ABC123",
    });
    expect(calls.some((c) => c.method === "or")).toBe(false);
  });

  it("scopes every query to event_id via .eq() before matching the ticket", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "ABC123",
    });
    const eventFilters = calls.filter(
      (c) => c.method === "eq" && c.args[0] === "event_id",
    );
    // ticket_code + entry_code + entry_phrase branch = 3 queries.
    expect(eventFilters).toHaveLength(3);
    for (const call of eventFilters) {
      expect(call.args[1]).toBe(EVENT_ID);
    }
  });

  it("uppercases the ticket code and issues eq() on ticket_code and entry_code", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "abc123",
    });
    const ticketEq = calls.find(
      (c) => c.method === "eq" && c.args[0] === "ticket_code",
    );
    const entryEq = calls.find(
      (c) => c.method === "eq" && c.args[0] === "entry_code",
    );
    expect(ticketEq?.args[1]).toBe("ABC123");
    expect(entryEq?.args[1]).toBe("ABC123");
  });

  it("passes an escaped ilike pattern for entry_phrase (blocks wildcard matching)", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "%",
    });
    const ilikeCall = calls.find(
      (c) => c.method === "ilike" && c.args[0] === "entry_phrase",
    );
    expect(ilikeCall).toBeTruthy();
    // Raw `%` would match every row; the escaped literal must not.
    expect(ilikeCall!.args[1]).toBe("\\%");
    expect(ilikeCall!.args[1]).not.toBe("%");
  });

  it("escapes PostgREST separators embedded in a phrase — cannot inject extra clauses", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    // Classic .or()-injection payload: commas, wildcards, and a trailing
    // fake clause. With parameterised builders this is treated as one
    // opaque literal, not filter syntax.
    const evil = "%,ticket_code.eq.OTHER,entry_phrase.ilike.%";
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: evil,
    });
    const ilikeCall = calls.find(
      (c) => c.method === "ilike" && c.args[0] === "entry_phrase",
    );
    // Wildcards escaped, commas/dots preserved as literal chars, and the
    // whole payload arrives as a single value — not parsed as filter syntax.
    expect(ilikeCall!.args[1]).toBe(
      "\\%,ticket\\_code.eq.OTHER,entry\\_phrase.ilike.\\%",
    );

    // And critically no .or() call was ever made.
    expect(calls.some((c) => c.method === "or")).toBe(false);
  });

  it("skips the entry_phrase query entirely for whitespace-only input", async () => {
    const { supabase, calls } = makeSupabaseSpy();
    // The zod validator on the server fn enforces min length, but the
    // internal helper still honours the DB trigger's normalization so a
    // trimmed-empty input can never reach ilike("entry_phrase", "").
    await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "   ",
    });
    expect(calls.some((c) => c.method === "ilike")).toBe(false);
    // Only the two eq-branch queries ran (ticket_code + entry_code).
    expect(calls.filter((c) => c.method === "maybeSingle")).toHaveLength(2);
  });

  it("returns the first matching row across the three parameterised queries", async () => {
    const hit = { id: "rsvp-1", user_id: "u1" };
    const { supabase } = makeSupabaseSpy({
      "ilike:entry_phrase:Velvet Night": hit,
    });
    const result = await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "Velvet Night",
    });
    expect(result.rsvp).toEqual(hit);
  });

  it("returns null when nothing matches", async () => {
    const { supabase } = makeSupabaseSpy();
    const result = await lookupCheckinQuery(supabase, {
      event_id: EVENT_ID,
      ticket_code: "NOPE",
    });
    expect(result.rsvp).toBeNull();
  });

  it("propagates a Supabase error from any branch", async () => {
    const boom = { message: "db exploded" };
    // Custom supabase whose entry_code query returns an error.
    const supabase: any = {
      from: () => {
        let col: string | null = null;
        const b: any = {
          select: () => b,
          eq: (c: string, _v: unknown) => {
            if (c !== "event_id") col = c;
            return b;
          },
          ilike: (c: string) => {
            col = c;
            return b;
          },
          maybeSingle: async () =>
            col === "entry_code"
              ? { data: null, error: boom }
              : { data: null, error: null },
        };
        return b;
      },
    };
    await expect(
      lookupCheckinQuery(supabase, {
        event_id: EVENT_ID,
        ticket_code: "ABC123",
      }),
    ).rejects.toBe(boom);
  });
});
