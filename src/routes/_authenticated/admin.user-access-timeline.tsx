import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  amIAdmin,
  adminGetUserAccessTimeline,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  MinusCircle,
  ShieldAlert,
  ShieldCheck,
  Loader2,
} from "lucide-react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/admin/user-access-timeline")({
  head: () => ({ meta: [{ title: "User Access Timeline · Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    userId: typeof search.userId === "string" ? search.userId : "",
  }),
  component: AdminUserAccessTimeline,
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

function AdminUserAccessTimeline() {
  const meFn = useServerFn(amIAdmin);
  const timelineFn = useServerFn(adminGetUserAccessTimeline);
  const search = useSearch({ from: "/_authenticated/admin/user-access-timeline" });

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const [userInput, setUserInput] = useState(search.userId ?? "");
  const [userId, setUserId] = useState(search.userId ?? "");

  const timeline = useQuery({
    queryKey: ["admin-user-access-timeline", userId],
    queryFn: () => timelineFn({ data: { userId } }),
    enabled: me.data?.isAdmin === true && UUID_RE.test(userId),
  });

  if (me.isLoading) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">
            Back to dashboard
          </Link>
        </p>
      </Shell>
    );
  }

  const summary = timeline.data?.summary;
  const profile = timeline.data?.profile;
  const items = timeline.data?.items ?? [];

  return (
    <Shell>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">
            Admin · Payments
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            User access change timeline
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every NOWPayments IPN event that has touched this user's entitlements,
            in the order it arrived — including refunds, chargebacks and the exact
            revocation or suspension action that was taken.
          </p>
        </div>
        <Link
          to="/admin/nowpayments-events"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← All events
        </Link>
      </div>

      <Card className="mt-8 p-5 space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = userInput.trim();
            if (UUID_RE.test(v)) setUserId(v);
          }}
        >
          <div className="min-w-[320px] flex-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              User ID (UUID)
            </label>
            <Input
              className="mt-1 font-mono text-xs"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <Button type="submit" disabled={!UUID_RE.test(userInput.trim())}>
            Load timeline
          </Button>
        </form>

        {userId && !UUID_RE.test(userId) ? (
          <p className="text-sm text-destructive">Invalid UUID.</p>
        ) : null}

        {UUID_RE.test(userId) && timeline.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…
          </div>
        ) : null}

        {timeline.data ? (
          <>
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                User
              </div>
              <div className="mt-1 text-sm">
                <span className="font-medium">
                  {profile?.display_name ?? "(no display name)"}
                </span>{" "}
                <span className="text-muted-foreground">
                  {profile?.email ?? ""}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                {timeline.data.userId}
              </div>
              {summary ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">Events: {summary.total}</Badge>
                  <Badge variant="secondary">Grants: {summary.grants}</Badge>
                  <Badge variant="destructive">Revokes: {summary.revokes}</Badge>
                  <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20">
                    Suspends: {summary.suspends}
                  </Badge>
                  <Badge variant="outline">No-ops: {summary.noops}</Badge>
                  <Badge>
                    Active memberships: {summary.active_memberships}
                  </Badge>
                </div>
              ) : null}
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No NOWPayments events found for this user.
              </p>
            ) : (
              <ol className="relative border-l border-border pl-6 space-y-4">
                {items.map((item, idx) => (
                  <TimelineRow
                    key={`${item.payment_id}|${item.status}|${idx}`}
                    item={item}
                  />
                ))}
              </ol>
            )}
          </>
        ) : null}
      </Card>
    </Shell>
  );
}

type TimelineItem = NonNullable<
  Awaited<ReturnType<typeof adminGetUserAccessTimeline>>
>["items"][number];

// createServerFn typing helper for the row prop — importing the exported type
// keeps this row component honest against the shape returned by the server fn.
import type { UserAccessTimelineEntry } from "@/lib/admin.functions";

function TimelineRow({ item }: { item: UserAccessTimelineEntry }) {
  const meta = ACTION_META[item.action];
  return (
    <li className="relative">
      <span
        className={`absolute -left-[31px] top-1 flex h-5 w-5 items-center justify-center rounded-full border ${meta.dotClass}`}
      >
        <meta.Icon className="h-3 w-3" />
      </span>
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="text-sm font-medium">{meta.title}</div>
        <div className="text-xs text-muted-foreground">
          {fmt(item.first_seen_at)}
          {item.received_count > 1 ? ` · ×${item.received_count}` : ""}
        </div>
        <Badge variant="outline" className="text-[10px] uppercase">
          {item.status || "unknown"}
        </Badge>
        {item.handled ? (
          <Badge variant="secondary" className="text-[10px]">
            handled
          </Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px]">
            unhandled
          </Badge>
        )}
      </div>
      <div className="mt-1 text-sm text-foreground/90">
        {item.action_detail}
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <div>
          Payment{" "}
          <span className="font-mono text-foreground">{item.payment_id}</span>
          {item.amount_cents != null ? (
            <>
              {" · "}
              <span className="font-mono">
                {(item.amount_cents / 100).toFixed(2)}
              </span>{" "}
              {item.currency?.toUpperCase() ?? ""}
            </>
          ) : null}
        </div>
        {item.order_id ? (
          <div className="font-mono truncate">order_id: {item.order_id}</div>
        ) : null}
        {item.entitlement ? (
          <div>
            Entitlement:{" "}
            <span className="text-foreground">{item.entitlement.label}</span>{" "}
            <span className="font-mono text-[10px]">
              ({item.entitlement.kind} {item.entitlement.id.slice(0, 8)}…)
            </span>
            {item.entitlement.kind === "membership" ? (
              <>
                {item.entitlement.revoked_at ? (
                  <> · revoked {fmt(item.entitlement.revoked_at)}</>
                ) : null}
                {item.entitlement.suspended_at ? (
                  <> · suspended {fmt(item.entitlement.suspended_at)}</>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {item.reason ? (
          <div>
            Webhook reason:{" "}
            <span className="font-mono text-foreground/80">{item.reason}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

const ACTION_META: Record<
  UserAccessTimelineEntry["action"],
  { title: string; Icon: React.ComponentType<{ className?: string }>; dotClass: string }
> = {
  grant: {
    title: "Access granted",
    Icon: CheckCircle2,
    dotClass:
      "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  revoke: {
    title: "Access revoked (refund)",
    Icon: Ban,
    dotClass:
      "border-destructive/50 bg-destructive/10 text-destructive",
  },
  suspend: {
    title: "Access suspended (dispute)",
    Icon: ShieldAlert,
    dotClass:
      "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  reversal_no_match: {
    title: "Reversal received — no entitlement to change",
    Icon: MinusCircle,
    dotClass:
      "border-muted-foreground/40 bg-muted/50 text-muted-foreground",
  },
  grant_noop: {
    title: "No entitlement change",
    Icon: MinusCircle,
    dotClass:
      "border-muted-foreground/40 bg-muted/50 text-muted-foreground",
  },
  ignored: {
    title: "Status update (no entitlement effect)",
    Icon: Clock,
    dotClass:
      "border-muted-foreground/30 bg-transparent text-muted-foreground",
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-5 py-12">{children}</section>;
}

// Silence unused warning for the placeholder icon import.
void Circle;
void ShieldCheck;
void TimelineItem;
