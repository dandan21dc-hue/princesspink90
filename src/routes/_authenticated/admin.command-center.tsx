import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminAssistantChat } from "@/components/AdminAssistantChat";
import { amIAdmin } from "@/lib/admin.functions";
import { Loader2, ShieldOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/command-center")({
  head: () => ({
    meta: [{ title: "Admin Command Center — Midnight Glory 90" }],
  }),
  component: CommandCenterPage,
});

function CommandCenterPage() {
  const check = useServerFn(amIAdmin);
  const { data, isLoading } = useQuery({
    queryKey: ["am-i-admin"],
    queryFn: () => check(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!data?.isAdmin) {
    return (
      <div className="mx-auto max-w-lg space-y-2 p-8 text-center">
        <ShieldOff className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="text-sm text-muted-foreground">
          The Command Center is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Admin Command Center</h1>
        <p className="text-sm text-muted-foreground">
          Natural-language querying and mutation of Bookings, Users, Digital Assets, and Merchandise.
          Every write requires your explicit confirmation and is written to the tamper-evident audit log.
        </p>
      </div>
      <AdminAssistantChat />
    </div>
  );
}
