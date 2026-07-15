import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import { getCurrentPolicyVersion, listPolicyVersions } from "@/lib/host.functions";
import {
  updateCurrentPolicy,
  publishNewPolicyVersion,
} from "@/lib/compliance-policy.functions";

export const Route = createFileRoute("/_authenticated/admin/compliance-policy")({
  head: () => ({ meta: [{ title: "Compliance policy editor · Admin" }] }),
  component: AdminCompliancePolicy,
});

function AdminCompliancePolicy() {
  const meFn = useServerFn(amIAdmin);
  const currentFn = useServerFn(getCurrentPolicyVersion);
  const listFn = useServerFn(listPolicyVersions);
  const updateFn = useServerFn(updateCurrentPolicy);
  const publishFn = useServerFn(publishNewPolicyVersion);
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const enabled = me.data?.isAdmin === true;
  const current = useQuery({
    queryKey: ["compliance-policy-current"],
    queryFn: () => currentFn(),
    enabled,
  });
  const list = useQuery({
    queryKey: ["compliance-policy-list"],
    queryFn: () => listFn(),
    enabled,
  });

  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newBody, setNewBody] = useState("");

  useEffect(() => {
    if (current.data) {
      setSummary(current.data.summary);
      setBody(current.data.body);
    }
  }, [current.data]);

  const save = useMutation({
    mutationFn: () => updateFn({ data: { summary, body } }),
    onSuccess: () => {
      toast.success("Policy updated");
      qc.invalidateQueries({ queryKey: ["compliance-policy-current"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const publish = useMutation({
    mutationFn: () =>
      publishFn({ data: { version: newVersion.trim(), summary: newSummary, body: newBody } }),
    onSuccess: () => {
      toast.success(`Published policy v${newVersion.trim()}`);
      setNewVersion("");
      setNewSummary("");
      setNewBody("");
      qc.invalidateQueries({ queryKey: ["compliance-policy-current"] });
      qc.invalidateQueries({ queryKey: ["compliance-policy-list"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
  });

  if (me.isLoading) {
    return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {current.isLoading ? (
        <p className="text-muted-foreground">Loading policy…</p>
      ) : !current.data ? (
        <p className="text-muted-foreground">No active policy version. Publish one below.</p>
      ) : (
        <section className="mb-10 rounded-xl border border-border/60 bg-card/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
                Editing current · v{current.data.version}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                Effective {new Date(current.data.effective_at).toLocaleDateString()}
              </div>
            </div>
            <Link
              to="/compliance"
              target="_blank"
              className="text-xs uppercase tracking-widest text-primary hover:underline"
            >
              View public page →
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Edits here update the current policy text in place (summary and body). Guests see changes immediately.
            To require re-agreement on new document uploads, publish a new version instead.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          >
            <Field label="Summary" hint="Shown at the top of the compliance page and in the upload agreement card.">
              <textarea
                rows={3} value={summary} onChange={(e) => setSummary(e.target.value)}
                className={inputCls} maxLength={500} required
              />
              <Counter n={summary.length} max={500} />
            </Field>
            <Field label="Policy body & required document instructions" hint="Full policy body. Use plain paragraphs; blank lines create separation.">
              <textarea
                rows={16} value={body} onChange={(e) => setBody(e.target.value)}
                className={`${inputCls} font-mono text-[13px]`} maxLength={20000} required
              />
              <Counter n={body.length} max={20000} />
            </Field>
            <div className="flex items-center gap-3">
              <button
                type="submit" disabled={save.isPending}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (current.data) { setSummary(current.data.summary); setBody(current.data.body); }
                }}
                className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-primary/30 bg-primary/5 p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Publish a new version
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Publishing a new version marks it as current and requires hosts to re-agree before uploading further documents. Existing documents remain flagged as uploaded under their original version.
        </p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newVersion.trim()) { toast.error("Version label is required"); return; }
            if (!confirm(`Publish policy v${newVersion.trim()} as the current version?`)) return;
            publish.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Version">
              <input
                type="text" value={newVersion} onChange={(e) => setNewVersion(e.target.value)}
                className={inputCls} placeholder="e.g. 1.1" maxLength={40} required
              />
            </Field>
            <Field label="Summary">
              <textarea
                rows={2} value={newSummary} onChange={(e) => setNewSummary(e.target.value)}
                className={inputCls} maxLength={500} required
              />
              <Counter n={newSummary.length} max={500} />
            </Field>
          </div>
          <Field label="Policy body & required document instructions">
            <textarea
              rows={12} value={newBody} onChange={(e) => setNewBody(e.target.value)}
              className={`${inputCls} font-mono text-[13px]`} maxLength={20000} required
            />
            <Counter n={newBody.length} max={20000} />
          </Field>
          <button
            type="submit" disabled={publish.isPending}
            className="rounded-md border border-primary/50 bg-primary/10 px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {publish.isPending ? "Publishing…" : "Publish new version"}
          </button>
        </form>
      </section>

      {list.data && list.data.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg mb-3">Version history</h2>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
            {list.data.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                    v.is_current ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/40 text-muted-foreground"
                  }`}>v{v.version}</span>
                  <span className="text-muted-foreground">
                    Effective {new Date(v.effective_at).toLocaleDateString()}
                  </span>
                </div>
                {v.is_current && <span className="text-xs uppercase tracking-widest text-emerald-400">Current</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

const inputCls =
  "w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary";

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <div className={`mt-1 text-right text-[10px] ${n > max * 0.9 ? "text-amber-400" : "text-muted-foreground"}`}>
      {n} / {max}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-16">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-1 font-display text-3xl font-bold">Compliance policy</h1>
        </div>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      {children}
    </div>
  );
}
