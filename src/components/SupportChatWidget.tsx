import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessageCircle, X, Send, CalendarClock, Loader2, Globe } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  listConciergeSlots,
  getConciergeBookingStatuses,
  type ConciergeSlot,
} from "@/lib/concierge.functions";
import { createBookingInvoice } from "@/lib/bookingInvoice.functions";
import {
  loadConciergeHistory,
  saveConciergeHistory,
} from "@/lib/concierge-history.functions";
import { supabase } from "@/integrations/supabase/client";


/**
 * Booking Concierge widget.
 *
 * Message parts are more than plain text so the LLM (or a local quick
 * action) can drop interactive cards into the feed:
 *   - `text`      → regular chat bubble.
 *   - `slots`     → live availability grid; each button proposes a slot.
 *   - `confirm`   → confirm-and-pay card for a specific slot.
 *
 * See `src/routes/api/concierge/chat.ts` for the LLM contract and where to
 * plug in your provider.
 */

type ChatRole = "user" | "assistant" | "system";

type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "failed"
  | "refunded"
  | string;

type LeadDetails = { name: string; email: string; phone: string };

type MessagePart =
  | { type: "text"; text: string }
  | { type: "slots"; slots: ConciergeSlot[] }
  | { type: "confirm"; slot: ConciergeSlot }
  | {
      type: "booking";
      bookingId: string;
      startsAt: string;
      status: BookingStatus;
    }
  | {
      type: "lead";
      /** Slot the form was raised for so we can resume the confirm on submit. */
      slot: ConciergeSlot;
      /** Filled once the user submits — freezes the card into a summary. */
      submitted?: LeadDetails;
    };

type ChatMessage = {
  role: ChatRole;
  parts: MessagePart[];
};

type ConciergeReply = {
  reply: string;
  tool?: { name: "show_slots"; args?: { horizonDays?: number; limit?: number } } | { name: "none" };
};

const INITIAL_GREETING: ChatMessage = {
  role: "assistant",
  parts: [
    {
      type: "text",
      text:
        "Hi — I'm the Booking Concierge. I can check live Private Room availability and hold a slot for you. Tap 'Check availability' or just ask.",
    },
  ],
};

const LOCAL_KEY = "concierge:history:v1";
const TZ_KEY = "concierge:tz:v1";

/**
 * Curated shortlist of common timezones for the concierge selector. The
 * user's detected browser zone is always injected first so the default is
 * one tap away even when it's not on this list.
 */
const TIMEZONE_CHOICES: string[] = [
  "Pacific/Auckland",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function readStoredTimezone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TZ_KEY);
  } catch {
    return null;
  }
}

function writeStoredTimezone(tz: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* ignore quota */
  }
}

// --- Lead details (name/email/phone) -----------------------------------
const LEAD_KEY = "concierge:lead:v1";
const EMPTY_LEAD: LeadDetails = { name: "", email: "", phone: "" };

function readStoredLead(): LeadDetails | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeadDetails>;
    if (!parsed?.name || !parsed?.email || !parsed?.phone) return null;
    return { name: parsed.name, email: parsed.email, phone: parsed.phone };
  } catch {
    return null;
  }
}

function writeStoredLead(lead: LeadDetails) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEAD_KEY, JSON.stringify(lead));
  } catch {
    /* quota — ignore */
  }
}

function validateLead(lead: LeadDetails): string | null {
  const name = lead.name.trim();
  const email = lead.email.trim();
  const phone = lead.phone.trim();
  if (name.length < 2) return "Please enter your name.";
  if (name.length > 120) return "Name is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email.";
  if (email.length > 255) return "Email is too long.";
  if (phone.replace(/\D/g, "").length < 6) return "Please enter a valid phone number.";
  if (phone.length > 40) return "Phone number is too long.";
  return null;
}




const TERMINAL_STATUSES = new Set(["confirmed", "cancelled", "failed", "refunded"]);

function statusLabel(status: string): { label: string; tone: "info" | "warn" | "ok" | "err" } {
  switch (status) {
    case "pending":
    case "awaiting_payment":
      return { label: "Pending payment", tone: "warn" };
    case "confirmed":
      return { label: "Confirmed", tone: "ok" };
    case "cancelled":
      return { label: "Cancelled", tone: "err" };
    case "failed":
      return { label: "Payment failed", tone: "err" };
    case "refunded":
      return { label: "Refunded", tone: "info" };
    default:
      return { label: status.replace(/_/g, " "), tone: "info" };
  }
}

