import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Renders a mandatory "I agree to Terms & Privacy" checkbox that must be
 * ticked before `children` (the actual Stripe checkout UI) is mounted.
 * Applies uniformly to every checkout flow that goes through
 * `useStripeCheckout`.
 */
export function TermsAgreementGate({ children }: { children: ReactNode }) {
  const [agreed, setAgreed] = useState(false);

  if (agreed) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-[var(--shadow-panel)]">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Before you pay</div>
      <h2 className="mt-2 font-display text-xl font-semibold">Confirm agreement</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Review and agree to our terms to continue to secure payment.
      </p>

      <label className="mt-5 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 h-4 w-4 accent-primary"
          aria-describedby="terms-agreement-desc"
        />
        <span id="terms-agreement-desc">
          I agree to the{" "}
          <Link to="/terms" target="_blank" className="text-primary underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" target="_blank" className="text-primary underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <button
        type="button"
        disabled={!agreed}
        onClick={() => setAgreed(true)}
        className="mt-6 w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue to payment
      </button>
    </div>
  );
}
