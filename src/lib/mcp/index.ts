import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getVenueInfo from "./tools/get-venue-info";
import submitPartnershipInquiry from "./tools/submit-partnership-inquiry";

// OAuth issuer MUST be the direct Supabase host, not the .lovable.cloud proxy.
// VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "princess-pink-mcp",
  title: "Princess Pink MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Princess Pink venue site. Use `get_venue_info` for public information about the venue and its key pages. Use `submit_partnership_inquiry` to file a business or press inquiry.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getVenueInfo, submitPartnershipInquiry],
});

