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
  adminBulkAllAccess,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, InfinityIcon, Calendar, History, Upload, ShieldCheck } from "lucide-react";


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

  const [pendingRevoke, setPendingRevoke] = useState<{
    id: string;
    kind: string;
    environment: string;
    expires_at: string | null;
  } | null>(null);
  const [lastVerified, setLastVerified] = useState<{ id: string; kind: string } | null>(null);

  const revoke = useMutation({
    mutationFn: (membershipId: string) => revokeFn({ data: { membershipId } }),
    onSuccess: (res) => {
      const kind = res.deleted?.kind ?? "membership";
      if (res.verified) {
        setLastVerified({ id: res.deleted?.id ?? "", kind });
        toast.success(`Revoked and verified: ${kind} row removed from database`);
      } else {
        toast.warning(`Delete returned OK but verification could not confirm removal`);
      }
      setPendingRevoke(null);
      qc.invalidateQueries({ queryKey: ["admin-all-access-lookup"] });
      qc.invalidateQueries({ queryKey: ["admin-all-access-audit"] });
    },
    onError: (e: Error) => {
      setPendingRevoke(null);
      toast.error(e.message);
    },
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
                        <div className="flex flex-col items-end gap-2">
                          {lastVerified?.id === m.id && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <ShieldCheck className="h-3 w-3" /> Verified removed
                            </Badge>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              setPendingRevoke({
                                id: m.id,
                                kind: m.kind,
                                environment: m.environment,
                                expires_at: m.expires_at,
                              })
                            }
                            disabled={revoke.isPending}
                          >
                            <Trash2 className="h-4 w-4 mr-1" /> Revoke
                          </Button>
                        </div>
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
      <BulkPanel />

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

type AuditEntry = {
  id: string;
  action: "grant_all_access" | "revoke_all_access";
  created_at: string;
  actor_id: string;
  actor: { email: string | null; display_name: string | null };
  metadata: {
    target_user_id?: string;
    kind?: string;
    rpc?: string;
    environment?: string;
    membership_id?: string | null;
    expires_at?: string | null;
    external_payment_reference?: string | null;
  };
};

function AuditLogPanel({
  title,
  entries,
  isLoading,
}: {
  title: string;
  entries: AuditEntry[];
  isLoading: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <History className="h-4 w-4" /> Audit log
      </h2>
      <Card className="p-5">
        <div className="text-xs text-muted-foreground mb-3">{title}</div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No grants or revocations recorded for this user yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {entries.map((e) => {
              const isGrant = e.action === "grant_all_access";
              const actorLabel =
                e.actor.email ?? e.actor.display_name ?? e.actor_id;
              return (
                <li
                  key={e.id}
                  className="border border-border/40 rounded-md p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={isGrant ? "default" : "destructive"}>
                        {isGrant ? "Granted" : "Revoked"}
                      </Badge>
                      <span className="font-mono text-xs">
                        {e.metadata.kind ?? "—"}
                      </span>
                      {e.metadata.environment && (
                        <Badge variant="outline" className="text-[10px]">
                          {e.metadata.environment}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {fmt(e.created_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    by <span className="text-foreground">{actorLabel}</span>
                    {e.metadata.rpc && (
                      <>
                        {" · "}RPC{" "}
                        <span className="font-mono text-foreground">
                          {e.metadata.rpc}
                        </span>
                      </>
                    )}
                  </div>
                  {e.metadata.membership_id && (
                    <div className="mt-1 text-[10px] font-mono text-muted-foreground/70 truncate">
                      membership: {e.metadata.membership_id}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

type BulkRow = {
  email: string;
  action: "grant" | "revoke";
  kind?: "term_pass_all_access_30d" | "lifetime";
  raw: string;
  parseError?: string;
};

type BulkResult = {
  email: string;
  action: "grant" | "revoke";
  kind?: string;
  status: "success" | "error";
  message: string;
  membership_id?: string | null;
  revoked_count?: number;
};

const CSV_TEMPLATE =
  "email,action,kind\nalice@example.com,grant,lifetime\nbob@example.com,grant,term_pass_all_access_30d\ncarol@example.com,revoke,\n";

function normalizeKind(v: string): "term_pass_all_access_30d" | "lifetime" | undefined {
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "lifetime") return "lifetime";
  if (s === "30d" || s === "30-day" || s === "term_pass_all_access_30d" || s === "pass") {
    return "term_pass_all_access_30d";
  }
  return undefined;
}

function parseCsv(text: string): BulkRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const startIdx = first.startsWith("email") ? 1 : 0;
  const rows: BulkRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    const parts = raw.split(",").map((p) => p.trim());
    const email = (parts[0] ?? "").toLowerCase();
    const actionRaw = (parts[1] ?? "").toLowerCase();
    const kindRaw = parts[2] ?? "";
    const row: BulkRow = {
      email,
      action: actionRaw === "revoke" ? "revoke" : "grant",
      raw,
    };
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      row.parseError = "Invalid email";
    } else if (actionRaw !== "grant" && actionRaw !== "revoke") {
      row.parseError = `Invalid action "${actionRaw || "(empty)"}" — use grant or revoke`;
    } else if (actionRaw === "grant") {
      const kind = normalizeKind(kindRaw);
      if (!kind) {
        row.parseError = `Grant requires kind "lifetime" or "term_pass_all_access_30d"`;
      } else {
        row.kind = kind;
      }
    }
    rows.push(row);
  }
  return rows;
}

function BulkPanel() {
  const bulkFn = useServerFn(adminBulkAllAccess);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [results, setResults] = useState<BulkResult[] | null>(null);

  const rows = parseCsv(text);
  const validRows = rows.filter((r) => !r.parseError);
  const invalidRows = rows.filter((r) => r.parseError);

  const bulk = useMutation({
    mutationFn: () =>
      bulkFn({
        data: {
          operations: validRows.map((r) => ({
            email: r.email,
            action: r.action,
            kind: r.kind,
          })),
        },
      }),
    onSuccess: (res) => {
      setResults(res.results as BulkResult[]);
      const okCount = res.summary.success;
      const errCount = res.summary.errors;
      if (errCount === 0) toast.success(`Bulk complete: ${okCount} succeeded`);
      else toast.warning(`Bulk complete: ${okCount} succeeded, ${errCount} failed`);
      qc.invalidateQueries({ queryKey: ["admin-all-access-lookup"] });
      qc.invalidateQueries({ queryKey: ["admin-all-access-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (file: File) => {
    const t = await file.text();
    setText(t);
    setResults(null);
  };

  return (
    <div className="mt-12">
      <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <Upload className="h-4 w-4" /> Bulk grant / revoke by CSV
      </h2>
      <Card className="p-5 space-y-4">
        <div className="text-xs text-muted-foreground">
          CSV columns: <code className="font-mono">email,action,kind</code>. Action is{" "}
          <code className="font-mono">grant</code> or <code className="font-mono">revoke</code>.
          Kind (grant only) is <code className="font-mono">lifetime</code> or{" "}
          <code className="font-mono">term_pass_all_access_30d</code>. Revoke removes every
          All-Access membership row for that user in the current environment. Max 500 rows.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground cursor-pointer">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <span className="rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40">
              Upload CSV
            </span>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(CSV_TEMPLATE);
              setResults(null);
            }}
          >
            Load example
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("");
              setResults(null);
            }}
            disabled={!text}
          >
            Clear
          </Button>
        </div>

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResults(null);
          }}
          rows={8}
          spellCheck={false}
          placeholder="email,action,kind&#10;alice@example.com,grant,lifetime&#10;bob@example.com,revoke,"
          className="font-mono text-xs"
        />

        {rows.length > 0 && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
            <span>
              Parsed <span className="text-foreground">{rows.length}</span> row
              {rows.length === 1 ? "" : "s"}
            </span>
            <span>
              Valid: <span className="text-foreground">{validRows.length}</span>
            </span>
            {invalidRows.length > 0 && (
              <span className="text-destructive">Invalid: {invalidRows.length}</span>
            )}
          </div>
        )}

        {invalidRows.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1 max-h-40 overflow-auto">
            {invalidRows.slice(0, 20).map((r, i) => (
              <div key={i}>
                <span className="font-mono">{r.raw}</span>{" "}
                <span className="text-destructive">— {r.parseError}</span>
              </div>
            ))}
            {invalidRows.length > 20 && (
              <div className="text-muted-foreground">
                …and {invalidRows.length - 20} more
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => {
              const grants = validRows.filter((r) => r.action === "grant").length;
              const revokes = validRows.filter((r) => r.action === "revoke").length;
              if (
                !confirm(
                  `Run bulk on ${validRows.length} row${validRows.length === 1 ? "" : "s"}?\n` +
                    `Grants: ${grants}\nRevokes: ${revokes}`,
                )
              )
                return;
              bulk.mutate();
            }}
            disabled={validRows.length === 0 || bulk.isPending}
          >
            {bulk.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Run bulk ({validRows.length})
          </Button>
        </div>

        {results && (
          <div className="border-t border-border/40 pt-4 space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Results
            </div>
            <div className="max-h-80 overflow-auto space-y-1">
              {results.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs border border-border/40 rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={r.status === "success" ? "default" : "destructive"}
                      className="text-[10px]"
                    >
                      {r.status === "success" ? "OK" : "ERR"}
                    </Badge>
                    <span className="font-mono truncate">{r.email}</span>
                    <span className="text-muted-foreground">{r.action}</span>
                    {r.kind && (
                      <Badge variant="outline" className="text-[10px]">
                        {r.kind}
                      </Badge>
                    )}
                  </div>
                  <div
                    className={
                      r.status === "success" ? "text-muted-foreground" : "text-destructive"
                    }
                  >
                    {r.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}


