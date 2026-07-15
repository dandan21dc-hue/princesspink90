import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Plus, Pencil, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listMapPins,
  createMapPin,
  updateMapPin,
  deleteMapPin,
  type MapPin as MapPinRow,
} from "@/lib/map-pins.functions";

type FormState = {
  id?: string;
  title: string;
  description: string;
  latitude: string;
  longitude: string;
  sort_order: string;
};

const emptyForm: FormState = {
  title: "",
  description: "",
  latitude: "",
  longitude: "",
  sort_order: "0",
};

/**
 * Compact "Add venue spot" dialog for the dashboard — lets admins add,
 * update, or delete map pins without leaving the page. Mirrors the logic
 * on /admin/map-pins but omits the map preview to keep the modal light.
 */
export function AddVenuePinDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const editing = Boolean(form.id);

  const qc = useQueryClient();
  const listFn = useServerFn(listMapPins);
  const createFn = useServerFn(createMapPin);
  const updateFn = useServerFn(updateMapPin);
  const deleteFn = useServerFn(deleteMapPin);

  const pinsQuery = useQuery({
    queryKey: ["admin-map-pins"],
    queryFn: () => listFn(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setForm(emptyForm);
  }, [open]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-map-pins"] });
    qc.invalidateQueries({ queryKey: ["map-pins"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const lat = Number(form.latitude);
      const lng = Number(form.longitude);
      if (!form.title.trim()) throw new Error("Title is required");
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error("Latitude and longitude must be numbers");
      }
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        latitude: lat,
        longitude: lng,
        sort_order: Number(form.sort_order) || 0,
      };
      if (form.id) {
        return updateFn({ data: { id: form.id, ...payload } });
      }
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? "Pin updated" : "Pin added");
      setForm(emptyForm);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to save pin"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Pin removed");
      setForm(emptyForm);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to remove pin"),
  });

  const startEdit = (pin: MapPinRow) =>
    setForm({
      id: pin.id,
      title: pin.title,
      description: pin.description ?? "",
      latitude: String(pin.latitude),
      longitude: String(pin.longitude),
      sort_order: String(pin.sort_order),
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={triggerClassName}
        >
          <MapPin className="h-4 w-4 mr-1.5" />
          Add venue spot
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit venue spot" : "Add venue spot"}</DialogTitle>
          <DialogDescription>
            Pins shown on the homepage map. Tip: right-click a location in Google
            Maps to copy its latitude / longitude.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Title
            </label>
            <Input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Sydney warehouse"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Description
            </label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Optional details shown in the pin popup"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
                Latitude
              </label>
              <Input
                required
                inputMode="decimal"
                placeholder="-33.8688"
                value={form.latitude}
                onChange={(e) =>
                  setForm((f) => ({ ...f, latitude: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
                Longitude
              </label>
              <Input
                required
                inputMode="decimal"
                placeholder="151.2093"
                value={form.longitude}
                onChange={(e) =>
                  setForm((f) => ({ ...f, longitude: e.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Sort order
            </label>
            <Input
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) =>
                setForm((f) => ({ ...f, sort_order: e.target.value }))
              }
            />
          </div>

          <DialogFooter className="!justify-between gap-2 pt-1">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setForm(emptyForm)}
              >
                <Plus className="h-4 w-4 mr-1" />
                New pin
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {editing ? "Save changes" : "Add pin"}
              </Button>
            </div>
          </DialogFooter>
        </form>

        <div className="mt-2 border-t border-border/60 pt-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Existing spots
            {pinsQuery.data ? ` · ${pinsQuery.data.length}` : ""}
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {pinsQuery.isLoading && (
              <li className="text-xs text-muted-foreground">Loading…</li>
            )}
            {pinsQuery.data?.length === 0 && !pinsQuery.isLoading && (
              <li className="text-xs text-muted-foreground">
                No pins yet — add your first above.
              </li>
            )}
            {pinsQuery.data?.map((p) => (
              <li
                key={p.id}
                className={`flex items-center justify-between gap-2 rounded-md border border-border/40 px-2 py-1.5 text-xs ${
                  form.id === p.id ? "bg-primary/10 border-primary/40" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => startEdit(p)}
                    aria-label={`Edit ${p.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remove "${p.title}"?`)) remove.mutate(p.id);
                    }}
                    aria-label={`Delete ${p.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
