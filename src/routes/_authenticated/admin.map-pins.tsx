import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import { RoleGuard } from "@/components/RoleGuard";
import {
  listMapPins,
  createMapPin,
  updateMapPin,
  deleteMapPin,
  reorderMapPins,
  type MapPin,
} from "@/lib/map-pins.functions";
import { MapPinsMap } from "@/components/MapPinsMap";

export const Route = createFileRoute("/_authenticated/admin/map-pins")({
  head: () => ({ meta: [{ title: "Map pins · Admin" }] }),
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

  const { data: pins = [], isLoading } = useQuery({
    queryKey: ["admin-map-pins"],
    queryFn: () => listFn(),
  });

  // Local order state; syncs from server data but allows optimistic drag reorder.
  const [order, setOrder] = useState<MapPin[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  useEffect(() => {
    setOrder(pins);
  }, [pins]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderFn({ data: { ids } }),
    onSuccess: () => {
      toast.success("Order saved");
      invalidate();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to save order");
      setOrder(pins);
    },
  });

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
    setOrder(next);
    setDragId(null);
    setOverId(null);
    reorder.mutate(next.map((p) => p.id));
  };

  const [form, setForm] = useState<FormState>(empty);
  const editing = Boolean(form.id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-map-pins"] });
    qc.invalidateQueries({ queryKey: ["map-pins"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        sort_order: Number(form.sort_order) || 0,
      };
      if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
        throw new Error("Latitude and longitude must be numbers");
      }
      if (form.id) {
        return updateFn({ data: { id: form.id, ...payload } });
      }
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? "Pin updated" : "Pin added");
      setForm(empty);
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
    setForm({
      id: pin.id,
      title: pin.title,
      description: pin.description ?? "",
      latitude: String(pin.latitude),
      longitude: String(pin.longitude),
      sort_order: String(pin.sort_order),
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

          <Field label="Title">
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputCls}
            />
          </Field>

          <Field label="Description">
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input
                required
                inputMode="decimal"
                placeholder="-33.8688"
                value={form.latitude}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Longitude">
              <input
                required
                inputMode="decimal"
                placeholder="151.2093"
                value={form.longitude}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Sort order">
            <input
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              className={inputCls}
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
                onClick={() => setForm(empty)}
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
          <MapPinsMap pins={pins} className="h-[380px] w-full" />
          <div className="mt-6 space-y-2">
            <h2 className="font-display text-lg font-semibold">
              {isLoading ? "Loading…" : `${pins.length} pin${pins.length === 1 ? "" : "s"}`}
            </h2>
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40">
              {pins.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                      {p.description ? ` · ${p.description}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => startEdit(p)}
                      className="rounded-md border border-border px-3 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remove "${p.title}"?`)) remove.mutate(p.id);
                      }}
                      className="rounded-md border border-destructive/60 px-3 py-1 text-xs text-destructive"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {pins.length === 0 && !isLoading && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No pins yet. Add your first one.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
