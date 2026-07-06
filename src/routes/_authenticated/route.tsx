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
      const gate = await checkAgeGate();
      if (!gate.confirmed) {
        throw redirect({
          to: "/age-gate",
          search: { next: location.href },
        });
      }
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
