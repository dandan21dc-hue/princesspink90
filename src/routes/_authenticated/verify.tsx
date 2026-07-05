import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyAgeVerification,
  submitAgeVerification,
  updateAdultContentRelease,
  ADULT_CONTENT_RELEASE_VERSION,
} from "@/lib/verification.functions";
import { SelfieWithIdCapture } from "@/components/SelfieWithIdCapture";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/verify")({
  head: () => ({ meta: [{ title: "Age verification · AFTERDARK" }] }),
  component: VerifyPage,
});

const RELEASE_COPY = `I confirm I am 18 or older, and I grant Princess Pink and AFTERDARK a non-exclusive, worldwide, royalty-free right to record my likeness at events I attend and to reproduce, edit, distribute, and display those recordings — including as adult-oriented content — across their platforms and marketing channels. I understand recordings already published cannot be recalled, and that I can revoke this release for future recordings at any time from this page. I confirm no compensation has been promised for this release.`;

// PLACEHOLDER — REVIEW WITH COUNSEL BEFORE GOING LIVE.
// Real production copy must be prepared by a lawyer and match the jurisdictions
// you operate in (e.g. 18 U.S.C. §2257 record-keeping in the United States).

function VerifyPage() {
  const getFn = useServerFn(getMyAgeVerification);
  const submitFn = useServerFn(submitAgeVerification);
  const releaseFn = useServerFn(updateAdultContentRelease);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-age-verification"], queryFn: () => getFn() });

  const [dob, setDob] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [adultRelease, setAdultRelease] = useState(false);
  const [releaseAck, setReleaseAck] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Preload the release toggle from server state.
  useEffect(() => {
    if (q.data?.adult_content_release) {
      setAdultRelease(true);
      setReleaseAck(true);
    }
  }, [q.data?.adult_content_release]);

  const status = q.data?.status;
  const alreadyApproved = status === "approved";

  const uploadTo = async (uid: string, prefix: string, f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${uid}/${prefix}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("id-verifications")
      .upload(path, f, { upsert: true, contentType: f.type });
    if (error) throw error;
    return path;
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!idFile) throw new Error("Please upload a photo of your ID.");
      if (!selfieFile) throw new Error("Please add the selfie holding your ID.");
      if (adultRelease && !releaseAck) {
        throw new Error("Tick the release checkbox to confirm you agree.");
      }
      for (const f of [idFile, selfieFile]) {
        if (f.size > 8 * 1024 * 1024) throw new Error("Each photo must be under 8 MB.");
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)) {
          throw new Error("Photos must be JPG, PNG, or WEBP.");
        }
      }
      setUploading(true);
      try {
        const { data: session } = await supabase.auth.getUser();
        const uid = session.user!.id;
        const [idPath, selfiePath] = await Promise.all([
          uploadTo(uid, "id", idFile),
          uploadTo(uid, "selfie", selfieFile),
        ]);
        await submitFn({
          data: {
            date_of_birth: dob,
            id_file_path: idPath,
            selfie_file_path: selfiePath,
            adult_content_release: adultRelease,
            adult_content_release_version: adultRelease
              ? ADULT_CONTENT_RELEASE_VERSION
              : undefined,
          },
        });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      toast.success("Submitted — we'll review your photos shortly.");
      qc.invalidateQueries({ queryKey: ["my-age-verification"] });
      setIdFile(null);
      setSelfieFile(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // For already-approved guests: just toggle the adult-content release without re-review.
  const toggleRelease = useMutation({
    mutationFn: async (agreed: boolean) => {
      if (agreed && !releaseAck) throw new Error("Confirm the release checkbox first.");
      await releaseFn({
        data: { agreed, version: agreed ? ADULT_CONTENT_RELEASE_VERSION : undefined },
      });
    },
    onSuccess: (_r, agreed) => {
      toast.success(agreed ? "Release recorded." : "Release revoked for future recordings.");
      qc.invalidateQueries({ queryKey: ["my-age-verification"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Access</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Age verification</h1>
        </div>
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Every event is 18+ only. Upload a photo of a government ID and a selfie of yourself
        holding that ID next to your face. Both photos are stored privately and only visible
        to Princess Pink and the door team.
      </p>

      {q.isLoading ? (
        <div className="mt-6 h-20 animate-pulse rounded-2xl bg-card" />
      ) : status ? (
        <StatusCard
          status={status}
          notes={q.data?.notes ?? null}
          submittedAt={q.data?.submitted_at ?? null}
          release={!!q.data?.adult_content_release}
          releaseAt={q.data?.adult_content_release_at ?? null}
        />
      ) : null}

      {!alreadyApproved && (
        <form
          className="mt-8 space-y-6 rounded-2xl border border-border/60 bg-card/40 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <label className="block">
            <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
              Date of birth
            </div>
            <input
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
              Photo of government ID
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              required
              onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-primary-foreground"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              JPG/PNG/WEBP, max 8 MB. Cover any long-form ID numbers with your thumb — we only need
              name, DOB, and photo.
            </div>
          </label>

          <div className="block">
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
              Selfie holding your ID
            </div>
            <SelfieWithIdCapture
              file={selfieFile}
              onCapture={setSelfieFile}
              onClear={() => setSelfieFile(null)}
            />
            <div className="mt-2 text-[11px] text-muted-foreground">
              Hold the ID close to your face so both are clearly visible in the same shot. Max 8 MB.
            </div>
          </div>

          <ReleaseSection
            adultRelease={adultRelease}
            setAdultRelease={setAdultRelease}
            releaseAck={releaseAck}
            setReleaseAck={setReleaseAck}
          />

          <button
            type="submit"
            disabled={submit.isPending || uploading}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
          >
            {uploading || submit.isPending
              ? "Uploading…"
              : status === "rejected"
                ? "Resubmit"
                : "Submit for review"}
          </button>
        </form>
      )}

      {alreadyApproved && (
        <section className="mt-8 space-y-4 rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="text-xs uppercase tracking-widest text-primary">
            Adult-content release
          </div>
          <ReleaseSection
            adultRelease={adultRelease}
            setAdultRelease={setAdultRelease}
            releaseAck={releaseAck}
            setReleaseAck={setReleaseAck}
          />
          <button
            type="button"
            onClick={() => toggleRelease.mutate(adultRelease)}
            disabled={toggleRelease.isPending}
            className="w-full rounded-md bg-primary py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
          >
            {toggleRelease.isPending
              ? "Saving…"
              : adultRelease
                ? "Save release"
                : "Revoke release"}
          </button>
        </section>
      )}
    </main>
  );
}

function ReleaseSection({
  adultRelease,
  setAdultRelease,
  releaseAck,
  setReleaseAck,
}: {
  adultRelease: boolean;
  setAdultRelease: (v: boolean) => void;
  releaseAck: boolean;
  setReleaseAck: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={adultRelease}
          onChange={(e) => {
            setAdultRelease(e.target.checked);
            if (!e.target.checked) setReleaseAck(false);
          }}
          className="mt-1"
        />
        <span>
          I want to opt in to being recorded at events, and I consent to my session being used as
          adult content across Princess Pink&apos;s platforms.
        </span>
      </label>

      {adultRelease && (
        <>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="mb-2 font-semibold uppercase tracking-widest text-destructive">
              Draft release — review with counsel before going live
            </p>
            <p>{RELEASE_COPY}</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={releaseAck}
              onChange={(e) => setReleaseAck(e.target.checked)}
              className="mt-1"
            />
            <span>
              I have read the release above and I agree to it. I am at least 18 years old.
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function StatusCard({
  status,
  notes,
  submittedAt,
  release,
  releaseAt,
}: {
  status: string;
  notes: string | null;
  submittedAt: string | null;
  release: boolean;
  releaseAt: string | null;
}) {
  const map: Record<string, { color: string; title: string; body: string }> = {
    pending: {
      color: "border-primary/50 bg-primary/10 text-primary",
      title: "Under review",
      body: "We'll email you as soon as your ID is approved. Usually within 24 hours.",
    },
    approved: {
      color: "border-neon/50 bg-neon/10 text-neon",
      title: "Approved ✓",
      body: "You're cleared to RSVP for any event.",
    },
    rejected: {
      color: "border-destructive/60 bg-destructive/10 text-destructive",
      title: "Not accepted",
      body: notes || "Please upload clearer photos showing your name, DOB, and face beside the ID.",
    },
  };
  const info = map[status] ?? map.pending;
  return (
    <div className={`mt-6 space-y-2 rounded-2xl border p-5 ${info.color}`}>
      <div className="text-xs uppercase tracking-widest">{info.title}</div>
      <p className="text-sm text-foreground/90">{info.body}</p>
      {submittedAt && (
        <p className="text-[11px] text-muted-foreground">
          Submitted {new Date(submittedAt).toLocaleString()}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Adult-content release:{" "}
        <span className={release ? "text-neon" : "text-destructive"}>
          {release ? "on file" : "not granted"}
        </span>
        {release && releaseAt && ` · signed ${new Date(releaseAt).toLocaleDateString()}`}
      </p>
    </div>
  );
}
