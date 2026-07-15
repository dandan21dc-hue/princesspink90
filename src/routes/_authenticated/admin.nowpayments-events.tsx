import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  amIAdmin,
  adminListNowpaymentsEvents,
  adminRetryNowpaymentsGrant,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ShieldCheck, ExternalLink, RefreshCw, RotateCw, FileJson, Copy, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/nowpayments-events")({
  head: () => ({ meta: [{ title: "NOWPayments IPN Events · Admin" }] }),
  component: AdminNowpaymentsEvents,
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

const STATUS_OPTIONS = [
  "all",
  "finished",
  "confirmed",
  "confirming",
  "sending",
  "waiting",
  "partially_paid",
  "failed",
  "refunded",
  "reversed",
  "chargeback",
  "disputed",
  "expired",
  "unknown",
];

type ReversalFilter = "all" | "any" | "revoked" | "suspended";
type SortMode =
  | "last_seen_desc"
  | "last_seen_asc"
  | "first_seen_desc"
  | "first_seen_asc"
  | "last_status_asc"
  | "last_status_desc"
  | "payment_id_asc"
  | "payment_id_desc";

const SORT_LABELS: Record<SortMode, string> = {
  last_seen_desc: "Last seen · newest",
  last_seen_asc: "Last seen · oldest",
  first_seen_desc: "First seen · newest",
  first_seen_asc: "First seen · oldest",
  last_status_asc: "Status · A→Z",
  last_status_desc: "Status · Z→A",
  payment_id_asc: "Payment ID · A→Z",
  payment_id_desc: "Payment ID · Z→A",
};

