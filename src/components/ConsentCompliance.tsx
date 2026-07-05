import { Link } from "@tanstack/react-router";

type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
};

/**
 * ConsentCompliance — user must tick this to acknowledge they've read the
 * Code of Conduct and Privacy Policy before finalizing an RSVP.
 *
 * Links open the /legal page in a new tab so the RSVP form state is not lost.
 */
export function ConsentCompliance({ checked, onChange, className }: Props) {
  return (
    <div
      className={
        "rounded-lg border p-3 transition " +
        (checked
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-primary/40 bg-primary/5 ") +
        (className ? ` ${className}` : "")
      }
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-primary">
        Consent &amp; Compliance
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
          aria-describedby="consent-compliance-desc"
        />
        <span id="consent-compliance-desc">
          I have read and agree to the{" "}
          <Link
            to="/legal"
            hash="code-of-conduct"
            target="_blank"
            rel="noopener"
            className="text-primary underline underline-offset-2 hover:text-neon"
          >
            Code of Conduct
          </Link>{" "}
          and the{" "}
          <Link
            to="/legal"
            hash="privacy-policy"
            target="_blank"
            rel="noopener"
            className="text-primary underline underline-offset-2 hover:text-neon"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {!checked && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Required — you must accept both before your RSVP can be finalized.
        </p>
      )}
    </div>
  );
}
