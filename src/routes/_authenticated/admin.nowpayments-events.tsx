import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import {
  amIAdmin,
  adminListNowpaymentsEvents,
  adminRetryNowpaymentsGrant,
  adminBulkUpdateNowpaymentsEvents,
  type NowpaymentsBulkAction,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, ExternalLink, RefreshCw, RotateCw, FileJson, Copy, Download, StickyNote, CheckSquare, Square } from "lucide-react";


const searchSchema = z.object({
  status: fallback(z.string(), "all").default("all"),
  handled: fallback(z.string(), "all").default("all"),
  reversal: fallback(z.string(), "all").default("all"),
  sort: fallback(z.string(), "last_seen_desc").default("last_seen_desc"),
  q: fallback(z.string(), "").default(""),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 50).default(50),
});

export const Route = createFileRoute("/_authenticated/admin/nowpayments-events")({
  head: () => ({ meta: [{ title: "NOWPayments IPN Events · Admin" }] }),
  validateSearch: zodValidator(searchSchema),
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
  const bulkFn = useServerFn(adminBulkUpdateNowpaymentsEvents);
  const qc = useQueryClient();


  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });

  const urlSearch = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const HANDLED_VALUES = ["all", "handled", "unhandled"] as const;
  const REVERSAL_VALUES: ReversalFilter[] = ["all", "any", "revoked", "suspended"];
  const SORT_VALUES = Object.keys(SORT_LABELS) as SortMode[];
  const initialHandled = (HANDLED_VALUES as readonly string[]).includes(urlSearch.handled)
    ? (urlSearch.handled as "all" | "handled" | "unhandled")
    : "all";
  const initialReversal = (REVERSAL_VALUES as string[]).includes(urlSearch.reversal)
    ? (urlSearch.reversal as ReversalFilter)
    : "all";
  const initialSort = (SORT_VALUES as string[]).includes(urlSearch.sort)
    ? (urlSearch.sort as SortMode)
    : "last_seen_desc";
  const initialStatus = STATUS_OPTIONS.includes(urlSearch.status) ? urlSearch.status : "all";

  const [status, setStatus] = useState<string>(initialStatus);
  const [handled, setHandled] = useState<"all" | "handled" | "unhandled">(initialHandled);
  const [reversal, setReversal] = useState<ReversalFilter>(initialReversal);
  const [sort, setSort] = useState<SortMode>(initialSort);
  const [searchInput, setSearchInput] = useState(urlSearch.q);
  const [search, setSearch] = useState(urlSearch.q);
  const [page, setPage] = useState<number>(urlSearch.page);
  const [pageSize, setPageSize] = useState<number>(urlSearch.pageSize);
  const [autoRefresh, setAutoRefresh] = useState<number>(0); // seconds; 0 = off
  const [exportScope, setExportScope] = useState<"page" | "all">("page");
  const [isExporting, setIsExporting] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<EventItem | null>(null);
  const [payloadEvent, setPayloadEvent] = useState<EventItem | null>(null);
  const [jumpInput, setJumpInput] = useState("");
  // Bulk-selection state — keyed by `${payment_id}::${last_status}` (composite pk).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<NowpaymentsBulkAction | null>(null);
  const [bulkNote, setBulkNote] = useState("");

  // Custom filter presets persisted to localStorage.
  type CustomPreset = {
    id: string;
    name: string;
    status: string;
    handled: "all" | "handled" | "unhandled";
    reversal: ReversalFilter;
    sort: SortMode;
    search: string;
  };
  const CUSTOM_PRESETS_KEY = "nowpayments-events:custom-presets:v1";
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CustomPreset[];
        if (Array.isArray(parsed)) setCustomPresets(parsed);
      }
    } catch {
      /* ignore */
    }
    setPresetsLoaded(true);
  }, []);

  useEffect(() => {
    if (!presetsLoaded) return;
    try {
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(customPresets));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [customPresets, presetsLoaded]);


  // Sync current filter/search/sort/page state → URL query params so the view is
  // shareable and reloadable. Uses replace: true so state changes don't spam
  // browser history.
  useEffect(() => {
    navigate({
      search: {
        status,
        handled,
        reversal,
        sort,
        q: search,
        page,
        pageSize,
      },
      replace: true,
      resetScroll: false,
    });
  }, [status, handled, reversal, sort, search, page, pageSize, navigate]);


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

  const bulk = useMutation({
    mutationFn: (input: { keys: Array<{ paymentId: string; lastStatus: string }>; action: NowpaymentsBulkAction; note?: string }) =>
      bulkFn({ data: input }),
    onSuccess: (res) => {
      if (res.failed.length === 0) {
        toast.success(`Updated ${res.updated} of ${res.total} event(s).`);
      } else {
        toast.warning(`Updated ${res.updated}/${res.total} — ${res.failed.length} failed. First error: ${res.failed[0]?.error}`);
      }
      setBulkAction(null);
      setBulkNote("");
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin-nowpayments-events"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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
          className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border/60 bg-muted/20 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const id = jumpInput.trim();
            if (!id) return;
            // Clear filters so the exact match is guaranteed to show,
            // regardless of what's currently selected.
            setStatus("all");
            setHandled("all");
            setReversal("all");
            setSort("last_seen_desc");
            setSearchInput(id);
            setSearch(id);
            setPage(1);
          }}
        >
          <div className="min-w-[260px] flex-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Jump to payment_id
            </label>
            <Input
              className="mt-1 font-mono"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              placeholder="e.g. 5771247473"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={jumpInput.trim() === ""}>
            Jump
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setJumpInput("");
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            disabled={jumpInput === "" && search === ""}
          >
            Clear
          </Button>
        </form>


        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-muted-foreground mr-1">
            Presets
          </span>
          {(
            [
              {
                key: "all",
                label: "All events",
                apply: () => {
                  setStatus("all");
                  setHandled("all");
                  setReversal("all");
                  setSort("last_seen_desc");
                },
                isActive:
                  status === "all" &&
                  handled === "all" &&
                  reversal === "all" &&
                  sort === "last_seen_desc",
              },
              {
                key: "reversal",
                label: "Reversal needed",
                apply: () => {
                  setStatus("all");
                  setHandled("all");
                  setReversal("any");
                  setSort("last_seen_desc");
                },
                isActive: reversal === "any",
              },
              {
                key: "revoked",
                label: "Revoked",
                apply: () => {
                  setStatus("all");
                  setHandled("all");
                  setReversal("revoked");
                  setSort("last_seen_desc");
                },
                isActive: reversal === "revoked",
              },
              {
                key: "suspended",
                label: "Suspended",
                apply: () => {
                  setStatus("all");
                  setHandled("all");
                  setReversal("suspended");
                  setSort("last_seen_desc");
                },
                isActive: reversal === "suspended",
              },
              {
                key: "unhandled",
                label: "Unhandled",
                apply: () => {
                  setStatus("all");
                  setHandled("unhandled");
                  setReversal("all");
                  setSort("last_seen_desc");
                },
                isActive: handled === "unhandled" && reversal === "all",
              },
              {
                key: "handled",
                label: "Handled",
                apply: () => {
                  setStatus("all");
                  setHandled("handled");
                  setReversal("all");
                  setSort("last_seen_desc");
                },
                isActive: handled === "handled" && reversal === "all",
              },
              {
                key: "failed",
                label: "Failed",
                apply: () => {
                  setStatus("failed");
                  setHandled("all");
                  setReversal("all");
                  setSort("last_seen_desc");
                },
                isActive: status === "failed",
              },
              {
                key: "finished",
                label: "Finished",
                apply: () => {
                  setStatus("finished");
                  setHandled("all");
                  setReversal("all");
                  setSort("last_seen_desc");
                },
                isActive: status === "finished",
              },
            ] as const
          ).map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={preset.isActive ? "default" : "outline"}
              onClick={() => {
                resetToFirstPage();
                preset.apply();
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-muted-foreground mr-1">
            My presets
          </span>
          {customPresets.length === 0 && (
            <span className="text-xs text-muted-foreground italic">
              None saved yet — configure filters, name it, then Save.
            </span>
          )}
          {customPresets.map((p) => {
            const isActive =
              status === p.status &&
              handled === p.handled &&
              reversal === p.reversal &&
              sort === p.sort &&
              search === p.search;
            return (
              <span key={p.id} className="inline-flex items-center">
                <Button
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="rounded-r-none"
                  onClick={() => {
                    resetToFirstPage();
                    setStatus(p.status);
                    setHandled(p.handled);
                    setReversal(p.reversal);
                    setSort(p.sort);
                    setSearchInput(p.search);
                    setSearch(p.search);
                  }}
                >
                  {p.name}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="rounded-l-none border-l-0 px-2"
                  aria-label={`Delete preset ${p.name}`}
                  onClick={() => {
                    if (confirm(`Delete preset "${p.name}"?`)) {
                      setCustomPresets((prev) => prev.filter((x) => x.id !== p.id));
                    }
                  }}
                >
                  ×
                </Button>
              </span>
            );
          })}
          <form
            className="flex items-center gap-1 ml-auto"
            onSubmit={(e) => {
              e.preventDefault();
              const name = presetName.trim();
              if (!name) return;
              // Replace if a preset with the same (case-insensitive) name already exists.
              setCustomPresets((prev) => {
                const filtered = prev.filter(
                  (x) => x.name.toLowerCase() !== name.toLowerCase(),
                );
                return [
                  ...filtered,
                  {
                    id:
                      (globalThis.crypto?.randomUUID?.() ??
                        `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                    name,
                    status,
                    handled,
                    reversal,
                    sort,
                    search,
                  },
                ];
              });
              setPresetName("");
              toast.success(`Saved preset "${name}".`);
            }}
          >
            <Input
              className="h-8 w-[180px] text-xs"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Name current filters…"
              maxLength={40}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={presetName.trim() === ""}
            >
              Save
            </Button>
          </form>
        </div>


        {(() => {
          const chips: { key: string; label: string; clear: () => void }[] = [];
          if (status !== "all") {
            chips.push({
              key: "status",
              label: `Status: ${status}`,
              clear: () => {
                resetToFirstPage();
                setStatus("all");
              },
            });
          }
          if (handled !== "all") {
            chips.push({
              key: "handled",
              label: handled === "handled" ? "Handled" : "Unhandled",
              clear: () => {
                resetToFirstPage();
                setHandled("all");
              },
            });
          }
          if (reversal !== "all") {
            const label =
              reversal === "any"
                ? "Reversal needed"
                : reversal === "revoked"
                ? "Revoked"
                : "Suspended";
            chips.push({
              key: "reversal",
              label: `Reversal: ${label}`,
              clear: () => {
                resetToFirstPage();
                setReversal("all");
              },
            });
          }
          if (sort !== "last_seen_desc") {
            chips.push({
              key: "sort",
              label: `Sort: ${sort}`,
              clear: () => {
                resetToFirstPage();
                setSort("last_seen_desc");
              },
            });
          }
          if (search) {
            chips.push({
              key: "search",
              label: `Search: ${search}`,
              clear: () => {
                resetToFirstPage();
                setSearchInput("");
                setSearch("");
              },
            });
          }
          if (chips.length === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground mr-1">
                Active
              </span>
              {chips.map((c) => (
                <Badge
                  key={c.key}
                  variant="secondary"
                  className="gap-1 pl-2 pr-1 py-1"
                >
                  <span>{c.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove filter ${c.label}`}
                    onClick={c.clear}
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
                  >
                    ×
                  </button>
                </Badge>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetToFirstPage();
                  setStatus("all");
                  setHandled("all");
                  setReversal("all");
                  setSort("last_seen_desc");
                  setSearchInput("");
                  setSearch("");
                }}
              >
                Clear all
              </Button>
            </div>
          );
        })()}




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
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Export scope
            </label>
            <Select value={exportScope} onValueChange={(v) => setExportScope(v as "page" | "all")}>
              <SelectTrigger className="mt-1 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">This page ({items.length})</SelectItem>
                <SelectItem value="all">All filtered ({totalCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              if (exportScope === "page") {
                exportEventsCsv(items, { status, handled, reversal, sort, search });
                return;
              }
              if (totalCount === 0) return;
              setIsExporting(true);
              try {
                const all: EventItem[] = [];
                const chunkSize = 500;
                const totalPages = Math.max(1, Math.ceil(totalCount / chunkSize));
                for (let p = 1; p <= totalPages; p++) {
                  const res = await listFn({
                    data: {
                      page: p,
                      pageSize: chunkSize,
                      status: status === "all" ? undefined : status,
                      handled,
                      reversal,
                      sort,
                      search: search || undefined,
                    },
                  });
                  all.push(...(res.items as EventItem[]));
                  if (res.items.length < chunkSize) break;
                }
                exportEventsCsv(all, { status, handled, reversal, sort, search });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                setIsExporting(false);
              }
            }}
            disabled={isExporting || (exportScope === "page" ? items.length === 0 : totalCount === 0)}
            title={
              exportScope === "page"
                ? items.length === 0
                  ? "No rows to export"
                  : `Download ${items.length} event(s) on this page as CSV`
                : totalCount === 0
                  ? "No rows to export"
                  : `Download all ${totalCount} filtered event(s) as CSV`
            }
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            Export CSV
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

      {items.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border/60 bg-muted/20 p-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-xs font-medium hover:text-primary"
            onClick={() => {
              const allKeys = items.map((e: EventItem) => `${e.payment_id}::${e.last_status}`);
              const allSelected = allKeys.every((k) => selected.has(k));
              const next = new Set(selected);
              if (allSelected) {
                for (const k of allKeys) next.delete(k);
              } else {
                for (const k of allKeys) next.add(k);
              }
              setSelected(next);
            }}
          >
            {items.every((e: EventItem) => selected.has(`${e.payment_id}::${e.last_status}`)) ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            Select page ({items.length})
          </button>
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setBulkAction("mark_handled")}
            >
              <CheckSquare className="h-3 w-3 mr-1" /> Mark handled
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setBulkAction("mark_unhandled")}
            >
              <Square className="h-3 w-3 mr-1" /> Mark unhandled
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => {
                setBulkNote("");
                setBulkAction("set_note");
              }}
            >
              <StickyNote className="h-3 w-3 mr-1" /> Add / edit note
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading events…</p>
        ) : items.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            No matching webhook events.
          </Card>
        ) : (
          items.map((e: EventItem) => {
            const key = `${e.payment_id}::${e.last_status}`;
            return (
              <EventRow
                key={key}
                e={e}
                selected={selected.has(key)}
                onToggleSelect={() => {
                  const next = new Set(selected);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  setSelected(next);
                }}
                onRetry={() => setPendingRetry(e)}
                onViewPayload={() => setPayloadEvent(e)}
                retryPending={retry.isPending && pendingRetry?.payment_id === e.payment_id}
              />
            );
          })
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

      <AlertDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulk.isPending) {
            setBulkAction(null);
            setBulkNote("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "mark_handled" && `Mark ${selected.size} event(s) as handled?`}
              {bulkAction === "mark_unhandled" && `Mark ${selected.size} event(s) as unhandled?`}
              {bulkAction === "set_note" && `Set admin note on ${selected.size} event(s)?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This applies to <strong>{selected.size}</strong> signature-verified webhook
                  {selected.size === 1 ? " event" : " events"}. It only updates admin metadata —
                  no grants, refunds, or user-visible entitlements change.
                </p>
                {bulkAction === "mark_handled" && (
                  <p className="text-muted-foreground">
                    Sets <code className="font-mono">handled = true</code> and clears any prior
                    unhandled reason. Use this to acknowledge events you've already resolved manually.
                  </p>
                )}
                {bulkAction === "mark_unhandled" && (
                  <p className="text-muted-foreground">
                    Sets <code className="font-mono">handled = false</code>. Useful to re-flag rows
                    that need another look.
                  </p>
                )}
                {bulkAction === "set_note" && (
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Note (leave empty to clear)
                    </label>
                    <Textarea
                      value={bulkNote}
                      onChange={(e) => setBulkNote(e.target.value)}
                      placeholder="e.g. Refunded manually via NOWPayments dashboard — see ticket #482"
                      rows={4}
                      maxLength={2000}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Same note will overwrite any existing admin_note on every selected row (max 2000 chars).
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulk.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulk.isPending || bulkAction === null || selected.size === 0}
              onClick={(ev) => {
                ev.preventDefault();
                if (!bulkAction) return;
                const keys = Array.from(selected).map((k) => {
                  const idx = k.indexOf("::");
                  return { paymentId: k.slice(0, idx), lastStatus: k.slice(idx + 2) };
                });
                bulk.mutate({
                  keys,
                  action: bulkAction,
                  note: bulkAction === "set_note" ? bulkNote : undefined,
                });
              }}
            >
              {bulk.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Applying…
                </>
              ) : (
                <>Apply to {selected.size}</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  admin_note: string | null;
  admin_note_updated_at: string | null;
  handled_updated_at: string | null;
};

function EventRow({
  e,
  selected,
  onToggleSelect,
  onRetry,
  onViewPayload,
  retryPending,
}: {
  e: EventItem;
  selected: boolean;
  onToggleSelect: () => void;
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
    <Card className={`p-4 ${selected ? "ring-2 ring-primary/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label="Select event"
            className="mt-1"
          />
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
          {e.admin_note && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
              <StickyNote className="h-3 w-3 mt-0.5 text-primary flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap break-words">{e.admin_note}</div>
                {e.admin_note_updated_at && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Note updated {fmt(e.admin_note_updated_at)}
                  </div>
                )}
              </div>
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
