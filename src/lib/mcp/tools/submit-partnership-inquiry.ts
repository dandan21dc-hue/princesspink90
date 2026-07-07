import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "submit_partnership_inquiry",
  title: "Submit partnership inquiry",
  description:
    "Submit a business/partnership inquiry to Princess Pink. Use for press, collaborations, or B2B outreach — NOT for guest bookings.",
  inputSchema: {
    name: z.string().trim().min(1).describe("Contact name"),
    email: z.string().trim().email().describe("Contact email"),
    company: z.string().trim().optional().describe("Company or organisation"),
    message: z.string().trim().min(10).describe("Details of the inquiry"),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async ({ name, email, company, message }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      return {
        content: [{ type: "text", text: "Server not configured" }],
        isError: true,
      };
    }
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("partnership_inquiries").insert({
      name,
      email,
      company: company ?? null,
      message,
    });
    if (error) {
      return {
        content: [{ type: "text", text: `Failed to submit: ${error.message}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: "Inquiry submitted. The Princess Pink team will follow up by email.",
        },
      ],
    };
  },
});
