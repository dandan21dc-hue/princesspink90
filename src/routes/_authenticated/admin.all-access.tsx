import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  amIAdmin,
  adminLookupUserAllAccess,
  adminGrantAllAccess,
  adminRevokeAllAccess,
  adminListAllAccessAudit,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, InfinityIcon, Calendar, History } from "lucide-react";


export const Route = createFileRoute("/_authenticated/admin/all-access")({
  head: () => ({ meta: [{ title: "Manual All-Access · Admin" }] }),
  component: AdminAllAccess,
});

function fmt(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminAllAccess() {
  const meFn = useServerFn(amIAdmin);
  const lookupFn = useServerFn(adminLookupUserAllAccess);
  const grantFn = useServerFn(adminGrantAllAccess);
  const revokeFn = useServerFn(adminRevokeAllAccess);
  const auditFn = useServerFn(adminListAllAccessAudit);
  const qc = useQueryClient();


  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState<string | null>(null);

  const lookup = useQuery({
    queryKey: ["admin-all-access-lookup", searched],
    queryFn: () => lookupFn({ data: { email: searched! } }),
    enabled: !!searched && me.data?.isAdmin === true,
  });

  const targetUserId = lookup.data?.user?.id ?? null;

  const audit = useQuery({
    queryKey: ["admin-all-access-audit", targetUserId],
    queryFn: () => auditFn({ data: { userId: targetUserId ?? undefined, limit: 25 } }),
    enabled: me.data?.isAdmin === true && !!targetUserId,
  });

  const grant = useMutation({
    mutationFn: (kind: "term_pass_all_access_30d" | "lifetime") =>
      grantFn({ data: { userId: lookup.data!.user!.id, kind } }),
    onSuccess: (_, kind) => {
      toast.success(kind === "lifetime" ? "Lifetime granted" : "30-day pass granted");
      qc.invalidateQueries({ queryKey: ["admin-all-access-lookup"] });
      qc.invalidateQueries({ queryKey: ["admin-all-access-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (membershipId: string) => revokeFn({ data: { membershipId } }),
    onSuccess: () => {
      toast.success("Membership revoked");
      qc.invalidateQueries({ queryKey: ["admin-all-access-lookup"] });
      qc.invalidateQueries({ queryKey: ["admin-all-access-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }

  const user = lookup.data?.user ?? null;
  const memberships = lookup.data?.memberships ?? [];

  return (
    <Shell>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin · Testing</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Manual All-Access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant or revoke All-Access entitlements without going through billing.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <Card className="mt-8 p-5">
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const v = email.trim();
            if (!v) return;
            setSearched(v);
          }}
        >
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              User email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={lookup.isFetching}>
            {lookup.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
          </Button>
        </form>
      </Card>

      {searched && lookup.isSuccess && !user && (
        <p className="mt-6 text-sm text-muted-foreground">
          No user found for <span className="text-foreground">{searched}</span>.
        </p>
      )}

      {user && (
        <div className="mt-8 space-y-6">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-display text-lg">{user.display_name ?? "Unnamed"}</div>
                <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                <div className="text-[10px] font-mono text-muted-foreground/70 mt-1">{user.id}</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => grant.mutate("term_pass_all_access_30d")}
                  disabled={grant.isPending}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Grant 30-day pass
                </Button>
                <Button
                  onClick={() => grant.mutate("lifetime")}
                  disabled={grant.isPending}
                >
                  <InfinityIcon className="h-4 w-4 mr-2" />
                  Grant lifetime
                </Button>
              </div>
            </div>
          </Card>

          <EntitlementSummary memberships={memberships} />



          <div>
            <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">
              All-Access memberships ({memberships.length})
            </h2>
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">No All-Access rows for this user.</p>
            ) : (
              <div className="space-y-3">
                {memberships.map((m: any) => {
                  const isLifetime = m.kind === "lifetime";
                  const expired =
                    !isLifetime && m.expires_at && new Date(m.expires_at) < new Date();
                  return (
                    <Card key={m.id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm">{m.kind}</span>
                            <Badge variant={isLifetime ? "default" : expired ? "outline" : "secondary"}>
                              {isLifetime ? "Lifetime" : expired ? "Expired" : "Active"}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">{m.environment}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Created {fmt(m.created_at)}
                            {!isLifetime && <> · Expires {fmt(m.expires_at)}</>}
                          </div>
                          {m.external_payment_reference && (
                            <div className="text-[10px] font-mono text-muted-foreground/70 mt-1 truncate">
                              ref: {m.external_payment_reference}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Revoke ${m.kind}? This deletes the membership row.`)) {
                              revoke.mutate(m.id);
                            }
                          }}
                          disabled={revoke.isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Revoke
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <AuditLogPanel
            title={`Recent grant/revoke history for ${user.email ?? user.id}`}
            entries={audit.data?.entries ?? []}
            isLoading={audit.isLoading}
          />
        </div>
      )}

    </Shell>
  );
}



type Membership = {
  id: string;
  kind: string;
  environment: string;
  expires_at: string | null;
  created_at: string;
  external_payment_reference: string | null;
};

function EntitlementSummary({ memberships }: { memberships: Membership[] }) {
  const now = Date.now();
  const lifetime = memberships.find((m) => m.kind === "lifetime");
  const activeTerm = memberships
    .filter(
      (m) =>
        m.kind === "term_pass_all_access_30d" &&
        m.expires_at &&
        new Date(m.expires_at).getTime() > now,
    )
    .sort(
      (a, b) => new Date(b.expires_at!).getTime() - new Date(a.expires_at!).getTime(),
    )[0];

  let status: "lifetime" | "active" | "none" = "none";
  let expiresAt: string | null = null;
  let daysLeft: number | null = null;
  let label = "No active All-Access";

  if (lifetime) {
    status = "lifetime";
    label = "Lifetime All-Access";
  } else if (activeTerm) {
    status = "active";
    expiresAt = activeTerm.expires_at;
    daysLeft = Math.max(
      0,
      Math.ceil((new Date(activeTerm.expires_at!).getTime() - now) / 86_400_000),
    );
    label = "30-Day Pass active";
  }

  const badgeVariant: "default" | "secondary" | "outline" =
    status === "lifetime" ? "default" : status === "active" ? "secondary" : "outline";

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Current entitlement
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {status === "lifetime" ? (
              <InfinityIcon className="h-5 w-5 text-primary" />
            ) : status === "active" ? (
              <Calendar className="h-5 w-5 text-primary" />
            ) : null}
            <span className="font-display text-lg">{label}</span>
            <Badge variant={badgeVariant}>
              {status === "lifetime" ? "Lifetime" : status === "active" ? "Active" : "None"}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          {status === "active" && (
            <>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Days left
              </div>
              <div className="font-display text-2xl font-semibold">{daysLeft}</div>
              <div className="text-xs text-muted-foreground">Expires {fmt(expiresAt)}</div>
            </>
          )}
          {status === "lifetime" && (
            <div className="text-xs text-muted-foreground">Never expires</div>
          )}
          {status === "none" && (
            <div className="text-xs text-muted-foreground">
              Grant a pass below to activate access.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}


function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-4xl px-5 py-12">{children}</section>;
}
