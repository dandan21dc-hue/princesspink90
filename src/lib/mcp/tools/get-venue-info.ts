import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_venue_info",
  title: "Get venue info",
  description:
    "Return public information about Princess Pink: what the venue offers, house rules summary, and links to key pages (store, events, compliance, conduct).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: "Princess Pink",
            tagline:
              "Glory holes, private rooms & theatre nights — an adults-only venue.",
            age_restriction: "18+ only. Age verification is enforced on entry.",
            key_pages: {
              store: "/store",
              events: "/store (see upcoming events section)",
              private_room: "/store/private-room",
              subscribe: "/store/subscribe",
              partnerships: "/partnerships",
              code_of_conduct: "/conduct",
              compliance: "/compliance",
              privacy: "/privacy",
              terms: "/terms",
              legal: "/legal",
            },
            house_principles: [
              "Consent is required at every step.",
              "Respect boundaries and safe words.",
              "No photography or recording on premises.",
              "Discretion and privacy of all guests are protected.",
            ],
          },
          null,
          2,
        ),
      },
    ],
  }),
});