function statusNarration(status: string, startsAt: string, timeZone?: string): string {
  const when = new Date(startsAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone ? "short" : undefined,
  });
  switch (status) {
    case "confirmed":
      return `✅ Booking confirmed for ${when}. You'll get an email receipt shortly.`;
    case "cancelled":
      return `❌ Booking for ${when} was cancelled.`;
    case "failed":
      return `⚠️ Payment failed for the ${when} booking. Try again or pick another slot.`;
    case "refunded":
      return `↩️ Your ${when} booking was refunded.`;
    case "awaiting_payment":
      return `⏳ Still waiting on payment confirmation for ${when}.`;
    default:
      return `Booking for ${when}: ${status}.`;
  }
}

function readLocal(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return sanitizeMessages(parsed);
  } catch {
    return [];
  }
}

function writeLocal(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(messages.slice(-200)));
  } catch {
    /* quota — ignore */
  }
}

function clearLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const parts = (m as { parts?: unknown }).parts;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (!Array.isArray(parts)) continue;
    out.push({ role, parts: parts as MessagePart[] });
  }
  return out;
}


export function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [pending, setPending] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null); // ISO of slot currently being booked
  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Timezone selector — initialize from saved preference, else browser zone.
  // `useState` initializer is client-safe here because the widget is only
  // rendered inside the app shell after hydration; guards inside the
  // helpers keep SSR-friendly if that ever changes.
  const [timezone, setTimezone] = useState<string>(
    () => readStoredTimezone() ?? detectBrowserTimezone(),
  );
  // Lead-capture — persisted per-browser so returning users only fill it
  // once. Also tracks which slot's form is currently being submitted so we
  // can disable the corresponding card.
  const [leadDraft, setLeadDraft] = useState<LeadDetails>(
    () => readStoredLead() ?? EMPTY_LEAD,
  );
  const [pendingLeadSlot, setPendingLeadSlot] = useState<string | null>(null);
  const hasLead = (l: LeadDetails) => validateLead(l) === null;

  // Merge the browser-detected zone with the curated list, dedupe, keep
  // detected zone pinned first for quick reset.
  const browserTz = useMemo(() => detectBrowserTimezone(), []);
  const timezoneOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const z of [browserTz, timezone, ...TIMEZONE_CHOICES]) {
      if (!z || seen.has(z)) continue;
      seen.add(z);
      out.push(z);
    }
    return out;
  }, [browserTz, timezone]);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([INITIAL_GREETING]);

  const fetchSlots = useServerFn(listConciergeSlots);
  const startBooking = useServerFn(createBookingInvoice);
  const loadHistory = useServerFn(loadConciergeHistory);
  const saveHistory = useServerFn(saveConciergeHistory);
  const fetchBookingStatuses = useServerFn(getConciergeBookingStatuses);

  // --- Persistence -----------------------------------------------------
  // Signed-in → server row. Guest → localStorage. If a guest builds up
  // history and then signs in, we merge their local turns into the DB
  // once, then delete the local copy so the two stop drifting.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async (uid: string | null) => {
      const localRaw = readLocal();
      if (uid) {
        try {
          const remote = await loadHistory();
          const remoteMsgs = sanitizeMessages(remote.messages);
          let next: ChatMessage[];
          if (remoteMsgs.length > 0) {
            next = remoteMsgs;
            // Merge any pre-signin guest turns onto the end, then upload.
            if (localRaw.length > 1) {
              next = [...remoteMsgs, ...localRaw.slice(1)];
              await saveHistory({ data: { messages: next as unknown as never[] } });
            }
          } else if (localRaw.length > 0) {
            next = localRaw;
            await saveHistory({ data: { messages: next as unknown as never[] } });
          } else {
            next = [INITIAL_GREETING];
          }
          if (cancelled) return;
          clearLocal();
          setMessages(next);
        } catch {
          // Fall back to local so the widget still opens.
          if (!cancelled) setMessages(localRaw.length ? localRaw : [INITIAL_GREETING]);
        }
      } else {
        if (!cancelled) setMessages(localRaw.length ? localRaw : [INITIAL_GREETING]);
      }
      if (!cancelled) setHydrated(true);
    };

    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      void hydrate(uid);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const uid = session?.user?.id ?? null;
      setUserId((prev) => (prev === uid ? prev : uid));
      // Re-hydrate on identity change (sign-in merges local; sign-out drops to guest).
      setHydrated(false);
      void hydrate(uid);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every message change once we've finished hydrating.
  useEffect(() => {
    messagesRef.current = messages;
    if (!hydrated) return;
    if (userId) {
      // Fire-and-forget; the next change will retry.
      void saveHistory({ data: { messages: messages as unknown as never[] } }).catch(() => {});
    } else {
      writeLocal(messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, hydrated, userId]);

  /**
   * Fold a fresh status into any booking cards in the feed and, if it's a
   * transition (not our initial "pending"), append a narrated status line.
   * Idempotent — no-op when nothing changed.
   */
  const applyBookingStatus = (bookingId: string, status: BookingStatus) => {
    setMessages((prev) => {
      let announced = false;
      let changed = false;
      const next = prev.map((m) => {
        const parts = m.parts.map((p) => {
          if (p.type !== "booking" || p.bookingId !== bookingId) return p;
          if (p.status === status) return p;
          changed = true;
          if (!announced) announced = true;
          return { ...p, status };
        });
        return parts === m.parts ? m : { ...m, parts };
      });
      if (!changed) return prev;
      // Find the tracker's startsAt for the narration.
      let startsAt: string | null = null;
      for (const m of next) {
        for (const p of m.parts) {
          if (p.type === "booking" && p.bookingId === bookingId) {
            startsAt = p.startsAt;
            break;
          }
        }
        if (startsAt) break;
      }
      if (announced && startsAt) {
        return [
          ...next,
          {
            role: "assistant",
            parts: [{ type: "text", text: statusNarration(status, startsAt, timezone) }],
          },
        ];
      }
      return next;
    });
  };

  // Reconcile tracked bookings with the DB on hydrate. Catches the
  // "returned from NOWPayments checkout while chat was closed" case.
  useEffect(() => {
    if (!hydrated || !userId) return;
    const tracked: { bookingId: string; status: BookingStatus }[] = [];
    for (const m of messagesRef.current) {
      for (const p of m.parts) {
        if (p.type === "booking") tracked.push({ bookingId: p.bookingId, status: p.status });
      }
    }
    if (tracked.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchBookingStatuses({
          data: { bookingIds: tracked.map((t) => t.bookingId) },
        });
        if (cancelled) return;
        for (const row of rows) applyBookingStatus(row.id, row.status);
      } catch {
        /* silent — realtime will still cover live updates */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, userId]);

  // Live status updates via realtime while the user is signed in.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`concierge-booking-status:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "private_room_bookings",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; status?: string } | null;
          if (!row?.id || !row.status) return;
          const tracked = messagesRef.current.some((m) =>
            m.parts.some((p) => p.type === "booking" && p.bookingId === row.id),
          );
          if (!tracked) return;
          applyBookingStatus(row.id, row.status);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);





  // Auto-scroll to newest content.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  // Focus management: composer on open, launcher on close.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    launcherRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Any slot card in the feed is instantly stale after the panel was
    // closed — refresh so users never tap a time that's since been taken.
    void refreshSlotCards();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const appendMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);

  /**
   * Fetches live availability and appends a slot-picker card. Used both by
   * the "Check availability" quick action and when the LLM returns
   * `tool.name === "show_slots"`.
   */
  const showLiveSlots = async (args?: { horizonDays?: number; limit?: number }) => {
    try {
      const slots = await fetchSlots({
        data: { horizonDays: args?.horizonDays ?? 7, limit: args?.limit ?? 6 },
      });
      if (slots.length === 0) {
        appendMessage({
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "No open slots in the next week. Try again later or ask me to look further ahead.",
            },
          ],
        });
        return;
      }
      appendMessage({ role: "assistant", parts: [{ type: "slots", slots }] });
    } catch (err) {
      appendMessage({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `⚠️ Couldn't reach availability: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          },
        ],
      });
    }
  };

  /**
   * Silently re-fetch availability and rewrite any `slots` cards already in
   * the feed so stale times don't linger after the chat is reopened or a
   * booking is confirmed. No-op when the feed has no slot cards yet.
   */
  const refreshSlotCards = async () => {
    const hasSlotCard = messagesRef.current.some((m) =>
      m.parts.some((p) => p.type === "slots"),
    );
    if (!hasSlotCard) return;
    try {
      const slots = await fetchSlots({ data: { horizonDays: 7, limit: 6 } });
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.parts.some((p) => p.type === "slots")) return m;
          return {
            ...m,
            parts: m.parts.map((p) => (p.type === "slots" ? { type: "slots", slots } : p)),
          };
        }),
      );
    } catch {
      /* silent — user can hit "Check availability" to retry */
    }
  };

  /**
   * Placeholder LLM call → POST /api/concierge/chat. Swap the endpoint for
   * a real provider without touching the widget.
   */
  const runLlm = async (nextHistory: ChatMessage[]) => {
    // Only the text parts are meaningful to the model — tool cards are
    // rendered client-side artefacts.
    const flatHistory = nextHistory.map((m) => ({
      role: m.role,
      content: m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim(),
    }));
    const res = await fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: flatHistory }),
    });
    if (!res.ok) throw new Error(`Concierge chat error (${res.status})`);
    const data = (await res.json()) as ConciergeReply;
    appendMessage({ role: "assistant", parts: [{ type: "text", text: data.reply }] });
    if (data.tool?.name === "show_slots") {
      await showLiveSlots(data.tool.args);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;
    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", parts: [{ type: "text", text }] },
    ];
    setMessages(nextHistory);
    setInput("");
    setPending(true);
    try {
      await runLlm(nextHistory);
    } catch (err) {
      appendMessage({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`,
          },
        ],
      });
    } finally {
      setPending(false);
    }
  };

  /**
   * User tapped a slot in the availability card → append a confirm card so
   * the booking action is a deliberate two-tap flow (matches /private-room
   * "review then confirm" pattern).
   */
  const proposeSlot = (slot: ConciergeSlot) => {
    appendMessage({ role: "assistant", parts: [{ type: "confirm", slot }] });
  };

  /**
   * Confirm card → start the Create Booking workflow (invoice + pending
   * `private_room_bookings` row) and hand off to checkout.
   */
  const confirmSlot = async (slot: ConciergeSlot) => {
    if (bookingSlot) return;
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      toast.error("Sign in to complete a booking", {
        description: "The concierge needs your account to hold the slot.",
      });
      return;
    }
    setBookingSlot(slot.startsAt);
    try {
      const result = await startBooking({
        data: {
          environment: (import.meta.env.MODE === "production" ? "live" : "sandbox") as
            | "sandbox"
            | "live",
          returnOrigin: window.location.origin,
          roomType: "private_room",
          bookingStartsAt: slot.startsAt,
          bookingPartySize: 1,
        },
      });
      if ("error" in result) {
        appendMessage({
          role: "assistant",
          parts: [{ type: "text", text: `⚠️ Couldn't hold that slot: ${result.error}` }],
        });
        return;
      }
      appendMessage({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Booking created — sending you to secure checkout. The slot is held for 15 minutes.",
          },
          {
            type: "booking",
            bookingId: result.bookingId,
            startsAt: slot.startsAt,
            status: "pending",
          },
        ],
      });
      window.location.href = result.invoiceUrl;
    } catch (err) {
      appendMessage({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `⚠️ Booking failed: ${err instanceof Error ? err.message : "unknown error"}`,
          },
        ],
      });
    } finally {
      setBookingSlot(null);
      // The just-held (or just-failed) slot has changed the world — pull
      // fresh availability so remaining slot cards reflect reality.
      void refreshSlotCards();
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Booking Concierge chat"
          className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
          <span className="sr-only">Open Booking Concierge chat</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Booking Concierge chat"
          aria-modal="false"
          className="fixed bottom-5 right-5 z-[60] flex h-[min(620px,calc(100dvh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10] text-neutral-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              />
              <div>
                <div className="text-sm font-semibold tracking-wide">Booking Concierge</div>
                <div className="text-[11px] text-neutral-400">
                  Live Private Room availability
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Booking Concierge chat"
              className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (pending) return;
                setPending(true);
                void showLiveSlots().finally(() => setPending(false));
              }}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10] disabled:opacity-50"
            >
              <CalendarClock className="h-3 w-3" aria-hidden />
              Check availability
            </button>

            <label className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-neutral-200 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-[#0b0b10]">
              <Globe className="h-3 w-3 text-neutral-400" aria-hidden />
              <span className="sr-only">Display times in timezone</span>
              <select
                value={timezone}
                onChange={(e) => {
                  const tz = e.target.value;
                  setTimezone(tz);
                  writeStoredTimezone(tz);
                  // Re-fetching isn't needed — slot ISOs are absolute, only
                  // rendering changes — but any open slot cards must re-render.
                }}
                aria-label="Display times in timezone"
                className="bg-transparent pr-1 text-[11px] text-neutral-100 focus:outline-none"
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz} className="bg-[#0b0b10] text-neutral-100">
                    {tz === browserTz ? `${tz} (local)` : tz}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Feed */}
          <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                bookingSlot={bookingSlot}
                timezone={timezone}
                onSlotPick={proposeSlot}
                onConfirm={confirmSlot}
              />
            ))}
            {pending && <TypingIndicator />}
          </div>

          <form onSubmit={onSubmit} className="border-t border-white/10 bg-black/40 px-3 py-3">
            <div className="flex items-end gap-2">
              <label htmlFor="concierge-chat-input" className="sr-only">
                Type your message
              </label>
              <textarea
                id="concierge-chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask about times, or type 'book'…"
                disabled={pending}
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-primary/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={pending || input.trim().length === 0}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="mt-1.5 text-[10px] uppercase tracking-widest text-neutral-500">
              Enter to send · Shift+Enter for newline
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function MessageBubble({
  message,
  bookingSlot,
  timezone,
  leadDraft,
  pendingLeadSlot,
  onSlotPick,
  onConfirm,
  onLeadSubmit,
}: {
  message: ChatMessage;
  bookingSlot: string | null;
  timezone: string;
  leadDraft: LeadDetails;
  pendingLeadSlot: string | null;
  onSlotPick: (slot: ConciergeSlot) => void;
  onConfirm: (slot: ConciergeSlot) => void;
  onLeadSubmit: (slot: ConciergeSlot, lead: LeadDetails) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm"
            : "max-w-[90%] space-y-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-neutral-100"
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap break-words leading-relaxed">
                {part.text}
              </div>
            );
          }
          if (part.type === "slots") {
            return (
              <SlotPickerCard key={i} slots={part.slots} timezone={timezone} onPick={onSlotPick} />
            );
          }
          if (part.type === "confirm") {
            return (
              <ConfirmSlotCard
                key={i}
                slot={part.slot}
                timezone={timezone}
                busy={bookingSlot === part.slot.startsAt}
                onConfirm={onConfirm}
              />
            );
          }
          if (part.type === "booking") {
            return (
              <BookingStatusCard
                key={i}
                bookingId={part.bookingId}
                startsAt={part.startsAt}
                status={part.status}
                timezone={timezone}
              />
            );
          }
          return (
            <LeadFormCard
              key={i}
              slot={part.slot}
              timezone={timezone}
              submitted={part.submitted}
              initial={leadDraft}
              busy={pendingLeadSlot === part.slot.startsAt}
              onSubmit={onLeadSubmit}
            />
          );
        })}
      </div>
    </div>
  );
}

