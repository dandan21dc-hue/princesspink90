import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Download, GripVertical, RefreshCw, Search, X } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { RoleGuard } from "@/components/RoleGuard";
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
  listMapPins,
  createMapPin,
  updateMapPin,
  deleteMapPin,
  reorderMapPins,
  type MapPin,
} from "@/lib/map-pins.functions";
import { MapPinsMap } from "@/components/MapPinsMap";
import { PinPickerMap } from "@/components/PinPickerMap";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  state: fallback(z.string(), "all").default("all"),
});

export const Route = createFileRoute("/_authenticated/admin/map-pins")({
  head: () => ({ meta: [{ title: "Map pins · Admin" }] }),
  validateSearch: zodValidator(searchSchema),
  component: () => (
    <RoleGuard allowedRoles={["admin"]}>
      <AdminMapPins />
    </RoleGuard>
  ),
});

type FormState = {
  id?: string;
  title: string;
  description: string;
  latitude: string;
  longitude: string;
  sort_order: string;
};

const empty: FormState = { title: "", description: "", latitude: "", longitude: "", sort_order: "0" };

function AdminMapPins() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMapPins);
  const createFn = useServerFn(createMapPin);
  const updateFn = useServerFn(updateMapPin);
  const deleteFn = useServerFn(deleteMapPin);
  const reorderFn = useServerFn(reorderMapPins);

  const REFRESH_STORAGE_KEY = "admin-map-pins:refresh-interval-ms";
  const REFRESH_OPTIONS = [
    { value: 0, label: "Off" },
    { value: 30_000, label: "30s" },
    { value: 60_000, label: "1m" },
    { value: 300_000, label: "5m" },
  ] as const;
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(REFRESH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (REFRESH_OPTIONS.some((o) => o.value === parsed)) setRefreshIntervalMs(parsed);
  }, []);
  const setRefreshInterval = (ms: number) => {
    setRefreshIntervalMs(ms);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, String(ms));
    }
    const label = REFRESH_OPTIONS.find((o) => o.value === ms)?.label ?? `${ms}ms`;
    toast.success(ms === 0 ? "Auto-refresh off" : `Auto-refresh every ${label}`);
  };

  const { data: pins = [], isLoading, isFetching, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-map-pins"],
    queryFn: () => listFn(),
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    refetchIntervalInBackground: false,
  });
  const errorMessage = isError ? (error instanceof Error ? error.message : "Unknown error") : null;

  const handleRefresh = async () => {
    const before = pins.length;
    const res = await refetch();
    if (res.error) {
      toast.error(res.error instanceof Error ? res.error.message : "Failed to refresh");
      return;
    }
    qc.invalidateQueries({ queryKey: ["map-pins"] });
    qc.invalidateQueries({ queryKey: ["dashboard-map-pins"] });
    const after = res.data?.length ?? before;
    const diff = after - before;
    toast.success(
      diff === 0
        ? `Refreshed · ${after} pin${after === 1 ? "" : "s"}`
        : diff > 0
          ? `Refreshed · ${diff} new pin${diff === 1 ? "" : "s"}`
          : `Refreshed · ${Math.abs(diff)} pin${Math.abs(diff) === 1 ? "" : "s"} removed`,
    );
  };

  // URL-persisted search + status filter.
  const { q, state } = Route.useSearch();
  const navigate = useNavigate({ from: "/_authenticated/admin/map-pins" });
  const [qInput, setQInput] = useState(q);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput !== q) {
        navigate({ search: (prev: { q: string; state: string }) => ({ ...prev, q: qInput }), replace: true });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [qInput, q, navigate]);
  const setState = (next: string) =>
    navigate({ search: (prev: { q: string; state: string }) => ({ ...prev, state: next }), replace: true });

  const stateFilter: "all" | "described" | "missing_desc" | "featured" =
    state === "described" || state === "missing_desc" || state === "featured" ? state : "all";

  // Local order state; syncs from server data but allows optimistic drag reorder.
  const [order, setOrder] = useState<MapPin[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MapPin | null>(null);
  const [selectedPin, setSelectedPin] = useState<MapPin | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  useEffect(() => {
    setOrder(pins);
    setSelectedPin((cur) => (cur ? pins.find((p) => p.id === cur.id) ?? null : null));
  }, [pins]);

  const filtered = useMemo(() => {
    const needle = qInput.trim().toLowerCase();
    return order.filter((p) => {
      if (stateFilter === "described" && !(p.description && p.description.trim())) return false;
      if (stateFilter === "missing_desc" && p.description && p.description.trim()) return false;
      if (stateFilter === "featured" && p.sort_order !== 0) return false;
      if (!needle) return true;
      const hay = `${p.title} ${p.description ?? ""} ${p.latitude} ${p.longitude}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [order, qInput, stateFilter]);

  const filterEnabled = !qInput.trim() && stateFilter === "all";

  type ReorderVars = { ids: string[]; prevIds: string[]; prevOrder: MapPin[]; isUndo: boolean };
  const reorder = useMutation({
    mutationFn: (vars: ReorderVars) => reorderFn({ data: { ids: vars.ids } }),
    onSuccess: (_data, vars) => {
      invalidate();
      const sameAsBefore =
        vars.prevIds.length === vars.ids.length &&
        vars.prevIds.every((id, i) => id === vars.ids[i]);
      if (sameAsBefore) {
        toast.success("Order saved");
        return;
      }
      // Detect a simple 1-step move for a friendlier description.
      const changedIdx = vars.ids.findIndex((id, i) => id !== vars.prevIds[i]);
      const moved =
        changedIdx >= 0 ? vars.prevOrder.find((p) => p.id === vars.ids[changedIdx]) : null;
      const description = moved
        ? `"${moved.title}" is now #${changedIdx + 1}`
        : `${vars.ids.length} pin${vars.ids.length === 1 ? "" : "s"} reordered`;

      if (vars.isUndo) {
        toast.success("Reorder undone", { description });
        return;
      }
      toast.success("Order saved", {
        description,
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            setOrder(vars.prevOrder);
            reorder.mutate({
              ids: vars.prevIds,
              prevIds: vars.ids,
              prevOrder: [...vars.prevOrder],
              isUndo: true,
            });
          },
        },
      });
    },
    onError: (e: unknown, vars) => {
      toast.error(e instanceof Error ? e.message : "Failed to save order");
      setOrder(vars?.prevOrder ?? pins);
    },
  });

  const dragEnabled = filterEnabled && !reorder.isPending;



  const runReorder = (nextOrder: MapPin[]) => {
    const prevOrder = order;
    setOrder(nextOrder);
    reorder.mutate({
      ids: nextOrder.map((p) => p.id),
      prevIds: prevOrder.map((p) => p.id),
      prevOrder,
      isUndo: false,
    });
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = order.findIndex((p) => p.id === dragId);
    const to = order.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    runReorder(next);
  };

  const moveByStep = (id: string, delta: -1 | 1) => {
    const from = order.findIndex((p) => p.id === id);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    runReorder(next);
  };

  const exportCsv = () => {
    if (order.length === 0) {
      toast.error("No pins to export");
      return;
    }
    const headers = [
      "sort_order",
      "position",
      "id",
      "title",
      "description",
      "latitude",
      "longitude",
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = order.map((p, i) =>
      [p.sort_order, i + 1, p.id, p.title, p.description ?? "", p.latitude, p.longitude]
        .map(escape)
        .join(","),
    );
    // BOM so Excel opens UTF-8 correctly.
    const csv = "\ufeff" + [headers.join(","), ...rows].join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `map-pins-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${order.length} pin${order.length === 1 ? "" : "s"}`);
  };

  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | "_form", string>>>({});
  const editing = Boolean(form.id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-map-pins"] });
    qc.invalidateQueries({ queryKey: ["map-pins"] });
    qc.invalidateQueries({ queryKey: ["dashboard-map-pins"] });
  };

  const validate = (): {
    ok: boolean;
    errs: Partial<Record<keyof FormState | "_form", string>>;
    payload?: {
      title: string;
      description: string | null;
      latitude: number;
      longitude: number;
      sort_order: number;
    };
  } => {
    const errs: Partial<Record<keyof FormState | "_form", string>> = {};
    const title = form.title.trim();
    const description = form.description.trim();

    if (!title) errs.title = "Title is required";
    else if (title.length > 120) errs.title = "Keep title under 120 characters";
    if (description.length > 500) errs.description = "Keep description under 500 characters";

    const latRaw = form.latitude.trim();
    const lngRaw = form.longitude.trim();
    const numRe = /^-?\d+(\.\d+)?$/;
    const latitude = Number(latRaw);
    const longitude = Number(lngRaw);

    if (!latRaw) errs.latitude = "Latitude is required";
    else if (!numRe.test(latRaw) || Number.isNaN(latitude)) errs.latitude = "Must be a decimal number (e.g. -33.8688)";
    else if (latitude < -90 || latitude > 90) errs.latitude = "Must be between -90 and 90";

    if (!lngRaw) errs.longitude = "Longitude is required";
    else if (!numRe.test(lngRaw) || Number.isNaN(longitude)) errs.longitude = "Must be a decimal number (e.g. 151.2093)";
    else if (longitude < -180 || longitude > 180) errs.longitude = "Must be between -180 and 180";

    const sortRaw = form.sort_order.trim();
    const sortOrder = sortRaw === "" ? 0 : Number(sortRaw);
    if (sortRaw !== "" && (Number.isNaN(sortOrder) || !Number.isInteger(sortOrder))) {
      errs.sort_order = "Must be a whole number";
    }

    if (!errs.latitude && !errs.longitude) {
      const dupCoord = pins.find(
        (p) =>
          p.id !== form.id &&
          Math.abs(p.latitude - latitude) < 1e-5 &&
          Math.abs(p.longitude - longitude) < 1e-5,
      );
      if (dupCoord) {
        errs._form = `A pin already exists at these coordinates: "${dupCoord.title}"`;
      }
    }
    if (!errs.title) {
      const dupTitle = pins.find(
        (p) => p.id !== form.id && p.title.trim().toLowerCase() === title.toLowerCase(),
      );
      if (dupTitle) errs.title = `A pin titled "${dupTitle.title}" already exists`;
    }

    if (Object.keys(errs).length > 0) return { ok: false, errs };
    return {
      ok: true,
      errs,
      payload: {
        title,
        description: description || null,
        latitude,
        longitude,
        sort_order: sortOrder || 0,
      },
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const result = validate();
      setErrors(result.errs);
      if (!result.ok || !result.payload) {
        throw new Error(result.errs._form ?? "Please fix the highlighted fields");
      }
      if (form.id) {
        return updateFn({ data: { id: form.id, ...result.payload } });
      }
      return createFn({ data: result.payload });
    },
    onSuccess: () => {
      toast.success(editing ? "Pin updated" : "Pin added");
      setForm(empty);
      setErrors({});
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Pin removed");
      if (form.id) setForm(empty);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to remove"),
  });

  const startEdit = (pin: MapPin) => {
    setErrors({});
    setForm({
      id: pin.id,
      title: pin.title,
      description: pin.description ?? "",
      latitude: String(pin.latitude),
      longitude: String(pin.longitude),
      sort_order: String(pin.sort_order),
    });
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => {
      if (!prev[key] && !prev._form) return prev;
      const next = { ...prev };
      delete next[key];
      delete next._form;
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-1 font-display text-3xl font-bold">Map pins</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Places pinned on the homepage map. Anyone can see these.
          </p>
        </div>
        <Link to="/account" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="rounded-2xl border border-border/60 bg-card/40 p-5 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold">
            {editing ? "Edit pin" : "Add pin"}
          </h2>

          {errors._form && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive">
              {errors._form}
            </div>
          )}

          <Field label="Title" error={errors.title}>
            <input
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              aria-invalid={!!errors.title}
              className={fieldCls(!!errors.title)}
            />
          </Field>

          <Field label="Description" error={errors.description}>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              aria-invalid={!!errors.description}
              className={fieldCls(!!errors.description)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" error={errors.latitude}>
              <input
                inputMode="decimal"
                placeholder="-33.8688"
                value={form.latitude}
                onChange={(e) => updateField("latitude", e.target.value)}
                aria-invalid={!!errors.latitude}
                className={fieldCls(!!errors.latitude)}
              />
            </Field>
            <Field label="Longitude" error={errors.longitude}>
              <input
                inputMode="decimal"
                placeholder="151.2093"
                value={form.longitude}
                onChange={(e) => updateField("longitude", e.target.value)}
                aria-invalid={!!errors.longitude}
                className={fieldCls(!!errors.longitude)}
              />
            </Field>
          </div>

          <PinPickerMap
            latitude={(() => {
              const n = Number(form.latitude);
              return form.latitude.trim() && !Number.isNaN(n) && n >= -90 && n <= 90 ? n : null;
            })()}
            longitude={(() => {
              const n = Number(form.longitude);
              return form.longitude.trim() && !Number.isNaN(n) && n >= -180 && n <= 180 ? n : null;
            })()}
            onChange={(lat, lng) => {
              setForm((f) => ({
                ...f,
                latitude: lat.toFixed(6),
                longitude: lng.toFixed(6),
              }));
              setErrors((prev) => {
                if (!prev.latitude && !prev.longitude && !prev._form) return prev;
                const next = { ...prev };
                delete next.latitude;
                delete next.longitude;
                delete next._form;
                return next;
              });
            }}
          />

          <Field label="Sort order" error={errors.sort_order}>
            <input
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => updateField("sort_order", e.target.value)}
              aria-invalid={!!errors.sort_order}
              className={fieldCls(!!errors.sort_order)}
            />
          </Field>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {editing ? "Save changes" : "Add pin"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setForm(empty);
                  setErrors({});
                }}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: copy coordinates from Google Maps by right-clicking a location.
          </p>
        </form>

        <div>
          <div className="relative">
            <MapPinsMap
              pins={filtered}
              className="h-[380px] w-full"
              selectedPinId={selectedPin?.id ?? null}
              onPinClick={(p) => setSelectedPin(p)}
            />
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isFetching}
                aria-label="Refresh pins"
                title={
                  dataUpdatedAt
                    ? `Refresh pins · updated ${new Date(dataUpdatedAt).toLocaleTimeString()}`
                    : "Refresh pins"
                }
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/85 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-background disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                {isFetching ? "Refreshing…" : "Refresh"}
              </button>
              <label className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
                <span className="text-muted-foreground">Auto</span>
                <select
                  value={refreshIntervalMs}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  aria-label="Auto-refresh interval"
                  className="bg-transparent text-xs focus:outline-none"
                >
                  {REFRESH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {dataUpdatedAt && !isFetching && (
                <span className="pointer-events-auto rounded-md bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
                  Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            {isLoading && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-4 py-2 text-xs font-medium text-foreground shadow-sm">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                  Loading venue spots…
                </div>
              </div>
            )}

            {errorMessage && !isLoading && (
              <div className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive shadow-lg backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">Couldn't load venue spots</div>
                    <div className="mt-0.5 truncate text-destructive/90" title={errorMessage}>
                      {errorMessage}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={isFetching}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-destructive/60 bg-background px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                    {isFetching ? "Retrying…" : "Retry"}
                  </button>
                </div>
              </div>
            )}
          </div>
          {selectedPin && (
            <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Selected pin</div>
                  <h3 className="mt-0.5 truncate font-display text-base font-semibold">{selectedPin.title}</h3>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {selectedPin.latitude.toFixed(5)}, {selectedPin.longitude.toFixed(5)}
                    <span className="mx-1.5">·</span>
                    Order {selectedPin.sort_order}
                  </p>
                  {selectedPin.description ? (
                    <p className="mt-2 text-sm text-foreground/90">{selectedPin.description}</p>
                  ) : (
                    <p className="mt-2 text-sm italic text-muted-foreground">No description</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPin(null)}
                  aria-label="Close pin details"
                  className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    startEdit(selectedPin);
                    setSelectedPin(null);
                  }}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDelete(selectedPin);
                  }}
                  className="rounded-md border border-destructive/60 px-3 py-1.5 text-xs text-destructive"
                >
                  Delete
                </button>
                <a
                  href={`https://www.google.com/maps?q=${selectedPin.latitude},${selectedPin.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Google Maps ↗
                </a>
              </div>
            </div>
          )}
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">
                {isLoading
                  ? "Loading…"
                  : `${filtered.length} of ${order.length} pin${order.length === 1 ? "" : "s"}`}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={order.length === 0}
                  title="Download all pins as CSV in the current order"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
                <p className="text-xs text-muted-foreground">
                  {reorder.isPending
                    ? "Saving new order… drag disabled."
                    : dragEnabled
                    ? "Drag the handle or tap ▲/▼ to reorder."
                    : "Clear search & filter to reorder."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder="Search title, description, coords…"
                  className="w-full rounded-md border border-border bg-background/60 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {qInput && (
                  <button
                    type="button"
                    onClick={() => setQInput("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <select
                value={stateFilter}
                onChange={(e) => setState(e.target.value)}
                className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">All pins</option>
                <option value="featured">Featured (top order)</option>
                <option value="described">With description</option>
                <option value="missing_desc">Missing description</option>
              </select>
              {(qInput || stateFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setQInput("");
                    setState("all");
                  }}
                  className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              )}
            </div>

            <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40">
              {filtered.map((p) => {
                const idx = order.findIndex((o) => o.id === p.id);
                const isFirst = idx === 0;
                const isLast = idx === order.length - 1;
                return (
                  <li
                    key={p.id}
                    onDragOver={(e) => {
                      if (!dragEnabled) return;
                      e.preventDefault();
                      if (overId !== p.id) setOverId(p.id);
                    }}
                    onDragLeave={() => {
                      if (overId === p.id) setOverId(null);
                    }}
                    onDrop={(e) => {
                      if (!dragEnabled) return;
                      e.preventDefault();
                      handleDrop(p.id);
                    }}
                    className={`flex items-center justify-between gap-2 p-3 transition sm:gap-3 ${
                      dragId === p.id ? "opacity-50" : ""
                    } ${overId === p.id && dragId && dragId !== p.id ? "bg-primary/10" : ""}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <button
                        type="button"
                        draggable={dragEnabled}
                        onDragStart={(e) => {
                          if (!dragEnabled) {
                            e.preventDefault();
                            return;
                          }
                          setDragId(p.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", p.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        aria-label={dragEnabled ? `Drag ${p.title} to reorder` : "Reorder disabled while filtering"}
                        disabled={!dragEnabled}
                        style={{ touchAction: "none" }}
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground ${
                          dragEnabled
                            ? "cursor-grab select-none hover:bg-muted/40 active:cursor-grabbing active:bg-primary/10 sm:h-9 sm:w-9"
                            : "cursor-not-allowed opacity-40"
                        }`}
                      >
                        <GripVertical className="h-5 w-5 sm:h-4 sm:w-4" />
                      </button>
                      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {idx + 1}.
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                          {p.description ? ` · ${p.description}` : " · no description"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <div className="flex flex-col overflow-hidden rounded-md border border-border">
                        <button
                          type="button"
                          onClick={() => moveByStep(p.id, -1)}
                          disabled={!dragEnabled || isFirst || reorder.isPending}
                          aria-label={`Move ${p.title} up`}
                          className="flex h-6 w-9 items-center justify-center text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-30 sm:w-8"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveByStep(p.id, 1)}
                          disabled={!dragEnabled || isLast || reorder.isPending}
                          aria-label={`Move ${p.title} down`}
                          className="flex h-6 w-9 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-30 sm:w-8"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => startEdit(p)}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs sm:px-3 sm:py-1"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPendingDelete(p)}
                        className="rounded-md border border-destructive/60 px-2.5 py-1.5 text-xs text-destructive sm:px-3 sm:py-1"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && !isLoading && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  {order.length === 0 ? "No pins yet. Add your first one." : "No pins match this search / filter."}
                </li>
              )}
            </ul>
            {reorder.isPending && (
              <p className="text-xs text-muted-foreground">Saving new order…</p>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this venue spot?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.title}" will be permanently removed from the map. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                remove.mutate(pendingDelete.id, {
                  onSettled: () => setPendingDelete(null),
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? "Removing…" : "Remove pin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const baseInputCls =
  "w-full rounded-md border bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2";
const fieldCls = (hasError: boolean) =>
  `${baseInputCls} ${
    hasError
      ? "border-destructive focus:ring-destructive/50"
      : "border-border focus:ring-primary/50"
  }`;

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}
