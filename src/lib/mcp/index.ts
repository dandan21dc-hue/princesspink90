import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingEvents from "./tools/list-upcoming-events";
import listMyRsvps from "./tools/list-my-rsvps";
import listMyMemberships from "./tools/list-my-memberships";
import createRsvp from "./tools/create-rsvp";
import cancelRsvp from "./tools/cancel-rsvp";

// The OAuth issuer MUST be the direct Supabase host, not the `.lovable.cloud`
// proxy that `SUPABASE_URL` resolves to on the published Workers runtime.
// `VITE_SUPABASE_PROJECT_ID` is inlined by Vite at build time and survives
// publish unchanged; the sentinel keeps the issuer well-formed during the
// throwaway manifest-extract eval that runs before env is available.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "princess-pink-mcp",
  title: "Princess Pink",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in Princess Pink member. Use `list_upcoming_events` to discover public events, `list_my_rsvps` to see the user's own RSVPs and entry codes, `list_my_memberships` to see their active passes, `create_rsvp` to RSVP to a specific event, and `cancel_rsvp` to cancel an existing RSVP.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listUpcomingEvents, listMyRsvps, listMyMemberships, createRsvp, cancelRsvp],
});
