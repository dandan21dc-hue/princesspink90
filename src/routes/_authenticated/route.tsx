import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkAgeGate } from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: location.href } });
    }
    // Hard age-gate: signed-in users on any /_authenticated route must
    // have a server-recorded 18+ confirmation. Anonymous visitors on
    // public marketing routes still see the localStorage prompt.
    if (!location.pathname.startsWith("/age-gate")) {
      // Non-fatal: if the server-fn call fails (e.g. bearer not yet
      // attached, token shape rejected by the generated auth middleware,
      // transient network error), let the page render. The <AgeGate/>
      // client component re-checks after supabase.auth.getUser() resolves
      // and will redirect to /age-gate itself if the user isn't confirmed.
      try {
        const gate = await checkAgeGate();
        if (!gate.confirmed) {
          throw redirect({
            to: "/age-gate",
            search: { next: location.href },
          });
        }
      } catch (e) {
        // Re-throw router redirects; swallow everything else.
        if (e && typeof e === "object" && "to" in e) throw e;
      }
    }

    // Staff-only paths: /dashboard and any sub-route require admin or co_host.
    // Kept in beforeLoad so unauthorized users redirect before render (no flash).
    const path = location.pathname;
    const isStaffPath =
      path === "/dashboard" ||
      path.startsWith("/dashboard/") ||
      path === "/admin" ||
      path.startsWith("/admin/");
    if (isStaffPath) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      const roles = (roleRows ?? []).map((r) => r.role as string);
      const allowed = roles.includes("admin") || roles.includes("co_host");
      if (!allowed) {
        throw redirect({ to: "/", search: { restricted: "1" } });
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
