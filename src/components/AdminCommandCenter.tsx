import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Terminal, Send, Loader2, Wrench, CheckCircle2, XCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  adminCommandCenterChat,
  type AdminChatMessage,
  type AdminToolCall,
} from "@/lib/admin-command-center.functions";

type UITurn = {
  role: "user" | "assistant";
  content: string;
  tool_calls?: AdminToolCall[];
};

const SUGGESTIONS = [
  "List all unapproved assets",
  "Show pending bookings",
  "List merchandise",
  "Find user @",
];

export function AdminCommandCenter() {
  const chatFn = useServerFn(adminCommandCenterChat);
  const [turns, setTurns] = useState<UITurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    const nextTurns: UITurn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(nextTurns);
    setInput("");
    setPending(true);
    try {
      const history: AdminChatMessage[] = nextTurns.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      const res = (await chatFn({ data: { messages: history } })) as {
        reply: string;
        tool_calls: AdminToolCall[];
      };
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, tool_calls: res.tool_calls },
      ]);

    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label="Admin Command Center"
      className="flex h-[560px] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-[#0b0b10]/95 shadow-lg"
    >
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Terminal className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">Admin Command Center</div>
          <div className="text-[11px] text-muted-foreground">
            Natural-language CRUD over bookings, users, assets &amp; merch. Destructive actions
            respect admin RLS.
          </div>
        </div>
      </header>

      <div ref={feedRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Ask in plain English. Examples:
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-foreground/80 hover:border-primary/50 hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnBubble key={i} turn={t} />
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            thinking…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-white/5 bg-black/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="e.g. Cancel booking 1a2b3c4d-…"
          rows={2}
          className="min-h-[44px] flex-1 resize-none bg-white/[0.04] text-sm"
          aria-label="Admin command input"
        />
        <Button type="submit" size="sm" disabled={pending || !input.trim()} className="gap-1">
          <Send className="h-4 w-4" />
          Send
        </Button>
      </form>
    </section>
  );
}

function TurnBubble({ turn }: { turn: UITurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary/90 px-3 py-2 text-sm text-primary-foreground">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="max-w-[95%] whitespace-pre-wrap rounded-2xl bg-white/[0.04] px-3 py-2 text-sm text-foreground/90">
        {turn.content}
      </div>
      {turn.tool_calls?.map((tc, i) => <ToolCallCard key={i} call={tc} />)}
    </div>
  );
}

function ToolCallCard({ call }: { call: AdminToolCall }) {
  const [open, setOpen] = useState(false);
  const rows =
    call.ok &&
    call.result &&
    typeof call.result === "object" &&
    Array.isArray((call.result as { rows?: unknown[] }).rows)
      ? ((call.result as { rows: Record<string, unknown>[] }).rows)
      : null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Wrench className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-foreground/80">{call.name}</span>
        {call.ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        )}
        {rows && (
          <span className="text-muted-foreground">{rows.length} row(s)</span>
        )}
        <span className="ml-auto text-muted-foreground">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="border-t border-white/5 p-3">
          {rows ? <ResultTable rows={rows} /> : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-foreground/80">
              {JSON.stringify(call.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <div className="text-muted-foreground">No rows.</div>;
  const cols = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  ).slice(0, 8);
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="text-muted-foreground">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-2 py-1 font-normal">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground/90">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {cols.map((c) => (
                <td key={c} className="max-w-[180px] truncate px-2 py-1">
                  {formatCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
