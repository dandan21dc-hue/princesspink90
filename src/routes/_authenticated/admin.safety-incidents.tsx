import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSafetyIncidents,
  createSafetyIncident,
  archiveSafetyIncident,
  restoreSafetyIncident,
} from "@/lib/safety-incidents.functions";

export const Route = createFileRoute("/_authenticated/admin/safety-incidents")({
  head: () => ({
    meta: [
      { title: "Safety incident reports — Admin" },
      {
        name: "description",
        content:
          "Log and search safety incident reports for compliance audit trail.",
      },
    ],
  }),
  component: AdminSafetyIncidentsPage,
});

const emptyForm = {
  incident_date: new Date().toISOString().slice(0, 10),
  venue: "",
  involved_party: "",
  nature_of_incident: "",
  resolution_taken: "",
};

type View = "active" | "archived" | "all";

function AdminSafetyIncidentsPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("active");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const listFn = useServerFn(listSafetyIncidents);
  const createFn = useServerFn(createSafetyIncident);
  const archiveFn = useServerFn(archiveSafetyIncident);
  const restoreFn = useServerFn(restoreSafetyIncident);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-safety-incidents", search, view],
    queryFn: () =>
      listFn({
        data: {
          search,
          limit: 200,
          include_archived: view === "all",
          only_archived: view === "archived",
        },
      }),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof emptyForm) => createFn({ data }),
    onSuccess: () => {
      setForm(emptyForm);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] });
    },
    onError: (e: any) => setError(e?.message ?? "Failed to create incident"),
  });

  const archiveMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => archiveFn({ data: v }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] }),
  });

  const rows = query.data?.rows ?? [];
  const total = useMemo(() => rows.length, [rows]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createMut.mutate(form);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
          Admin
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Safety incident reports
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Log incidents and maintain a searchable compliance audit trail.
          Records are immutable — archive with a reason instead of deleting.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-10">
        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-card p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold">New incident</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Date</span>
              <input
                type="date"
                required
                value={form.incident_date}
                onChange={(e) =>
                  setForm({ ...form, incident_date: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Venue</span>
              <input
                type="text"
                required
                maxLength={200}
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Involved party</span>
              <input
                type="text"
                required
                maxLength={300}
                value={form.involved_party}
                onChange={(e) =>
                  setForm({ ...form, involved_party: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Nature of incident</span>
              <textarea
                required
                maxLength={4000}
                rows={3}
                value={form.nature_of_incident}
                onChange={(e) =>
                  setForm({ ...form, nature_of_incident: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Resolution taken</span>
              <textarea
                required
                maxLength={4000}
                rows={3}
                value={form.resolution_taken}
                onChange={(e) =>
                  setForm({ ...form, resolution_taken: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {createMut.isPending ? "Saving…" : "Log incident"}
            </button>
          </div>
        </form>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg font-semibold">
            Audit trail{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({total})
            </span>
          </h2>
          <input
            type="search"
            placeholder="Search venue, party, nature, resolution…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-80"
          />
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {query.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : query.error ? (
            <div className="p-6 text-sm text-destructive">
              {(query.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No incidents found.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r: any) => (
                <li key={r.id} className="p-5 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-medium">
                      {r.incident_date} · {r.venue}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Delete this incident record?"))
                          deleteMut.mutate(r.id);
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Involved
                  </div>
                  <div className="text-sm">{r.involved_party}</div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Nature
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {r.nature_of_incident}
                  </div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Resolution
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {r.resolution_taken}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Logged {new Date(r.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
