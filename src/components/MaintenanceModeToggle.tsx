import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { Wrench } from "lucide-react";
import { getMaintenanceMode, setMaintenanceMode } from "@/lib/maintenance.functions";
import { MAINTENANCE_MESSAGE } from "@/lib/useMaintenance";

/**
 * Master maintenance switch for the admin dashboard overview. Flipping this
 * hides upcoming events, disables store checkout, and shows a site-wide
 * banner for every non-admin visitor.
 */
export function MaintenanceModeToggle() {
  const getFn = useServerFn(getMaintenanceMode);
  const setFn = useServerFn(setMaintenanceMode);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["maintenance-mode"],
    queryFn: () => getFn(),
    refetchInterval: 30_000,
  });
  const active = !!q.data?.active;
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !active;
    if (next && !confirm("Turn ON global maintenance mode? Public visitors will lose access to events and checkout until you turn it off.")) {
      return;
    }
    setBusy(true);
    try {
      await setFn({ data: { active: next } });
      qc.invalidateQueries({ queryKey: ["maintenance-mode"] });
      qc.invalidateQueries({ queryKey: ["public-events"] });
      toast.success(next ? "Maintenance mode enabled." : "Maintenance mode disabled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update maintenance mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-xl border p-4 transition ${
        active
          ? "border-amber-500/60 bg-amber-500/10"
          : "border-border/60 bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Wrench className={`mt-0.5 h-5 w-5 ${active ? "text-amber-300" : "text-muted-foreground"}`} />
          <div>
            <div className="font-display text-sm">Enable Global Maintenance</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {active
                ? "The public site is closed. Non-admin visitors see the maintenance banner and can't book or buy."
                : "Master switch to close the public site for upgrades. You keep full access."}
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="Enable global maintenance"
          disabled={busy || q.isLoading}
          onClick={toggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
            active ? "bg-amber-500" : "bg-muted"
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              active ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      {active && (
        <p className="mt-3 rounded border border-amber-400/40 bg-black/20 px-3 py-2 text-[11px] text-amber-100">
          Banner shown to public: “{MAINTENANCE_MESSAGE}”
        </p>
      )}
    </section>
  );
}
