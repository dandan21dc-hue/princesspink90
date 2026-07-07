import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMyRoles } from "@/lib/admin.functions";

type AppRole = "admin" | "co_host" | "moderator" | "user";

interface RoleGuardProps {
  allowedRoles: AppRole[];
  children: React.ReactNode;
  redirectTo?: string;
  message?: string;
}

/**
 * Wraps a protected surface and restricts it to users holding one of
 * `allowedRoles`. Reads roles from the `user_roles` table via the
 * `getMyRoles` server fn (RLS + has_role, no roles on profiles).
 */
export function RoleGuard({
  allowedRoles,
  children,
  redirectTo = "/",
  message = "Access restricted",
}: RoleGuardProps) {
  const navigate = useNavigate();
  const fetchRoles = useServerFn(getMyRoles);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-roles"],
    queryFn: () => fetchRoles(),
    staleTime: 60_000,
  });

  const allowed = !!data && data.roles.some((r) => (allowedRoles as string[]).includes(r));

  useEffect(() => {
    if (isLoading) return;
    if (isError || !allowed) {
      toast.error(message);
      navigate({ to: redirectTo });
    }
  }, [isLoading, isError, allowed, navigate, redirectTo, message]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-24 text-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