function AdminNowpaymentsEvents() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(adminListNowpaymentsEvents);
  const retryFn = useServerFn(adminRetryNowpaymentsGrant);
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });

  const [status, setStatus] = useState<string>("all");
  const [handled, setHandled] = useState<"all" | "handled" | "unhandled">("all");
  const [reversal, setReversal] = useState<ReversalFilter>("all");
  const [sort, setSort] = useState<SortMode>("last_seen_desc");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState<number>(0); // seconds; 0 = off
  const [exportScope, setExportScope] = useState<"page" | "all">("page");
  const [isExporting, setIsExporting] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<EventItem | null>(null);
  const [payloadEvent, setPayloadEvent] = useState<EventItem | null>(null);

  // Reset to page 1 whenever filters/search/sort/pageSize change.
  const resetToFirstPage = () => setPage(1);

  const list = useQuery({
    queryKey: ["admin-nowpayments-events", { status, handled, reversal, sort, search, page, pageSize }],
    queryFn: () =>
      listFn({
        data: {
          page,
          pageSize,
          status: status === "all" ? undefined : status,
          handled,
          reversal,
          sort,
          search: search || undefined,
        },
      }),
    enabled: me.data?.isAdmin === true,
    refetchInterval: autoRefresh > 0 ? autoRefresh * 1000 : false,
    refetchIntervalInBackground: false,
  });


  const retry = useMutation({
    mutationFn: (paymentId: string) => retryFn({ data: { paymentId } }),
    onSuccess: (res) => {
      if (res.handled) {
        toast.success(
          `Retry succeeded: ${res.kind} grant is idempotently applied${
            res.entitlementId ? ` (id ${res.entitlementId.slice(0, 8)}…)` : ""
          }.`,
        );
      } else {
        toast.warning(
          `Retry ran but did not grant: ${res.reason ?? "no reason returned"}.`,
        );
      }
      setPendingRetry(null);
      qc.invalidateQueries({ queryKey: ["admin-nowpayments-events"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : String(e));
    },
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

  const items = list.data?.items ?? [];
  const summary = list.data?.summary;
  const totalCount = list.data?.totalCount ?? 0;


  return (
    <Shell>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">
            Admin · Payments
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            NOWPayments IPN events
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signature-verified webhook deliveries with grant outcome and a link to
            the entitlement that was created.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <Card className="mt-8 p-5 space-y-4">
        <div className="text-xs text-muted-foreground">
          <ShieldCheck className="inline h-3 w-3 mr-1 text-primary" /> Only requests
          whose <code className="font-mono">x-nowpayments-sig</code> matched
          <code className="font-mono"> HMAC-SHA512(body, IPN_SECRET)</code> are
          stored, so every row below is signature-verified by construction.
        </div>

        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            resetToFirstPage();
            setSearch(searchInput.trim());
          }}
        >
          <div className="min-w-[240px] flex-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Search
            </label>
            <Input
              className="mt-1"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="payment_id, order_id, buyer@email, or membership/order/booking UUID"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Auto-detected: an <code className="font-mono">@</code> is treated as a buyer email
              (resolves to their entitlement payments); a UUID matches a membership,
              panty order or booking id; anything else is an ilike match on
              <code className="font-mono"> payment_id</code>/<code className="font-mono">order_id</code>.
            </p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Status
            </label>
            <Select value={status} onValueChange={(v) => { resetToFirstPage(); setStatus(v); }}>
              <SelectTrigger className="mt-1 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Handled
            </label>
            <Select
              value={handled}
              onValueChange={(v) => { resetToFirstPage(); setHandled(v as typeof handled); }}
            >
              <SelectTrigger className="mt-1 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="handled">Handled</SelectItem>
                <SelectItem value="unhandled">Unhandled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Reversal
            </label>
            <Select
              value={reversal}
              onValueChange={(v) => { resetToFirstPage(); setReversal(v as ReversalFilter); }}
            >
              <SelectTrigger className="mt-1 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="any">Any reversal</SelectItem>
                <SelectItem value="revoked">Revoked (refund/reversed)</SelectItem>
                <SelectItem value="suspended">Suspended (chargeback/dispute)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Sort
            </label>
            <Select value={sort} onValueChange={(v) => { resetToFirstPage(); setSort(v as SortMode); }}>
              <SelectTrigger className="mt-1 w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Per page
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { resetToFirstPage(); setPageSize(Number(v)); }}
            >
              <SelectTrigger className="mt-1 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200, 500].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Auto-refresh
            </label>
            <Select
              value={String(autoRefresh)}
              onValueChange={(v) => setAutoRefresh(Number(v))}
            >
              <SelectTrigger className="mt-1 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Off</SelectItem>
                <SelectItem value="10">10s</SelectItem>
                <SelectItem value="30">30s</SelectItem>
                <SelectItem value="60">1m</SelectItem>
                <SelectItem value="300">5m</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit">Apply</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {list.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => exportEventsCsv(items, { status, handled, reversal, sort, search })}
            disabled={items.length === 0}
            title={
              items.length === 0
                ? "No rows to export"
                : `Download ${items.length} filtered event(s) as CSV`
            }
          >
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </form>

        {summary && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
            <span>Matching total: {totalCount}</span>
            <span>On this page: {summary.total}</span>
            <span>Handled: {summary.handled}</span>
            <span>Unhandled: {summary.unhandled}</span>
            <span>Finished: {summary.finished}</span>
            <span className="text-destructive">Revoked: {summary.revoked}</span>
            <span className="text-destructive">Suspended: {summary.suspended}</span>
          </div>
        )}
      </Card>

      <div className="mt-6 space-y-3">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading events…</p>
        ) : items.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No matching webhook events.
          </Card>
        ) : (
          items.map((e: EventItem) => (
            <EventRow
              key={`${e.payment_id}:${e.last_status}`}
              e={e}
              onRetry={() => setPendingRetry(e)}
              onViewPayload={() => setPayloadEvent(e)}
              retryPending={retry.isPending && pendingRetry?.payment_id === e.payment_id}
            />
          ))
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        showing={items.length}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        onJump={(p: number) => setPage(p)}
        loading={list.isFetching}
      />


      <AlertDialog
        open={pendingRetry !== null}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setPendingRetry(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry NOWPayments grant?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This re-runs the grant path for the signature-verified event
                  below. It is safe to retry — the underlying grant is
                  idempotent on <code className="font-mono">external_payment_reference</code>{" "}
                  (<code className="font-mono">nowpayments:{pendingRetry?.payment_id}</code>),
                  so an already-granted entitlement will not be duplicated.
                </p>
                <div className="rounded-md bg-muted/60 p-3 text-xs font-mono space-y-1 break-all">
                  <div>payment_id: {pendingRetry?.payment_id}</div>
                  <div>status: {pendingRetry?.last_status}</div>
                  <div>order_id: {pendingRetry?.order_id ?? "—"}</div>
                  {pendingRetry?.parsed_order && (
                    <div>
                      kind: {pendingRetry.parsed_order.kind} ·{" "}
                      {pendingRetry.parsed_order.environment}
                    </div>
                  )}
                  {pendingRetry?.reason && !pendingRetry.handled && (
                    <div>previous reason: {pendingRetry.reason}</div>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retry.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={retry.isPending || !pendingRetry}
              onClick={(ev) => {
                ev.preventDefault();
                if (pendingRetry) retry.mutate(pendingRetry.payment_id);
              }}
            >
              {retry.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Retrying…
                </>
              ) : (
                <>
                  <RotateCw className="h-4 w-4 mr-2" /> Retry grant
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayloadDialog
        event={payloadEvent}
        onClose={() => setPayloadEvent(null)}
      />
    </Shell>
  );
}


type EventItem = {
  payment_id: string;
  last_status: string;
  order_id: string | null;
  handled: boolean;
  reason: string | null;
  received_count: number;
  first_seen_at: string;
  last_seen_at: string;
  processed_at: string | null;
  signature_verified: boolean;
  parsed_order:
    | { kind: string; userId: string; environment: string; amountCents: number }
    | null;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  entitlement:
    | { kind: "membership" | "panty_order" | "booking"; id: string; label: string }
    | null;
  reversal:
    | {
        mode: "revoked" | "suspended";
        reason: string | null;
        at: string | null;
        applied: boolean;
      }
    | null;
  payload_json: string | null;
};

function EventRow({
  e,
  onRetry,
  onViewPayload,
  retryPending,
}: {
  e: EventItem;
  onRetry: () => void;
  onViewPayload: () => void;
  retryPending: boolean;
}) {
  const canRetry = e.last_status === "finished" && e.parsed_order !== null;
  const statusVariant: "default" | "secondary" | "outline" | "destructive" =
    e.last_status === "finished"
      ? "default"
      : e.last_status === "failed" ||
          e.last_status === "expired" ||
          e.last_status === "refunded"
        ? "destructive"
        : "secondary";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={statusVariant}>{e.last_status}</Badge>
            <Badge variant="outline" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3 text-primary" /> Signature verified
            </Badge>
            {e.handled ? (
              <Badge variant="default" className="text-[10px]">
                Handled
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                {e.reason ?? "Not handled"}
              </Badge>
            )}
            {e.parsed_order && (
              <Badge variant="outline" className="text-[10px]">
                {e.parsed_order.kind} · {e.parsed_order.environment}
              </Badge>
            )}
            {e.reversal && (
              <Badge
                variant={e.reversal.applied ? "destructive" : "outline"}
                className="text-[10px] uppercase"
                title={e.reversal.reason ?? undefined}
              >
                {e.reversal.mode === "revoked" ? "Revoked" : "Suspended"}
                {e.reversal.applied ? "" : " · not applied"}
              </Badge>
            )}
            {e.received_count > 1 && (
              <Badge variant="secondary" className="text-[10px]">
                ×{e.received_count} deliveries
              </Badge>
            )}
          </div>

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">payment_id: </span>
              <span className="font-mono">{e.payment_id}</span>
            </div>
            <div>
              <span className="text-muted-foreground">user: </span>
              {e.user_id ? (
                <>
                  <span className="text-foreground">
                    {e.user_email ?? e.user_display_name ?? "—"}
                  </span>
                  <div className="font-mono text-[10px] text-muted-foreground/70 truncate">
                    {e.user_id}
                  </div>
                  <Link
                    to="/admin/user-access-timeline"
                    search={{ userId: e.user_id }}
                    className="text-[11px] text-primary underline underline-offset-2"
                  >
                    View access timeline →
                  </Link>
                </>
              ) : (
                <span className="text-muted-foreground">unresolved</span>
              )}
            </div>
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">order_id: </span>
              <span className="font-mono break-all">{e.order_id ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">first seen: </span>
              {fmt(e.first_seen_at)}
            </div>
            <div>
              <span className="text-muted-foreground">last seen: </span>
              {fmt(e.last_seen_at)}
            </div>
            {e.processed_at && (
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">processed: </span>
                {fmt(e.processed_at)}
              </div>
            )}
            {e.reversal && (
              <div className="sm:col-span-2 text-destructive">
                <span className="text-muted-foreground">
                  {e.reversal.mode === "revoked" ? "revoked" : "suspended"}:{" "}
                </span>
                {e.reversal.applied
                  ? `${fmt(e.reversal.at)}${
                      e.reversal.reason ? ` · ${e.reversal.reason}` : ""
                    }`
                  : "no matching entitlement found for this payment_id"}
              </div>
            )}
          </div>
        </div>

        <div className="text-right space-y-2 min-w-[180px]">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Entitlement
          </div>
          {e.entitlement ? (
            <EntitlementLink e={e.entitlement} userEmail={e.user_email} />
          ) : (
            <div className="text-xs text-muted-foreground">
              {e.handled
                ? "Row not linked (no external_payment_reference match)"
                : "None granted"}
            </div>
          )}
          <div className="flex flex-col gap-2 items-end mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onViewPayload}
              disabled={!e.payload_json}
              className="gap-1"
              title={
                e.payload_json
                  ? "View raw IPN payload and parsed fields"
                  : "No stored payload"
              }
            >
              <FileJson className="h-3 w-3" /> View payload
            </Button>
            {canRetry && (
              <Button
                type="button"
                size="sm"
                variant={e.handled ? "outline" : "default"}
                onClick={onRetry}
                disabled={retryPending}
                className="gap-1"
                title={
                  e.handled
                    ? "Re-run the idempotent grant (safe — will not double-grant)"
                    : "Reprocess this failed / unhandled grant"
                }
              >
                {retryPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
                {e.handled ? "Re-run grant" : "Retry grant"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}


function EntitlementLink({
  e,
  userEmail,
}: {
  e: { kind: "membership" | "panty_order" | "booking"; id: string; label: string };
  userEmail: string | null;
}) {
  if (e.kind === "membership") {
    // The manual All-Access admin page loads memberships by user email.
    return (
      <div className="space-y-1">
        <div className="text-sm font-mono">{e.label}</div>
        <div className="font-mono text-[10px] text-muted-foreground/70 truncate">
          {e.id}
        </div>
        {userEmail ? (
          <Link
            to="/admin/all-access"
            search={{ email: userEmail } as never}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open in All-Access <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
    );
  }
  if (e.kind === "panty_order") {
    return (
      <div className="space-y-1">
        <div className="text-sm">{e.label}</div>
        <div className="font-mono text-[10px] text-muted-foreground/70 truncate">
          {e.id}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-sm">{e.label}</div>
      <div className="font-mono text-[10px] text-muted-foreground/70 truncate">
        {e.id}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  totalCount,
  showing,
  onPrev,
  onNext,
  onJump,
  loading,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  showing: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (p: number) => void;
  loading: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = totalCount === 0 ? 0 : (page - 1) * pageSize + showing;
  const [jump, setJump] = useState("");
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <div>
        Showing <span className="text-foreground font-medium">{from}</span>–
        <span className="text-foreground font-medium">{to}</span> of{" "}
        <span className="text-foreground font-medium">{totalCount}</span> event
        {totalCount === 1 ? "" : "s"} · page {page} of {totalPages}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onPrev}
          disabled={!canPrev || loading}
        >
          ← Prev
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
              onJump(Math.floor(n));
              setJump("");
            }
          }}
          className="flex items-center gap-1"
        >
          <Input
            className="h-8 w-16 text-center"
            placeholder={String(page)}
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ""))}
            aria-label="Jump to page"
          />
          <Button type="submit" size="sm" variant="ghost" disabled={loading || !jump}>
            Go
          </Button>
        </form>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onNext}
          disabled={!canNext || loading}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}



function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-5 py-12">{children}</section>;
}

// Fields commonly emitted by NOWPayments IPN payloads that are useful to
// audit at a glance when reviewing a reversal or unusual outcome.
const PARSED_FIELD_ORDER = [
  "payment_id",
  "payment_status",
  "order_id",
  "order_description",
  "purchase_id",
  "invoice_id",
  "price_amount",
  "price_currency",
  "pay_amount",
  "pay_currency",
  "actually_paid",
  "actually_paid_at_fiat",
  "outcome_amount",
  "outcome_currency",
  "fee",
  "network",
  "network_precision",
  "pay_address",
  "payin_hash",
  "payout_hash",
  "created_at",
  "updated_at",
] as const;

function PayloadDialog({
  event,
  onClose,
}: {
  event: EventItem | null;
  onClose: () => void;
}) {
  const parsed = (() => {
    if (!event?.payload_json) return null;
    try {
      return JSON.parse(event.payload_json) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const pretty = (() => {
    if (!event?.payload_json) return "";
    try {
      return JSON.stringify(JSON.parse(event.payload_json), null, 2);
    } catch {
      return event.payload_json;
    }
  })();

  const parsedRows = parsed
    ? [
        ...PARSED_FIELD_ORDER.filter((k) => k in parsed).map((k) => [k, parsed[k]] as const),
        ...Object.entries(parsed).filter(
          ([k]) => !(PARSED_FIELD_ORDER as readonly string[]).includes(k),
        ),
      ]
    : [];

  const copy = async () => {
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      toast.success("Payload copied to clipboard");
    } catch {
      toast.error("Could not copy payload");
    }
  };

  return (
    <Dialog open={event !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-primary" /> IPN payload
          </DialogTitle>
          <DialogDescription>
            Raw signature-verified NOWPayments webhook body for{" "}
            <code className="font-mono">payment_id {event?.payment_id}</code>
            {event?.received_count && event.received_count > 1
              ? ` · latest of ${event.received_count} deliveries`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto space-y-5 pr-1">
          <section>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Ledger row
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs font-mono grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 break-all">
              <div>last_status: {event?.last_status}</div>
              <div>handled: {String(event?.handled)}</div>
              <div>received_count: {event?.received_count}</div>
              <div>reason: {event?.reason ?? "—"}</div>
              <div>first_seen_at: {event?.first_seen_at}</div>
              <div>last_seen_at: {event?.last_seen_at}</div>
              <div className="sm:col-span-2">processed_at: {event?.processed_at ?? "—"}</div>
              <div className="sm:col-span-2">order_id: {event?.order_id ?? "—"}</div>
              {event?.parsed_order && (
                <div className="sm:col-span-2">
                  parsed order: {event.parsed_order.kind} · {event.parsed_order.environment} ·{" "}
                  user {event.parsed_order.userId} · {event.parsed_order.amountCents}c
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Parsed IPN fields
            </div>
            {parsedRows.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {parsed === null ? "Payload is not valid JSON." : "No fields present."}
              </div>
            ) : (
              <div className="rounded-md border divide-y text-xs">
                {parsedRows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[180px_1fr] gap-3 p-2">
                    <div className="font-mono text-muted-foreground">{k}</div>
                    <div className="font-mono break-all">
                      {v === null || v === undefined
                        ? "—"
                        : typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Raw JSON
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copy}
                disabled={!pretty}
                className="gap-1"
              >
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <pre className="rounded-md border bg-muted/40 p-3 text-[11px] font-mono overflow-x-auto max-h-[40vh] whitespace-pre">
              {pretty || "(no payload stored)"}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ---------- CSV export of the filtered event list ----------
//
// Client-side export of the rows currently loaded into `list.data.items`
// (already reflects every server-side filter/sort). Escapes per RFC 4180:
// fields containing "," / '"' / newlines get wrapped in double quotes and
// internal quotes are doubled. Booleans/nulls flatten to sensible strings.

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS: Array<[string, (e: EventItem) => unknown]> = [
  ["payment_id", (e) => e.payment_id],
  ["last_status", (e) => e.last_status],
  ["handled", (e) => e.handled],
  ["reason", (e) => e.reason],
  ["received_count", (e) => e.received_count],
  ["first_seen_at", (e) => e.first_seen_at],
  ["last_seen_at", (e) => e.last_seen_at],
  ["processed_at", (e) => e.processed_at],
  ["signature_verified", (e) => e.signature_verified],
  ["order_id", (e) => e.order_id],
  ["parsed_kind", (e) => e.parsed_order?.kind ?? ""],
  ["parsed_environment", (e) => e.parsed_order?.environment ?? ""],
  ["parsed_amount_cents", (e) => e.parsed_order?.amountCents ?? ""],
  ["user_id", (e) => e.user_id],
  ["user_email", (e) => e.user_email],
  ["user_display_name", (e) => e.user_display_name],
  ["entitlement_kind", (e) => e.entitlement?.kind ?? ""],
  ["entitlement_id", (e) => e.entitlement?.id ?? ""],
  ["entitlement_label", (e) => e.entitlement?.label ?? ""],
  ["reversal_mode", (e) => e.reversal?.mode ?? ""],
  ["reversal_applied", (e) => (e.reversal ? e.reversal.applied : "")],
  ["reversal_at", (e) => e.reversal?.at ?? ""],
  ["reversal_reason", (e) => e.reversal?.reason ?? ""],
];

function exportEventsCsv(
  items: EventItem[],
  filters: {
    status: string;
    handled: string;
    reversal: string;
    sort: string;
    search: string;
  },
) {
  if (items.length === 0) return;

  const header = CSV_COLUMNS.map(([k]) => k).join(",");
  const rows = items.map((e) =>
    CSV_COLUMNS.map(([, get]) => csvCell(get(e))).join(","),
  );
  // BOM so Excel opens the file as UTF-8 without mangling non-ASCII fields.
  const csv = "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";

  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const filterSlug = [
    filters.status !== "all" ? `status-${filters.status}` : null,
    filters.handled !== "all" ? filters.handled : null,
    filters.reversal !== "all" ? `rev-${filters.reversal}` : null,
    filters.search ? "search" : null,
  ]
    .filter(Boolean)
    .join("_");
  const suffix = filterSlug ? `_${filterSlug}` : "";
  const filename = `nowpayments-events${suffix}_${ts}.csv`;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${items.length} event(s) to ${filename}`);
}
