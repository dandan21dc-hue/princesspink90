import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Send, ShieldAlert, Check, X, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  executeAdminAssistantAction,
  type AdminAssistantAction,
} from "@/lib/admin-assistant.functions";

type Proposal = {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
};

const DESTRUCTIVE = new Set<AdminAssistantAction["tool"]>([
  "cancelBooking",
  "approveAsset",
  "rejectAsset",
  "setListingPublished",
  "setListingSold",
]);

function isProposalEnvelope(value: unknown): value is { proposal: Proposal } {
  if (!value || typeof value !== "object") return false;
  const p = (value as { proposal?: unknown }).proposal;
  if (!p || typeof p !== "object") return false;
  const cast = p as Partial<Proposal>;
  return typeof cast.tool === "string" && typeof cast.summary === "string";
}

export function AdminAssistantChat({
  threadId,
  initialMessages,
}: {
  threadId: string;
  initialMessages: UIMessage[];
}) {
  const executeAction = useServerFn(executeAdminAssistantAction);
  const [decidedTools, setDecidedTools] = useState<
    Record<string, "confirmed" | "cancelled">
  >({});
  const [input, setInput] = useState("");
  const [assetId, setAssetId] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/admin-assistant/chat",
        body: { threadId },
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(url, { ...init, headers });
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "Chat error"),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId]);
  useEffect(() => {
    if (status === "ready") textareaRef.current?.focus();
  }, [status]);

  const busy = status === "submitted" || status === "streaming";

  async function handleConfirm(toolCallId: string, proposal: Proposal) {
    if (!DESTRUCTIVE.has(proposal.tool as AdminAssistantAction["tool"])) {
      toast.error(`Unknown action: ${proposal.tool}`);
      return;
    }
    setDecidedTools((prev) => ({ ...prev, [toolCallId]: "confirmed" }));
    try {
      const res = await executeAction({
        data: { tool: proposal.tool, args: proposal.args } as AdminAssistantAction,
      });
      toast.success(res.summary);
      await sendMessage({ text: `Action confirmed and executed: ${res.summary}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      toast.error(msg);
      setDecidedTools((prev) => ({ ...prev, [toolCallId]: "cancelled" }));
      await sendMessage({ text: `Action failed: ${msg}` });
    }
  }

  async function handleCancel(toolCallId: string, proposal: Proposal) {
    setDecidedTools((prev) => ({ ...prev, [toolCallId]: "cancelled" }));
    await sendMessage({ text: `Cancelled proposal: ${proposal.summary}` });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <Card className="flex h-[75vh] flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
        <Wand2 className="h-4 w-4 text-primary" aria-hidden />
        <div className="flex-1">
          <div className="text-sm font-semibold">Admin Command Center</div>
          <div className="text-xs text-muted-foreground">
            OpenRouter · anthropic/claude-haiku-4.5 · all mutations require your confirmation
          </div>
        </div>
        <Badge variant="secondary" className="gap-1 text-xs">
          <ShieldAlert className="h-3 w-3" /> Admin
        </Badge>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Try: <span className="italic">"List all pending assets"</span>,{" "}
            <span className="italic">"Show cancelled bookings from the last week"</span>, or{" "}
            <span className="italic">"Unpublish listing &lt;id&gt;"</span>.
          </div>
        )}

        {messages.map((m: UIMessage) => (
          <MessageBubble
            key={m.id}
            message={m}
            decidedTools={decidedTools}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive">
            {error.message || "The assistant hit an error."}
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2 border-t bg-muted/20 p-3">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend(e);
            }
          }}
          placeholder="Ask a question or describe an action…"
          rows={2}
          className="min-h-[44px] resize-none"
          disabled={busy}
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </Card>
  );
}

function MessageBubble({
  message,
  decidedTools,
  onConfirm,
  onCancel,
}: {
  message: UIMessage;
  decidedTools: Record<string, "confirmed" | "cancelled">;
  onConfirm: (toolCallId: string, proposal: Proposal) => void;
  onCancel: (toolCallId: string, proposal: Proposal) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-2 rounded-lg border px-3 py-2 text-sm ${
          isUser ? "bg-primary/10 border-primary/20" : "bg-card"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {part.text}
              </div>
            );
          }
          if (part.type.startsWith("tool-")) {
            const toolPart = part as unknown as {
              toolCallId: string;
              state: string;
              input?: unknown;
              output?: unknown;
              errorText?: string;
            };
            const toolName = part.type.slice("tool-".length);
            const isReady =
              toolPart.state === "output-available" || toolPart.state === "result";
            const isError = toolPart.state === "output-error";
            const output = toolPart.output;
            const proposalCard =
              isReady && isProposalEnvelope(output) ? output.proposal : null;

            return (
              <div key={i} className="rounded border bg-muted/40 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {toolName}
                  </Badge>
                  {!isReady && !isError && <span>Running…</span>}
                  {isError && (
                    <span className="text-destructive">
                      {toolPart.errorText ?? "error"}
                    </span>
                  )}
                </div>

                {proposalCard ? (
                  <ProposalCard
                    proposal={proposalCard}
                    decision={decidedTools[toolPart.toolCallId]}
                    onConfirm={() => onConfirm(toolPart.toolCallId, proposalCard)}
                    onCancel={() => onCancel(toolPart.toolCallId, proposalCard)}
                  />
                ) : isReady ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                    {JSON.stringify(output, null, 2)}
                  </pre>
                ) : null}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  decision,
  onConfirm,
  onCancel,
}: {
  proposal: Proposal;
  decision?: "confirmed" | "cancelled";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-2">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-semibold">Proposed action — confirm to execute</span>
      </div>
      <div className="text-xs">{proposal.summary}</div>
      <pre className="max-h-40 overflow-auto rounded bg-background/60 p-1.5 text-[11px]">
        {proposal.tool}({JSON.stringify(proposal.args, null, 2)})
      </pre>
      {decision === "confirmed" ? (
        <div className="text-xs text-emerald-600">Confirmed & executed.</div>
      ) : decision === "cancelled" ? (
        <div className="text-xs text-muted-foreground">Cancelled.</div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={onConfirm}>
            <Check className="mr-1 h-3.5 w-3.5" /> Confirm & execute
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="mr-1 h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
