import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getMyVeriffStatus, createVeriffSession, type VeriffStatus } from "@/lib/veriff.functions";
import { HealthScreeningSection } from "@/components/HealthScreeningSection";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/verify")({
  head: () => ({ meta: [{ title: "Identity verification · AFTERDARK" }] }),
  component: VerifyPage,
});

const RECORDING_CONSENT_COPY = `I want to opt in to being recorded at events, and I consent to my session being used as adult content across Midnight Glory's platforms. I confirm I am 18 or older and grant Midnight Glory and AFTERDARK a non-exclusive, worldwide, royalty-free right to record my likeness at events I attend and to reproduce, edit, distribute, and display those recordings — including as adult-oriented content — across their platforms and marketing channels.`;

function VerifyPage() {
  const getFn = useServerFn(getMyVeriffStatus);
  const startFn = useServerFn(createVeriffSession);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-veriff-status"], queryFn: () => getFn() });

  const [recordingConsent, setRecordingConsent] = useState(false);
  const [ageAck, setAgeAck] = useState(false);

  const start = useMutation({
    mutationFn: async () => {
      const res = await startFn({ data: { consents_to_recording: recordingConsent } });
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-veriff-status"] });
      // Send the user to Veriff's hosted flow.
      window.location.href = res.url;
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const status: VeriffStatus = q.data?.status ?? "unverified";
  const isApproved = status === "approved";
  const isPending = status === "pending";
  const canStart = ageAck && !start.isPending && !isApproved;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Access</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Identity verification</h1>
        </div>
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Every event is 18+ only. We verify your ID securely through Veriff — you'll be redirected to
        their hosted flow to scan a government ID (and, if you opt in below, a matching selfie).
        We never see or store your ID photos.
      </p>

      {q.isLoading ? (
        <div className="mt-6 h-20 animate-pulse rounded-2xl bg-card" />
      ) : (
        <StatusCard status={status} />
      )}

      {!isApproved && (
        <section className="mt-8 space-y-6 rounded-2xl border border-border/60 bg-card/40 p-6">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ageAck}
              onChange={(e) => setAgeAck(e.target.checked)}
              className="mt-1"
            />
            <span>
              I confirm I am 18 or older and consent to my ID being verified through Veriff.
            </span>
          </label>

          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={recordingConsent}
                onChange={(e) => setRecordingConsent(e.target.checked)}
                className="mt-1"
              />
              <span>{RECORDING_CONSENT_COPY}</span>
            </label>
            <div className="text-[11px] text-muted-foreground">
              {recordingConsent
                ? "Verification will include a selfie / face match step."
                : "Verification will be document-only (no selfie required)."}
            </div>
          </div>

          <button
            type="button"
            disabled={!canStart}
            onClick={() => start.mutate()}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
          >
            {start.isPending
              ? "Starting Veriff…"
              : isPending
                ? "Continue verification"
                : "Verify Identity Securely"}
          </button>

          {!ageAck && (
            <p className="text-[11px] text-muted-foreground">
              Tick the confirmation above to enable the button.
            </p>
          )}
        </section>
      )}

      <HealthScreeningSection />
    </div>
  );
}

function StatusCard({ status }: { status: VeriffStatus }) {
  const map: Record<VeriffStatus, { color: string; title: string; body: string }> = {
    unverified: {
      color: "border-border bg-card/40 text-muted-foreground",
      title: "Not verified",
      body: "Complete the Veriff flow below to unlock event RSVPs.",
    },
    pending: {
      color: "border-primary/50 bg-primary/10 text-primary",
      title: "Verification pending",
      body: "Veriff is reviewing your submission. You'll be notified as soon as a decision is made.",
    },
    approved: {
      color: "border-neon/50 bg-neon/10 text-neon",
      title: "Approved ✓",
      body: "Your identity is verified. You're cleared to RSVP for any event.",
    },
    declined: {
      color: "border-destructive/60 bg-destructive/10 text-destructive",
      title: "Verification declined",
      body: "Veriff couldn't verify your ID. You can start a new session below.",
    },
  };
  const info = map[status];
  return (
    <div className={`mt-6 space-y-2 rounded-2xl border p-5 ${info.color}`}>
      <div className="text-xs uppercase tracking-widest">{info.title}</div>
      <p className="text-sm text-foreground/90">{info.body}</p>
    </div>
  );
}
