import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMaintenanceMode } from "@/lib/maintenance.functions";
import { amIAdmin } from "@/lib/admin.functions";

/**
 * Client-side hook returning `{ active, isAdmin, gate }`.
 * - `active`: maintenance flag is on
 * - `isAdmin`: current viewer is an admin (they bypass)
 * - `gate`: `active && !isAdmin` — the effective "hide this from public" boolean
 */
export function useMaintenance() {
  const fn = useServerFn(getMaintenanceMode);
  const adminFn = useServerFn(amIAdmin);
  const m = useQuery({
    queryKey: ["maintenance-mode"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const a = useQuery({
    queryKey: ["am-i-admin"],
    queryFn: () => adminFn(),
    staleTime: 60_000,
  });
  const active = !!m.data?.active;
  const isAdmin = !!a.data?.isAdmin;
  return { active, isAdmin, gate: active && !isAdmin, isLoading: m.isLoading };
}

export const MAINTENANCE_MESSAGE =
  "We are currently closed for private maintenance and upgrades. Check back soon.";
