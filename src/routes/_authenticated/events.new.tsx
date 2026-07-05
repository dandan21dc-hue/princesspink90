import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { EventForm, toPayload } from "@/components/EventForm";
import { createEvent } from "@/lib/host.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/events/new")({
  head: () => ({ meta: [{ title: "Host a night · AFTERDARK" }] }),
  component: NewEvent,
});

function NewEvent() {
  const router = useRouter();
  const createFn = useServerFn(createEvent);
  const m = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) => createFn({ data: payload }),
    onSuccess: (r) => {
      toast.success("Event created");
      router.navigate({ to: "/events/$id/edit", params: { id: r.id } });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section className="mx-auto max-w-3xl px-5 py-10">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Host</div>
      <h1 className="mt-2 mb-8 font-display text-3xl font-semibold">Program a new night</h1>
      <EventForm submitLabel="Create event" submitting={m.isPending} onSubmit={(v) => m.mutate(toPayload(v))} />
    </section>
  );
}
