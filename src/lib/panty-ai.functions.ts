import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  imageUrl: z.string().url().optional(),
  filename: z.string().optional(),
  itemType: z.enum(["panty", "digital"]).optional(),
});

// Kept loose on purpose — see ai-sdk-agent-patterns: schemas with .min/.max
// or long enums make Gemini reject the request. Clamp/validate in code below.
const ResultSchema = z.object({
  title: z.string(),
  description: z.string(),
  suggested_price: z.number(),
  tags: z.array(z.string()),
});

export type AutoFillResult = {
  title: string;
  description: string;
  suggested_price: number;
  tags: string[];
};

/**
 * AI Auto-Fill for both physical merch (panty_listings) and digital assets
 * (content_items). Returns strict JSON with title, description, suggested
 * price (integer cents, AUD), and a short tag list. Admin-only.
 */
export const describePantyPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AutoFillResult> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) {
      console.error("[ai-auto-fill] has_role check failed:", roleErr);
      throw new Error("Could not verify admin role");
    }
    if (!isAdmin) throw new Error("Forbidden — admin only");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error(
        "Lovable AI is not configured on this project. Ask the builder to enable Lovable Cloud so LOVABLE_API_KEY is provisioned.",
      );
    }

    const itemType = data.itemType ?? "panty";

    const systemPrompt = [
      "You write tasteful product copy for an adult-only boutique in Australia. All prices are AUD.",
      itemType === "digital"
        ? "You are drafting a listing for a DIGITAL asset (photo set, video, or bundle) on a creator's store."
        : "You are drafting a listing for a physical pair of women's underwear.",
      "Return ONLY valid JSON matching the required schema — no prose, no markdown, no code fences.",
      "Rules:",
      "- title: <= 60 chars, no emoji, no ALL CAPS, no pricing.",
      "- description: 1-3 short tasteful sentences (<= 350 chars). Never explicit.",
      itemType === "digital"
        ? "- suggested_price: integer PRICE IN CENTS AUD. Typical ranges: photo_set 1200-4500, video 1500-6000, bundle 3000-9000."
        : "- suggested_price: integer PRICE IN CENTS AUD. Typical range 6000-14000 (A$60-$140).",
      "- tags: 3-6 short lowercase keywords (single words or 2-word phrases). No # symbols.",
      "- Do NOT invent brand, size, or wear history you cannot see.",
    ].join("\n");

    const userText = [
      data.filename ? `Filename: ${data.filename}` : null,
      `Item type: ${itemType}`,
      data.imageUrl
        ? "Analyse the attached photo for colour, style, and material cues."
        : "No photo provided — infer from the filename and item type only.",
      "Return the JSON object now.",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const model = gateway("google/gemini-2.5-flash");

      const userContent: Array<
        { type: "text"; text: string } | { type: "image"; image: URL }
      > = [{ type: "text", text: userText }];
      if (data.imageUrl) {
        userContent.push({ type: "image", image: new URL(data.imageUrl) });
      }

      const { output } = await generateText({
        model,
        output: Output.object({ schema: ResultSchema }),
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      const cleanTag = (t: string) =>
        t
          .toLowerCase()
          .replace(/^#+/, "")
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .slice(0, 30);

      const price = Math.max(0, Math.round(Number(output.suggested_price) || 0));

      return {
        title: output.title.slice(0, 80).trim(),
        description: output.description.slice(0, 500).trim(),
        suggested_price: price,
        tags: Array.from(
          new Set(
            (output.tags ?? [])
              .map(cleanTag)
              .filter((t) => t.length > 0),
          ),
        ).slice(0, 6),
      };
    } catch (error) {
      console.error("[ai-auto-fill] failed:", error);
      if (NoObjectGeneratedError.isInstance(error)) {
        return { title: "", description: "", suggested_price: 0, tags: [] };
      }
      const raw = error instanceof Error ? error.message : String(error);
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
      throw new Error(`AI auto-fill failed: ${raw.slice(0, 240)}`);
    }
  });
