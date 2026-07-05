import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyHealthScreenings,
  submitHealthScreening,
  deleteMyPendingScreening,
  getMyScreeningSignedUrl,
  isScreeningCurrent,
  SCREENING_VALIDITY_DAYS,
  type HealthScreening,
} from "@/lib/health.functions";
import { toast } from "sonner";

export function HealthScreeningSection() {
  const listFn = useServerFn(listMyHealthScreenings);
  const submitFn = useServerFn(submitHealthScreening);
  const deleteFn = useServerFn(deleteMyPendingScreening);
  const viewFn = useServerFn(getMyScreeningSignedUrl);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["my-health-screenings"], queryFn: () => listFn() });
  const rows = q.data ?? [];
  const current = isScreeningCurrent(rows);

  const [file, setFile] = useState<File | null>(null);
  const [testDate, setTestDate] = useState("");
  const [uploading, setUploading] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Please attach your screening document.");
      if (!testDate) throw new Error("Enter the date the test was taken.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Max file size is 10 MB.");
      if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(file.type)) {
        throw new Error("Upload a JPG, PNG, WEBP, or PDF.");
      }
      setUploading(true);
      try {
        const { data: session } = await supabase.auth.getUser();
        const uid = session.user!.id;
        const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
        const path = `${uid}/screening-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("health-screenings")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        await submitFn({ data: { file_path: path, test_date: testDate } });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: () => {
      toast.success("Screening submitted — we'll review it shortly.");
      qc.invalidateQueries({ queryKey: ["my-health-screenings"] });
      setFile(null);
      setTestDate("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Removed.");
      qc.invalidateQueries({ queryKey: ["my-health-screenings"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const view = async (path: string) => {
    try {
      const { url } = await viewFn({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="mt-8 space-y-5 rounded-2xl border border-border/60 bg-card/40 p-6">
      <header>
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Health screening</div>
        <h2 className="mt-2 font-display text-2xl font-bold">STD screening</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every guest must have a negative STD screening from within the last{" "}
          {SCREENING_VALIDITY_DAYS} days on file. Uploads are stored privately and only visible
          to the medical-review team.
        </p>
      </header>

      <StatusPill current={current} rows={rows} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
        className="space-y-4"
      >
        <label className="block">
          <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
            Test date
          </div>
          <input
            type="date"
            required
            value={testDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setTestDate(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
            Screening document
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-primary-foreground"
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            PDF or image, max 10 MB. Redact insurance/social security numbers — we only need the
            panel, results, and the date.
          </div>
        </label>
        <button
          type="submit"
          disabled={submit.isPending || uploading}
          className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {uploading || submit.isPending ? "Uploading…" : "Submit screening"}
        </button>
      </form>

      <div>
        <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          History
        </div>
        {q.isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r) => (
              <ScreeningRow
                key={r.id}
                row={r}
                onView={() => view(r.file_path)}
                onDelete={() => remove.mutate(r.id)}
                deleting={remove.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusPill({ current, rows }: { current: boolean; rows: HealthScreening[] }) {
  const pending = rows.find((r) => r.status === "pending");
  if (current) {
    const validUntil = rows
      .filter((r) => r.status === "approved" && r.valid_until)
      .map((r) => r.valid_until!)
      .sort()
      .pop();
    return (
      <div className="rounded-lg border border-neon/50 bg-neon/10 p-3 text-xs uppercase tracking-widest text-neon">
        Cleared — valid until {validUntil}
      </div>
    );
  }
  if (pending) {
    return (
      <div className="rounded-lg border border-primary/50 bg-primary/10 p-3 text-xs uppercase tracking-widest text-primary">
        Awaiting admin review
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs uppercase tracking-widest text-destructive">
      No current screening on file
    </div>
  );
}

function ScreeningRow({
  row,
  onView,
  onDelete,
  deleting,
}: {
  row: HealthScreening;
  onView: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const meta: Record<HealthScreening["status"], string> = {
    approved: "border-neon/50 bg-neon/10 text-neon",
    pending: "border-primary/50 bg-primary/10 text-primary",
    rejected: "border-destructive/60 bg-destructive/10 text-destructive",
  };
  const label: Record<HealthScreening["status"], string> = {
    approved: "Approved",
    pending: "Admin review",
    rejected: "Rejected",
  };
  return (
    <li className="flex items-start justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${meta[row.status]}`}
          >
            {label[row.status]}
          </span>
          <span className="text-xs text-muted-foreground">Test {row.test_date}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Uploaded {new Date(row.submitted_at).toLocaleDateString()}
          {row.valid_until && ` · Valid until ${row.valid_until}`}
        </div>
        {row.notes && <div className="mt-1 text-[11px] italic text-muted-foreground">“{row.notes}”</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onView}
          className="rounded-md border border-border px-2.5 py-1 text-[10px] uppercase tracking-widest hover:bg-accent"
        >
          View
        </button>
        {row.status === "pending" && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="rounded-md border border-destructive/60 px-2.5 py-1 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
