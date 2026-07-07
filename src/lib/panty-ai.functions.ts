import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  imageUrl: z.string().url(),
});

const ResultSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export const describePantyPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-only: check role before spending credits.
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI service not configured");

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const systemPrompt =
      "You write concise, tasteful product copy for a boutique lingerie shop (adult-only, Australia). " +
      "Given ONE photo of a single pair of women's underwear, output a short product name and a short description. " +
      "Rules: Title <= 60 chars, no emoji, no pricing, no ALL CAPS. " +
      "Description 1-3 short sentences (<= 350 chars) covering visible colour, style/cut (e.g. thong, boyshort, brief, g-string), " +
      "material cues if visible (lace, satin, mesh, cotton), and one atmospheric line. " +
      "Do not invent size, brand, or wear history. Keep it classy — no explicit language.";

    try {
      const { experimental_output } = await generateText({
        model,
        experimental_output: Output.object({ schema: ResultSchema }),
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Write the title and description for this pair." },
              { type: "image", image: new URL(data.imageUrl) },
            ],
          },
        ],
      });

      return {
        title: experimental_output.title.slice(0, 80).trim(),
        description: experimental_output.description.slice(0, 500).trim(),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        // Degrade to a safe empty result instead of crashing the form.
        return { title: "", description: "" };
      }
      const message = error instanceof Error ? error.message : "AI description failed";
      throw new Error(message);
    }
  });