function SlotPickerCard({
  slots,
  timezone,
  onPick,
}: {
  slots: ConciergeSlot[];
  timezone: string;
  onPick: (slot: ConciergeSlot) => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-neutral-500">
        <span>Available slots</span>
        <span className="normal-case tracking-normal text-neutral-500">{timezone}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {slots.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            onClick={() => onPick(s)}
            className="flex flex-col items-start rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left text-[11px] text-neutral-100 transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0b10]"
          >
            <span className="font-semibold">{formatDate(s.startsAt, timezone)}</span>
            <span className="text-neutral-400">
              {formatTime(s.startsAt, timezone)} · {s.durationMinutes} min
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfirmSlotCard({
  slot,
  busy,
  timezone,
  onConfirm,
}: {
  slot: ConciergeSlot;
  busy: boolean;
  timezone: string;
  onConfirm: (slot: ConciergeSlot) => void;
}) {
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/[0.06] p-3">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-primary/80">
        <span>Confirm booking</span>
        <span className="normal-case tracking-normal text-primary/60">{timezone}</span>
      </div>
      <div className="text-sm font-semibold">{formatDate(slot.startsAt, timezone)}</div>
      <div className="mb-2 text-xs text-neutral-300">
        {formatTime(slot.startsAt, timezone)} · {slot.durationMinutes} min · Private Room
      </div>
      <button
        type="button"
        onClick={() => onConfirm(slot)}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Holding slot…
          </>
        ) : (
          "Confirm & pay"
        )}
      </button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Concierge is thinking">
      <div className="rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

function formatTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone ? "short" : undefined,
  });
}

function BookingStatusCard({
  bookingId,
  startsAt,
  status,
  timezone,
}: {
  bookingId: string;
  startsAt: string;
  status: string;
  timezone: string;
}) {
  const { label, tone } = statusLabel(status);
  const toneClass =
    tone === "ok"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : tone === "warn"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : tone === "err"
          ? "border-rose-400/40 bg-rose-400/10 text-rose-200"
          : "border-white/15 bg-white/[0.04] text-neutral-200";
  const live = !TERMINAL_STATUSES.has(status);
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-neutral-500">
          Booking · {bookingId.slice(0, 8)}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneClass}`}
          aria-live="polite"
        >
          {live && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          )}
          {label}
        </span>
      </div>
      <div className="text-sm font-semibold text-neutral-100">
        {formatDate(startsAt, timezone)}
      </div>
      <div className="text-xs text-neutral-400">
        {formatTime(startsAt, timezone)} · Private Room
      </div>
    </div>
  );
}

