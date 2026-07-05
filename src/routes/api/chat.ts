import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

// Streaming support chat endpoint.
//
// Contract:
//   - Auth: Bearer access token in Authorization header (client attaches it).
//   - One conversation per client (support_conversations.user_id UNIQUE).
//   - Persists user + assistant turns into support_messages.
//   - AI can call escalate_to_human to flip the conversation to an admin
//     inbox; the tool needs no approval — it just marks the row.

const SYSTEM_PROMPT = `You are the support assistant for Princess Pink 90, an events and community platform.

Guidelines:
- Answer questions about accounts, events, RSVPs, health-screening uploads, membership, and general how-to.
- Be concise, warm, and clear. Use short paragraphs and bullet points when helpful.
- Never invent policy or pricing. If you don't know, say so and offer to escalate.
- If the user asks for a human, describes a payment/billing dispute, reports harassment or a safety incident, or seems frustrated after one attempt, call the escalate_to_human tool with a short reason. After calling it, tell the user their message has been forwarded to the admin team and they will hear back by email.
- Do not ask for or repeat sensitive personal data (full addresses, IDs, health details). If the user shares them, do not echo them back.`;

async function loadConversation(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data: existing } = await supabase
    .from("support_conversations")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("support_conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return created.id as string;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "missing_ai_key" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // User-scoped client (RLS applies) — verifies the caller.
        const userClient = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );
        const { data: userData, error: userErr } = await userClient.auth.getUser(token);
        if (userErr || !userData.user) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
          });
        }
        const userId = userData.user.id;

        const body = (await request.json()) as { messages?: UIMessage[] };
        if (!Array.isArray(body.messages)) {
          return new Response(JSON.stringify({ error: "messages_required" }), {
            status: 400,
          });
        }

        // Service-role client for durable writes (needed for assistant/system rows).
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const admin = supabaseAdmin as unknown as ReturnType<typeof createClient>;

        const conversationId = await loadConversation(admin, userId);

        // Persist the latest user message (client sends the full transcript;
        // only the last turn is new).
        const lastUser = [...body.messages]
          .reverse()
          .find((m) => m.role === "user");
        if (lastUser) {
          const text = lastUser.parts
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("")
            .trim();
          if (text) {
            await admin.from("support_messages").insert({
              conversation_id: conversationId,
              role: "user",
              author_user_id: userId,
              content: text,
            });
            await admin
              .from("support_conversations")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", conversationId);
          }
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(body.messages),
          stopWhen: stepCountIs(50),
          tools: {
            escalate_to_human: tool({
              description:
                "Flag this conversation for admin follow-up. Use when the user asks for a human, reports harassment/safety, has a payment dispute, or the assistant cannot resolve the issue.",
              inputSchema: z.object({
                reason: z
                  .string()
                  .describe("Short summary of what needs admin attention."),
              }),
              execute: async ({ reason }) => {
                const { error } = await admin
                  .from("support_conversations")
                  .update({
                    escalated: true,
                    escalated_at: new Date().toISOString(),
                    escalation_reason: reason.slice(0, 500),
                    admin_unread_count: 1,
                  })
                  .eq("id", conversationId);
                if (error) return { ok: false, error: error.message };
                await admin.from("support_messages").insert({
                  conversation_id: conversationId,
                  role: "system",
                  content: `Escalated to admin: ${reason}`,
                  metadata: { kind: "escalation", reason },
                });
                return { ok: true, message: "Escalated to admin team." };
              },
            }),
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          onFinish: async ({ messages }) => {
            const assistant = [...messages]
              .reverse()
              .find((m) => m.role === "assistant");
            if (!assistant) return;
            const text = assistant.parts
              .map((p) => (p.type === "text" ? p.text : ""))
              .join("")
              .trim();
            if (!text) return;
            await admin.from("support_messages").insert({
              conversation_id: conversationId,
              role: "assistant",
              content: text,
              metadata: { model: "google/gemini-3-flash-preview" },
            });
            await admin
              .from("support_conversations")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", conversationId);
          },
        });
      },
    },
  },
});
