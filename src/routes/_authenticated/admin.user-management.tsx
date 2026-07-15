import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listAllUsersWithRoles, setUserCoHostRole } from "@/lib/admin.functions";
import { getUserComplianceArchiveDownload } from "@/lib/compliance-archive.functions";

export const Route = createFileRoute("/_authenticated/admin/user-management")({
  head: () => ({
    meta: [
      { title: "User Management · Admin · AFTERDARK" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UserManagementPage,
});

type Row = {
  id: string;
  email: string | null;
  created_at: string | null;
  display_name: string | null;
  roles: string[];
};

function UserManagementPage() {
  const listFn = useServerFn(listAllUsersWithRoles);
  const setRoleFn = useServerFn(setUserCoHostRole);
  const downloadComplianceFn = useServerFn(getUserComplianceArchiveDownload);
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [pendingComplianceUserId, setPendingComplianceUserId] = useState<string | null>(null);

  async function handleDownloadCompliance(userId: string) {
    setPendingComplianceUserId(userId);
    try {
      const res = await downloadComplianceFn({ data: { user_id: userId } });
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast.success("Signed compliance PDF ready");
    } catch (e: any) {
      toast.error(e?.message ?? "No signed compliance record found");
    } finally {
      setPendingComplianceUserId(null);
    }
  }

  const usersQ = useQuery({
    queryKey: ["admin", "all-users-with-roles"],
    queryFn: () => listFn(),
  });

  const mutation = useMutation({
    mutationFn: (v: { userId: string; role: "user" | "co_host" }) =>
      setRoleFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.role === "co_host" ? "Granted co-host access" : "Revoked co-host access",
      );
      qc.invalidateQueries({ queryKey: ["admin", "all-users-with-roles"] });
      qc.invalidateQueries({ queryKey: ["my-roles"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update role"),
  });

  const rows: Row[] = usersQ.data?.users ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.display_name ?? "").toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">User management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant co-host access to give a member dashboard entry. Admins are managed via the database.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, name, or id"
          className="w-full max-w-md rounded-md border border-border/60 bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {rows.length} users
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border/60 bg-card">
        {usersQ.isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading users…</div>
        ) : usersQ.isError ? (
          <div className="p-10 text-center text-sm text-red-400">
            Failed to load users. {(usersQ.error as any)?.message ?? ""}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No users match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Compliance</th>
                <th className="px-4 py-3 text-right">Access</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isAdmin = u.roles.includes("admin");
                const isCoHost = u.roles.includes("co_host");
                const currentValue: "user" | "co_host" = isCoHost ? "co_host" : "user";
                const pendingForThis =
                  mutation.isPending && (mutation.variables as any)?.userId === u.id;
                return (
                  <tr key={u.id} className="border-t border-border/40 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {u.display_name || u.email || u.id}
                      </div>
                      {u.email && u.display_name && (
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      )}
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                        {u.id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && (
                          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            user
                          </span>
                        )}
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                              r === "admin"
                                ? "border-neon/40 bg-neon/10 text-neon"
                                : "border-primary/40 bg-primary/10 text-primary"
                            }`}
                          >
                            {r.replace("_", "-")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin ? (
                        <span className="text-xs text-muted-foreground">
                          Admin (locked)
                        </span>
                      ) : (
                        <select
                          value={currentValue}
                          disabled={pendingForThis}
                          onChange={(e) =>
                            mutation.mutate({
                              userId: u.id,
                              role: e.target.value as "user" | "co_host",
                            })
                          }
                          className="rounded-md border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-primary disabled:opacity-50"
                        >
                          <option value="user">User</option>
                          <option value="co_host">Co-host</option>
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
