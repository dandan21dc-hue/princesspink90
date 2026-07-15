import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT =
  "You are an elite, discreet VIP booking concierge for a premium venue. Be helpful, alluring, and concise.";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
});

export type ChatWithConciergeInput = z.infer<typeof InputSchema>;

// Auth-gated: requireSupabaseAuth blocks unauthenticated callers so anonymous
// visitors can't script this endpoint to drain paid OpenRouter credits.
export const chatWithConcierge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    // Strip any client-supplied system messages; we control the persona.
    const userMessages = data.messages.filter((m) => m.role !== "system");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gryphe/mythomax-l2-13b",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...userMessages],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenRouter error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!reply) throw new Error("OpenRouter returned an empty reply");

    return { reply };
  });
