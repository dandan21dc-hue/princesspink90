import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getCohostEligibility,
  getMyCohostApplication,
  submitCohostApplication,
  withdrawMyCohostApplication,
} from "@/lib/cohost.functions";

export const Route = createFileRoute("/_authenticated/cohost-apply")({
  head: () => ({ meta: [{ title: "Co-host application · AFTERDARK" }] }),
  component: CohostApply,
});


const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EVENT_TYPE_OPTIONS = [
  "Private parties",
  "Club nights",
  "Adult theatre",
  "Play parties",
  "Brand collabs",
  "Photo/video shoots",
  "Custom scenes",
  "Travel events",
];

function CohostApply() {
  const eligibilityFn = useServerFn(getCohostEligibility);
  const mineFn = useServerFn(getMyCohostApplication);
  const submitFn = useServerFn(submitCohostApplication);
  const withdrawFn = useServerFn(withdrawMyCohostApplication);
  const qc = useQueryClient();

  const eligibility = useQuery({ queryKey: ["cohost-eligibility"], queryFn: () => eligibilityFn() });
  const mine = useQuery({ queryKey: ["my-cohost-application"], queryFn: () => mineFn() });

  const [form, setForm] = useState({
    display_name: "",
    age: "" as string,
    city: "",
    instagram_handle: "",
    other_socials: "",
    bio: "",
    hosting_experience: "",
    relevant_experience: "",
    why_join: "",
    availability_days: [] as string[],
    availability_notes: "",
    event_types_presets: [] as string[],
    event_types_other: "",
  });
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mine.data) {
      const savedAvail = mine.data.availability ?? "";
      const availDays = DAY_OPTIONS.filter((d: string) => savedAvail.split("|")[0]?.includes(d));
      const availNotes = savedAvail.split("|")[1]?.trim() ?? "";
      const savedTypes = (mine.data.event_types ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const presets = savedTypes.filter((t) => EVENT_TYPE_OPTIONS.includes(t));
      const other = savedTypes.filter((t) => !EVENT_TYPE_OPTIONS.includes(t)).join(", ");
      setForm({
        display_name: mine.data.display_name ?? "",
        age: String(mine.data.age ?? ""),
        city: mine.data.city ?? "",
        instagram_handle: mine.data.instagram_handle ?? "",
        other_socials: mine.data.other_socials ?? "",
        bio: (mine.data as any).bio ?? "",
        hosting_experience: mine.data.hosting_experience ?? "",
        relevant_experience: (mine.data as any).relevant_experience ?? "",
        why_join: mine.data.why_join ?? "",
        availability_days: availDays,
        availability_notes: availNotes,
        event_types_presets: presets,
        event_types_other: other,
      });
    }
  }, [mine.data]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!agreementFile) {
        throw new Error("Please upload a signed copy of the Co-Host Agreement.");
      }
      const allowed = ["application/pdf", "image/png", "image/jpeg"];
      if (!allowed.includes(agreementFile.type)) {
        throw new Error("Agreement must be a PDF, PNG, or JPG file.");
      }
      if (agreementFile.size > 10 * 1024 * 1024) {
        throw new Error("Agreement file must be under 10MB.");
      }
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("You must be signed in.");
      const userId = userData.user.id;
      const ext = agreementFile.name.split(".").pop() || "bin";
      const path = `${userId}/signed-agreement-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("cohost-agreements")
        .upload(path, agreementFile, { upsert: true, contentType: agreementFile.type });
      if (upErr) throw new Error(upErr.message);

      const availability = [
        form.availability_days.join(", "),
        form.availability_notes.trim(),
      ].filter(Boolean).join(" | ");
      const event_types = [
        ...form.event_types_presets,
        ...form.event_types_other.split(",").map((s) => s.trim()).filter(Boolean),
      ].join(", ");
      return submitFn({
        data: {
          display_name: form.display_name.trim(),
          age: Number(form.age),
          city: form.city.trim(),
          instagram_handle: form.instagram_handle.trim(),
          other_socials: form.other_socials.trim(),
          bio: form.bio.trim(),
          hosting_experience: form.hosting_experience.trim(),
          relevant_experience: form.relevant_experience.trim(),
          why_join: form.why_join.trim(),
          availability,
          event_types,
          agreement_file_path: path,
        },
      });
    },
    onSuccess: () => {
      toast.success("Application submitted — status: Pending Review");
      setAgreementFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["my-cohost-application"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });



  const withdraw = useMutation({
    mutationFn: () => withdrawFn(),
    onSuccess: () => {
      toast.success("Application withdrawn");
      qc.invalidateQueries({ queryKey: ["my-cohost-application"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const isLoading = eligibility.isLoading || mine.isLoading;
  const app = mine.data;
  const isReadOnly = app && app.status !== "pending";
  const canApply = eligibility.data?.ageVerified && eligibility.data?.hasSelfie;

  return (
    <section className="mx-auto max-w-3xl px-5 py-12">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Co-host program</div>
      <h1 className="mt-2 font-display text-3xl font-semibold">Host events with me</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Applications are open to verified women who want to co-host events on this platform.
        You must complete age verification (18+ with selfie on file) before applying. Approval
        grants you a co-host role in your account.
      </p>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading…</p>
      ) : app ? (
        <StatusPanel app={app} onWithdraw={() => withdraw.mutate()} withdrawing={withdraw.isPending} />
      ) : !canApply ? (
        <div className="mt-8 rounded-xl border border-border/60 bg-card p-6">
          <h2 className="font-display text-lg">Verify first</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You need an approved 18+ age verification with a selfie on file before applying.
            {eligibility.data?.status && (
              <> Current verification status: <span className="text-foreground">{eligibility.data.status}</span>.</>
            )}
          </p>
          <Link
            to="/verify"
            className="mt-4 inline-block rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Go to verification
          </Link>
        </div>
      ) : null}

      {!app && canApply && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="mt-8 space-y-5 rounded-xl border border-border/60 bg-card p-6"
        >
          <Field label="Display name" required>
            <Input value={form.display_name} onChange={(v) => setForm((f) => ({ ...f, display_name: v }))} maxLength={80} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Age" required>
              <Input
                type="number"
                min={18}
                max={120}
                value={form.age}
                onChange={(v) => setForm((f) => ({ ...f, age: v }))}
              />
            </Field>
            <Field label="City" required>
              <Input value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} maxLength={120} />
            </Field>
          </div>
          <Field label="Instagram handle">
            <Input
              value={form.instagram_handle}
              onChange={(v) => setForm((f) => ({ ...f, instagram_handle: v }))}
              maxLength={80}
              placeholder="@yourhandle"
            />
          </Field>
          <Field label="Other socials / links">
            <Textarea
              value={form.other_socials}
              onChange={(v) => setForm((f) => ({ ...f, other_socials: v }))}
              rows={2}
              maxLength={500}
              placeholder="TikTok, OnlyFans, portfolio…"
            />
          </Field>
          <Field label="Short bio">
            <Textarea
              value={form.bio}
              onChange={(v) => setForm((f) => ({ ...f, bio: v }))}
              rows={3}
              maxLength={600}
              placeholder="A couple sentences about you — vibe, scene, what makes you a good host."
            />
            <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              {form.bio.length}/600
            </div>
          </Field>
          <Field label="Hosting / event experience" required>
            <Textarea
              value={form.hosting_experience}
              onChange={(v) => setForm((f) => ({ ...f, hosting_experience: v }))}
              rows={4}
              maxLength={2000}
              placeholder="Events you've hosted, promoted, or worked at."
            />
          </Field>
          <Field label="Why do you want to co-host?" required>
            <Textarea
              value={form.why_join}
              onChange={(v) => setForm((f) => ({ ...f, why_join: v }))}
              rows={4}
              maxLength={2000}
            />
          </Field>

          <Field label="Availability — days you're usually free">
            <ChipGroup
              options={DAY_OPTIONS}
              selected={form.availability_days}
              onToggle={(v) =>
                setForm((f) => ({
                  ...f,
                  availability_days: f.availability_days.includes(v)
                    ? f.availability_days.filter((d) => d !== v)
                    : [...f.availability_days, v],
                }))
              }
            />
            <div className="mt-3">
              <Textarea
                value={form.availability_notes}
                onChange={(v) => setForm((f) => ({ ...f, availability_notes: v }))}
                rows={2}
                maxLength={400}
                placeholder="Notes — evenings only, travel-ready, blackout weeks…"
              />
            </div>
          </Field>

          <Field label="Event types you're interested in">
            <ChipGroup
              options={EVENT_TYPE_OPTIONS}
              selected={form.event_types_presets}
              onToggle={(v) =>
                setForm((f) => ({
                  ...f,
                  event_types_presets: f.event_types_presets.includes(v)
                    ? f.event_types_presets.filter((t) => t !== v)
                    : [...f.event_types_presets, v],
                }))
              }
            />
            <div className="mt-3">
              <Input
                value={form.event_types_other}
                onChange={(v) => setForm((f) => ({ ...f, event_types_other: v }))}
                maxLength={300}
                placeholder="Other (comma-separated)"
              />
            </div>
          </Field>

          <button
            type="submit"
            disabled={submit.isPending || isReadOnly === true}
            className="rounded-md bg-primary px-6 py-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:opacity-50"
          >
            {submit.isPending ? "Submitting…" : "Submit application"}
          </button>
        </form>
      )}
    </section>
  );
}

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition ${
              active
                ? "border-primary bg-primary/20 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function StatusPanel({
  app,
  onWithdraw,
  withdrawing,
}: {
  app: NonNullable<Awaited<ReturnType<typeof getMyCohostApplication>>>;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  const pill =
    app.status === "approved"
      ? "border-neon/50 bg-neon/10 text-neon"
      : app.status === "rejected"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-primary/40 bg-primary/10 text-primary";
  return (
    <div className="mt-8 rounded-xl border border-border/60 bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Your application</div>
          <h2 className="mt-1 font-display text-lg">{app.display_name}</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${pill}`}>
          {app.status}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Info label="Age">{app.age}</Info>
        <Info label="City">{app.city}</Info>
        {app.instagram_handle && <Info label="Instagram">{app.instagram_handle}</Info>}
        {app.availability && <Info label="Availability">{app.availability}</Info>}
      </dl>
      <div className="mt-4 space-y-3 text-sm">
        {(app as any).bio && <Info label="Bio">{(app as any).bio}</Info>}
        {app.event_types && <Info label="Event types">{app.event_types}</Info>}
        <Info label="Experience">{app.hosting_experience}</Info>
        <Info label="Why">{app.why_join}</Info>
        {app.admin_notes && <Info label="Reviewer notes">{app.admin_notes}</Info>}
      </div>
      {app.status === "pending" && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="mt-6 rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {withdrawing ? "Withdrawing…" : "Withdraw & edit"}
        </button>
      )}
      {app.status === "approved" && (
        <p className="mt-6 text-sm text-neon">
          You're a co-host. Head to your <Link to="/dashboard" className="underline">dashboard</Link> or{" "}
          <Link to="/events/new" className="underline">host a new event</Link>.
        </p>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label} {required && <span className="text-primary">*</span>}
      </div>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  maxLength,
  min,
  max,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      min={min}
      max={max}
      placeholder={placeholder}
      required
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
    />
  );
}

function Textarea({
  value,
  onChange,
  rows,
  maxLength,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
    />
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-foreground">{children}</div>
    </div>
  );
}
