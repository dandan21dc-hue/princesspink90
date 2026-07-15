import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ShieldAlert, Clock, ShieldX } from "lucide-react";
import { getMyVerificationStatus } from "@/lib/verification.functions";

/**
 * Shortcut card shown on the user profile. Derives its state from the
 * existing age_verifications record — no parallel pipeline.
 */
export function VerificationStatusCard() {
  const fn = useServerFn(getMyVerificationStatus);
  const q = useQuery({ queryKey: ["my-verification-status"], queryFn: () => fn() });

  if (q.isLoading || !q.data) return null;
  const { status, notes } = q.data;

  if (status === "approved") {
    return (
      <section className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
        <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
        <div className="flex-1">
          <div className="font-display text-sm">ID verified</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Store and booking access is unlocked.
          </p>
        </div>
      </section>
    );
  }

  if (status === "pending") {
    return (
      <section className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <Clock className="mt-0.5 h-5 w-5 text-amber-400" />
        <div className="flex-1">
          <div className="font-display text-sm">Verification pending review</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            We're reviewing your ID. You'll be notified once it's approved.
          </p>
        </div>
      </section>
    );
  }

  if (status === "rejected") {
    return (
      <section className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
        <ShieldX className="mt-0.5 h-5 w-5 text-red-400" />
        <div className="flex-1">
          <div className="font-display text-sm">Verification needs attention</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {notes ? notes : "Please re-submit your ID to unlock bookings and the store."}
          </p>
          <Link
            to="/verify"
            className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Re-submit ID
          </Link>
        </div>
      </section>
    );
  }

  // unsubmitted
  return (
    <section className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <ShieldAlert className="mt-0.5 h-5 w-5 text-primary" />
      <div className="flex-1">
        <div className="font-display text-sm">Verify your ID to unlock bookings</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Upload your ID and a selfie to book events, private rooms, and store items.
        </p>
        <Link
          to="/verify"
          className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Start verification
        </Link>
      </div>
    </section>
  );
}
