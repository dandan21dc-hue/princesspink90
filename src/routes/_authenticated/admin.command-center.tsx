import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { amIAdmin } from "@/lib/admin.functions";
import {
  listAdminThreads,
  createAdminThread,
  deleteAdminThread,
  type AdminThread,
} from "@/lib/admin-assistant-threads.functions";
import { Loader2, ShieldOff, Plus, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/command-center")({
  head: () => ({
    meta: [{ title: "Admin Command Center — Midnight Glory 90" }],
  }),
  component: CommandCenterLayout,
});

function CommandCenterLayout() {
  const check = useServerFn(amIAdmin);
  const list = useServerFn(listAdminThreads);
  const create = useServerFn(createAdminThread);
  const remove = useServerFn(deleteAdminThread);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const params = useParams({ strict: false }) as { threadId?: string };
  const activeThreadId = params.threadId;

  const { data: admin, isLoading: adminLoading } = useQuery({
    queryKey: ["am-i-admin"],
    queryFn: () => check(),
  });

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ["admin-threads"],
    queryFn: () => list(),
    enabled: !!admin?.isAdmin,
  });

  const createMut = useMutation({
    mutationFn: async () => create({ data: {} }),
    onSuccess: (thread: AdminThread) => {
      qc.invalidateQueries({ queryKey: ["admin-threads"] });
      navigate({
        to: "/admin/command-center/$threadId",
        params: { threadId: thread.id },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => remove({ data: { id } }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["admin-threads"] });
      if (activeThreadId === id) {
        navigate({ to: "/admin/command-center" });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (adminLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!admin?.isAdmin) {
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
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Admin Command Center</h1>
        <p className="text-sm text-muted-foreground">
          Natural-language querying and mutation of Bookings, Users, Digital Assets, and
          Merchandise. Conversations are saved to your admin account.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          <Button
            className="w-full justify-start"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
          >
            {createMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            New conversation
          </Button>

          <div className="rounded-md border bg-card">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              History
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-1">
              {threadsLoading && (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
              {threads?.length === 0 && !threadsLoading && (
                <div className="p-3 text-xs text-muted-foreground">
                  No conversations yet.
                </div>
              )}
              {threads?.map((t) => {
                const active = t.id === activeThreadId;
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "group flex items-center gap-1 rounded px-1",
                      active && "bg-accent",
                    )}
                  >
                    <Link
                      to="/admin/command-center/$threadId"
                      params={{ threadId: t.id }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-accent/60"
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t.title}</span>
                    </Link>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      className="rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm(`Delete "${t.title}"?`)) deleteMut.mutate(t.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
