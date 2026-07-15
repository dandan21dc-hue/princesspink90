import { createFileRoute } from "@tanstack/react-router";

/**
 * Booking Concierge — chat completion endpoint (placeholder).
 *
 * ────────────────────────────────────────────────────────────────────────
 *  🔌 PLUG YOUR LLM HERE
 * ────────────────────────────────────────────────────────────────────────
 * This route is the single boundary the widget talks to for
 * text generation. Replace the body of the POST handler with a fetch to
 * your provider (OpenAI, Anthropic, Lovable AI Gateway, self-hosted, etc.)
 * and stream/return its reply.
 *
 * Contract expected by the widget (`src/components/SupportChatWidget.tsx`):
 *
 *   Request body:
 *     {
 *       messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
 *     }
 *
 *   Response body:
 *     {
 *       reply: string,                // Text shown as the assistant bubble.
 *       tool?:
 *         | { name: "show_slots"; args?: { horizonDays?: number; limit?: number } }
 *         | { name: "none" },        // Optional tool the widget should run
 *                                    // AFTER rendering `reply`. Currently
 *                                    // only `show_slots` is wired — extend
 *                                    // as your LLM gains more tools.
 *     }
 *
 * The widget renders `reply` first, then — if `tool.name === "show_slots"`
 * — calls `listConciergeSlots` and appends an interactive slot picker in
 * the same conversation turn. This split keeps the LLM stateless: it only
 * decides "should I ask for availability?" and never touches Supabase.
 *
 * Suggested system prompt to seed your LLM with:
 *
 *   "You are the Booking Concierge for MIDNIGHT GLORY. You help guests
 *    check Private Room availability and confirm a slot. When a guest
 *    wants to see times or book, respond briefly and set
 *    tool = { name: 'show_slots' } so the UI can render live options.
 *    Never invent times. Never quote prices."
 * ────────────────────────────────────────────────────────────────────────
 */

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };

type ConciergeReply = {
  reply: string;
  tool?: { name: "show_slots"; args?: { horizonDays?: number; limit?: number } } | { name: "none" };
};

const SLOT_INTENT = /\b(book|booking|slot|slots|available|availability|reserve|schedule|time|when)\b/i;

function placeholderReply(messages: ChatMessage[]): ConciergeReply {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUser?.content ?? "";
  if (!text.trim()) {
    return {
      reply: "Hi — I'm the Booking Concierge. Ask me anything about the Private Room, or say 'show me times' to see live availability.",
    };
  }
  if (SLOT_INTENT.test(text)) {
    return {
      reply: "Here are the next open Private Room slots — tap one to hold it.",
      tool: { name: "show_slots", args: { horizonDays: 7, limit: 6 } },
    };
  }
  return {
    reply:
      "Thanks — the concierge LLM isn't wired up yet, so I can only handle availability questions right now. Try asking to 'see available times'.",
  };
}

export const Route = createFileRoute("/api/concierge/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { messages?: unknown };
        try {
          body = (await request.json()) as { messages?: unknown };
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const messages = Array.isArray(body.messages)
          ? (body.messages as ChatMessage[]).filter(
              (m) =>
                m &&
                typeof m === "object" &&
                (m.role === "user" || m.role === "assistant" || m.role === "system") &&
                typeof m.content === "string",
            )
          : [];
        // TODO: replace this call with your LLM provider fetch — see the
        // file header for the request/response contract.
        const reply = placeholderReply(messages);
        return Response.json(reply satisfies ConciergeReply);
      },
    },
  },
});
