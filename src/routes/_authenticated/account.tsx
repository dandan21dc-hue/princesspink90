import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getAccountStatus,
  requestAccountDeletion,
  cancelAccountDeletion,
} from "@/lib/account.functions";
import { getStripeEnvironment } from "@/lib/stripe";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountLayout,
});

function AccountLayout() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex gap-4 border-b border-border pb-2 text-sm">
        <Link to="/account" activeOptions={{ exact: true }} activeProps={{ className: "font-semibold text-neon" }}>
          Overview
        </Link>
        <Link to="/account/billing" activeProps={{ className: "font-semibold text-neon" }}>
          Billing
        </Link>
      </div>
      <Outlet />
    </div>
  );
}

export function AccountIndex() {
  const router = useRouter();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getAccountStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchStatus = useServerFn(getAccountStatus);
  const doRequest = useServerFn(requestAccountDeletion);
  const doCancel = useServerFn(cancelAccountDeletion);

  useEffect(() => {
    fetchStatus().then(setStatus).catch(() => setStatus(null));
  }, [fetchStatus]);

  async function onRequestDelete() {
    if (!confirm("Schedule your account for deletion in 30 days? Sign in during that window to undo.")) return;
    setBusy(true);
    const res = await doRequest({ data: { environment: getStripeEnvironment() } });
    setBusy(false);
    if ("error" in res) return toast.error(res.error);
    toast.success("Account scheduled for deletion.");
    router.invalidate();
    fetchStatus().then(setStatus);
  }

  async function onUndo() {
    setBusy(true);
    const res = await doCancel();
    setBusy(false);
    if ("error" in res) return toast.error(res.error);
    toast.success("Deletion cancelled.");
    fetchStatus().then(setStatus);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {status?.display_name ? `Signed in as ${status.display_name}.` : "Manage your access and billing."}
        </p>
      </div>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-lg">Billing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cancel or resume your subscription, update your card, and view invoices.
        </p>
        <button
          onClick={() => navigate({ to: "/account/billing" })}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Open billing
        </button>
      </section>

      <section className="rounded-lg border border-red-500/40 p-5">
        <h2 className="font-display text-lg text-red-400">Delete account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You have a 30-day grace period. Sign in during that time to undo. After 30 days everything is
          permanently deleted — subscriptions cancelled, purchases removed, RSVPs cleared.
        </p>
        {status?.pending_deletion_at ? (
          <div className="mt-4 flex items-center justify-between rounded bg-amber-500/10 px-3 py-2 text-sm">
            <span>
              Scheduled for {new Date(status.pending_deletion_at).toLocaleString()}.
            </span>
            <button
              disabled={busy}
              onClick={onUndo}
              className="rounded bg-amber-500 px-3 py-1 font-semibold text-black disabled:opacity-50"
            >
              Undo deletion
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={onRequestDelete}
            className="mt-4 rounded-md border border-red-500 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          >
            Delete my account
          </button>
        )}
      </section>
    </div>
  );
}
