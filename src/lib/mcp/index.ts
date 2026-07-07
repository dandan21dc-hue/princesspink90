import { defineMcp } from "@lovable.dev/mcp-js";
import getVenueInfo from "./tools/get-venue-info";
import submitPartnershipInquiry from "./tools/submit-partnership-inquiry";

export default defineMcp({
  name: "princess-pink-mcp",
  title: "Princess Pink MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Princess Pink venue site. Use `get_venue_info` for public information about the venue and its key pages. Use `submit_partnership_inquiry` to file a business or press inquiry.",
  tools: [getVenueInfo, submitPartnershipInquiry],
});
