import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  createAdminThread,
  type AdminThread,
} from "@/lib/admin-assistant-threads.functions";

export const Route = createFileRoute("/_authenticated/admin/command-center/")({
  component: CommandCenterEmpty,
});

function CommandCenterEmpty() {
  const create = useServerFn(createAdminThread);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => create({ data: {} }),
    onSuccess: (t: AdminThread) => {
      qc.invalidateQueries({ queryKey: ["admin-threads"] });
      navigate({
        to: "/admin/command-center/$threadId",
        params: { threadId: t.id },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="flex h-[75vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <Wand2 className="h-10 w-10 text-primary" />
      <div>
        <h2 className="text-lg font-semibold">Start a new admin conversation</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Pick a saved conversation from the sidebar, or start a new one to query bookings,
          users, assets, and merchandise.
        </p>
      </div>
      <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-2 h-4 w-4" />
        )}
        New conversation
      </Button>
    </Card>
  );
}
