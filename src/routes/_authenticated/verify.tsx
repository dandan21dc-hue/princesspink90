import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyAgeVerification,
  submitAgeVerification,
} from "@/lib/verification.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/verify")({
  head: () => ({ meta: [{ title: "Age verification · AFTERDARK" }] }),
  component: VerifyPage,
});

function VerifyPage() {
  const getFn = useServerFn(getMyAgeVerification);
  const submitFn = useServerFn(submitAgeVerification);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-age-verification"], queryFn: () => getFn() });

  const [dob, setDob] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please upload a photo of your ID.");
      if (file.size > 8 * 1024 * 1024) throw new Error("Max file size is 8 MB.");
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
        throw new Error("Upload a JPG, PNG, or WEBP image.");
      }
      setUploading(true);
      try {
        const { data: session } = await supabase.auth.getUser();
        const uid = session.user!.id;
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${uid}/id-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("id-verifications")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;
        await submitFn({ data: { date_of_birth: dob, id_file_path: path } });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      toast.success("ID submitted — we'll review it shortly.");
      qc.invalidateQueries({ queryKey: ["my-age-verification"] });
      setFile(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const status = q.data?.status;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Access</div>
          <h1 className="mt-2 font-display text-3xl font-bold">Age verification</h1>
        </div>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Every event is 18+ only. Upload a photo of a government ID so we can confirm your age.
        Your ID is stored privately and only visible to Princess Pink and the door team.
      </p>

      {q.isLoading ? (
        <div className="mt-6 h-20 animate-pulse rounded-2xl bg-card" />
      ) : status ? (
        <StatusCard status={status} notes={q.data?.notes ?? null} submittedAt={q.data?.submitted_at ?? null} />
      ) : null}

      {status !== "approved" && (
        <form
          className="mt-8 space-y-5 rounded-2xl border border-border/60 bg-card/40 p-6"
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-primary-foreground"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              JPG/PNG/WEBP, max 8 MB. Cover any long-form ID numbers with your thumb — we only need name, DOB, and photo.
            </div>
          </label>
          <button
            type="submit"
            disabled={submit.isPending || uploading}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
          >
            {uploading || submit.isPending ? "Uploading…" : status === "rejected" ? "Resubmit" : "Submit for review"}
          </button>
        </form>
      )}
    </main>
  );
}

function StatusCard({
  status,
  notes,
  submittedAt,
}: {
  status: string;
  notes: string | null;
  submittedAt: string | null;
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
      body: notes || "Please upload a clearer photo showing your name, DOB, and photo.",
    },
  };
  const info = map[status] ?? map.pending;
  return (
    <div className={`mt-6 rounded-2xl border p-5 ${info.color}`}>
      <div className="text-xs uppercase tracking-widest">{info.title}</div>
      <p className="mt-2 text-sm text-foreground/90">{info.body}</p>
      {submittedAt && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Submitted {new Date(submittedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
