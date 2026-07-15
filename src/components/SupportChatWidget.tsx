import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, X, Send, CalendarClock, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listConciergeSlots, type ConciergeSlot } from "@/lib/concierge.functions";
import { createBookingInvoice } from "@/lib/bookingInvoice.functions";
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

type MessagePart =
  | { type: "text"; text: string }
  | { type: "slots"; slots: ConciergeSlot[] }
  | { type: "confirm"; slot: ConciergeSlot };

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

export function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [pending, setPending] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null); // ISO of slot currently being booked

  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  const fetchSlots = useServerFn(listConciergeSlots);
  const startBooking = useServerFn(createBookingInvoice);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
            text: "Sending you to secure checkout — the slot is held for 15 minutes.",
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
          <div className="flex flex-wrap gap-2 border-b border-white/5 px-3 py-2">
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
          </div>

          {/* Feed */}
          <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                bookingSlot={bookingSlot}
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
  onSlotPick,
  onConfirm,
}: {
  message: ChatMessage;
  bookingSlot: string | null;
  onSlotPick: (slot: ConciergeSlot) => void;
  onConfirm: (slot: ConciergeSlot) => void;
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
            return <SlotPickerCard key={i} slots={part.slots} onPick={onSlotPick} />;
          }
          return (
            <ConfirmSlotCard
              key={i}
              slot={part.slot}
              busy={bookingSlot === part.slot.startsAt}
              onConfirm={onConfirm}
            />
          );
        })}
      </div>
    </div>
  );
}

function SlotPickerCard({
  slots,
  onPick,
}: {
  slots: ConciergeSlot[];
  onPick: (slot: ConciergeSlot) => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-500">
        Available slots
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {slots.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            onClick={() => onPick(s)}
            className="flex flex-col items-start rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left text-[11px] text-neutral-100 transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0b10]"
          >
            <span className="font-semibold">{formatDate(s.startsAt)}</span>
            <span className="text-neutral-400">
              {formatTime(s.startsAt)} · {s.durationMinutes} min
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
  onConfirm,
}: {
  slot: ConciergeSlot;
  busy: boolean;
  onConfirm: (slot: ConciergeSlot) => void;
}) {
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/[0.06] p-3">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-primary/80">
        Confirm booking
      </div>
      <div className="text-sm font-semibold">{formatDate(slot.startsAt)}</div>
      <div className="mb-2 text-xs text-neutral-300">
        {formatTime(slot.startsAt)} · {slot.durationMinutes} min · Private Room
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
