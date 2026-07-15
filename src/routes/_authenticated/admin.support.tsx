import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listEscalatedConversations,
  getConversationMessages,
  postAdminReply,
} from "@/lib/support-chat.functions";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/support")({
  head: () => ({
    meta: [
      { title: "Support inbox — Admin" },
      {
        name: "description",
        content:
          "Admin inbox for support chats. View escalated conversations, read the full transcript, and reply as an admin.",
      },
    ],
  }),
  component: AdminSupportInboxPage,
});

function AdminSupportInboxPage() {
  const listFn = useServerFn(listEscalatedConversations);
  const listQ = useQuery({
    queryKey: ["admin-support-inbox"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-6xl px-5 pt-16 pb-6">
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
          Support inbox
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Conversations from the client support chat. Escalated threads
          appear first; you can also reply to any thread the assistant
          handled.
        </p>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-5 pb-24 md:grid-cols-[320px_1fr]">
        <aside className="rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
            Conversations
          </div>
          {listQ.isLoading && (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          )}
          {listQ.error && (
            <p className="p-3 text-sm text-destructive">
              {(listQ.error as Error).message}
            </p>
          )}
          <ul>
            {(listQ.data?.rows ?? []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`w-full border-b border-border px-3 py-3 text-left hover:bg-muted/40 ${
                    selected === c.id ? "bg-muted/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {c.display_name ?? "Client"}
                    </span>
                    {c.escalated && (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-destructive">
                        Escalated
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {c.escalation_reason ?? "No escalation reason"}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(c.last_message_at), {
                      addSuffix: true,
                    })}
                  </div>
                </button>
              </li>
            ))}
            {listQ.data && listQ.data.rows.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                No conversations yet.
              </li>
            )}
          </ul>
        </aside>

        <section className="rounded-lg border border-border p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Select a conversation on the left to view the transcript.
            </p>
          ) : (
            <ConversationDetail conversationId={selected} />
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationDetail({ conversationId }: { conversationId: string }) {
  const getFn = useServerFn(getConversationMessages);
  const q = useQuery({
    queryKey: ["admin-support-thread", conversationId],
    queryFn: () => getFn({ data: { conversation_id: conversationId } }),
    refetchInterval: 15_000,
  });
  const qc = useQueryClient();
  const replyFn = useServerFn(postAdminReply);
  const reply = useMutation({
    mutationFn: (content: string) =>
      replyFn({ data: { conversation_id: conversationId, content } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({
        queryKey: ["admin-support-thread", conversationId],
      });
      qc.invalidateQueries({ queryKey: ["admin-support-inbox"] });
    },
  });
  const [draft, setDraft] = useState("");

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-2">
        {q.isLoading && (
          <p className="text-sm text-muted-foreground">Loading transcript…</p>
        )}
        {(q.data?.messages ?? []).map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {m.role} ·{" "}
              {formatDistanceToNow(new Date(m.created_at), {
                addSuffix: true,
              })}
            </div>
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                m.role === "user"
                  ? "border-border bg-muted/40"
                  : m.role === "admin"
                  ? "border-primary/40 bg-primary/5"
                  : m.role === "system"
                  ? "border-dashed border-border text-muted-foreground italic"
                  : "border-border"
              }`}
            >
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
          </div>
        ))}
      </div>

      <form
        className="mt-4 flex flex-col gap-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (t) reply.mutate(t);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Reply as admin (the client sees this in their support chat)…"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/60"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Replying as admin
          </span>
          <button
            type="submit"
            disabled={reply.isPending || draft.trim().length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {reply.isPending ? "Sending…" : "Send reply"}
          </button>
        </div>
        {reply.error && (
          <p className="text-sm text-destructive">
            {(reply.error as Error).message}
          </p>
        )}
      </form>
    </div>
  );
}
