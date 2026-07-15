import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, X, Send } from "lucide-react";

/**
 * A chat message rendered in the widget feed. Kept intentionally minimal —
 * when the third-party LLM is wired in you can extend this with fields
 * like `id`, `status`, or `parts` without touching the UI shell.
 */
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * TODO: plug in third-party LLM API here.
 *
 * Given the current conversation history (system → user → assistant → …),
 * return the assistant's reply as a string. Throwing propagates to the UI
 * as a red error bubble. Nothing else in the widget needs to change when
 * wiring this up.
 */
async function fetchAssistantReply(_history: ChatMessage[]): Promise<string> {
  // Placeholder response so the UI is testable end-to-end without a backend.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return "Thanks for reaching out — VIP Support isn't wired up yet, but a real agent will reply here soon.";
}

const INITIAL_GREETING: ChatMessage = {
  role: "assistant",
  content: "Hi there — this is VIP Support. How can we help you tonight?",
};

export function SupportChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [pending, setPending] = useState(false);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  // Auto-scroll the feed to the newest message whenever it grows.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  // Focus the composer when the panel opens; return focus to the launcher
  // when it closes so keyboard users don't get stranded.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    launcherRef.current?.focus();
  }, [open]);

  // Close on Escape while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;
    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextHistory);
    setInput("");
    setPending(true);
    try {
      const reply = await fetchAssistantReply(nextHistory);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${message}`,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  return (
    <>
      {/* Launcher bubble — fixed, bottom-right on every route. */}
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open VIP Support chat"
          className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
          <span className="sr-only">Open VIP Support chat</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="VIP Support chat"
          aria-modal="false"
          className="fixed bottom-5 right-5 z-[60] flex h-[min(560px,calc(100dvh-2.5rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10] text-neutral-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
              />
              <div>
                <div className="text-sm font-semibold tracking-wide">VIP Support</div>
                <div className="text-[11px] text-neutral-400">
                  Typically replies in a few minutes
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close VIP Support chat"
              className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Message feed */}
          <div
            ref={feedRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
            {pending && <TypingIndicator />}
          </div>

          {/* Composer */}
          <form
            onSubmit={onSubmit}
            className="border-t border-white/10 bg-black/40 px-3 py-3"
          >
            <div className="flex items-end gap-2">
              <label htmlFor="support-chat-input" className="sr-only">
                Type your message
              </label>
              <textarea
                id="support-chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts a newline — standard chat UX.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Type a message…"
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

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm"
            : "max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-neutral-100"
        }
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="VIP Support is typing">
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
