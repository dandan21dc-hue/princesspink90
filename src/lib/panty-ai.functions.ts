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
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) {
      console.error("[panty-ai] has_role check failed:", roleErr);
      throw new Error("Could not verify admin role");
    }
    if (!isAdmin) throw new Error("Forbidden — admin only");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error(
        "Lovable AI is not configured on this project. Ask the builder to enable Lovable Cloud so LOVABLE_API_KEY is provisioned.",
      );
    }

    const systemPrompt =
      "You write concise, tasteful product copy for a boutique lingerie shop (adult-only, Australia). " +
      "Given ONE photo of a single pair of women's underwear, output a short product name and a short description. " +
      "Rules: Title <= 60 chars, no emoji, no pricing, no ALL CAPS. " +
      "Description 1-3 short sentences (<= 350 chars) covering visible colour, style/cut (e.g. thong, boyshort, brief, g-string), " +
      "material cues if visible (lace, satin, mesh, cotton), and one atmospheric line. " +
      "Do not invent size, brand, or wear history. Keep it classy — no explicit language.";

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway("google/gemini-2.5-flash");

      const { output } = await generateText({
        model,
        output: Output.object({ schema: ResultSchema }),
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
        title: output.title.slice(0, 80).trim(),
        description: output.description.slice(0, 500).trim(),
      };
    } catch (error) {
      console.error("[panty-ai] describe failed:", error);
      if (NoObjectGeneratedError.isInstance(error)) {
        return { title: "", description: "" };
      }
      const raw = error instanceof Error ? error.message : String(error);
      // Surface common gateway failures with actionable copy.
      if (/429|rate.?limit/i.test(raw)) {
        throw new Error("AI is rate-limited right now. Wait a minute and try again.");
      }
      if (/402|credit|payment|billing/i.test(raw)) {
        throw new Error(
          "Lovable AI credits are exhausted. Top up credits under Workspace → Plans & credits.",
        );
      }
      if (/401|403|unauthor|forbidden|api.?key/i.test(raw)) {
        throw new Error(
          "AI gateway rejected the request (auth). LOVABLE_API_KEY may need rotating.",
        );
      }
      if (/fetch|download|image|url/i.test(raw)) {
        throw new Error(
          "AI could not fetch the uploaded photo. Try re-uploading the cover image.",
        );
      }
      throw new Error(`AI describe failed: ${raw.slice(0, 240)}`);
    }
  });
