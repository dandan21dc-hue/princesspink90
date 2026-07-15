import { Wrench } from "lucide-react";
import { useMaintenance, MAINTENANCE_MESSAGE } from "@/lib/useMaintenance";

/**
 * Global banner shown at the top of every page while maintenance mode is on.
 * Hidden entirely for admins so they can navigate the app freely.
 */
export function MaintenanceBanner() {
  const { active, isAdmin } = useMaintenance();
  if (!active) return null;
  return (
    <div
      role="status"
      className="w-full border-b border-amber-500/40 bg-amber-500/15 px-4 py-3 text-center text-sm font-medium text-amber-100"
    >
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-2">
        <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{MAINTENANCE_MESSAGE}</span>
        {isAdmin && (
          <span className="ml-2 rounded-full border border-amber-400/60 bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-200">
            Admin bypass
          </span>
        )}
      </div>
    </div>
  );
}
