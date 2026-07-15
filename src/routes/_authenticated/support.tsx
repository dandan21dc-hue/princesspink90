import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { getMyConversation } from "@/lib/support-chat.functions";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { MessageCircleHeart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({
    meta: [
      { title: "Support chat — Midnight Glory 90" },
      {
        name: "description",
        content:
          "Chat with the Midnight Glory 90 support assistant for help with your account, events, RSVPs, and more. Escalates to a human when needed.",
      },
    ],
  }),
  component: SupportChatPage,
});

function rowToUIMessage(row: {
  id: string;
  role: string;
  content: string;
}): UIMessage {
  const role: UIMessage["role"] =
    row.role === "assistant" || row.role === "admin"
      ? "assistant"
      : row.role === "system"
      ? "system"
      : "user";
  return {
    id: row.id,
    role,
    parts: [{ type: "text", text: row.content }],
  };
}

function SupportChatPage() {
  const fetchConv = useServerFn(getMyConversation);
  const convQuery = useQuery({
    queryKey: ["support-conversation"],
    queryFn: () => fetchConv(),
  });

  const initialMessages = useMemo<UIMessage[]>(
    () => (convQuery.data?.messages ?? []).map(rowToUIMessage),
    [convQuery.data?.messages],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      }),
    [],
  );

  const [input, setInput] = useState("");
  const { messages, sendMessage, status, setMessages, error } = useChat({
    id: convQuery.data?.id,
    transport,
  });

  // Seed messages once the conversation loads.
  useEffect(() => {
    if (initialMessages.length > 0 && messages.length === 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, messages.length, setMessages]);

  const isBusy = status === "submitted" || status === "streaming";

  const handleSubmit = async (msg: PromptInputMessage) => {
    const text = msg.text?.trim();
    if (!text || isBusy) return;
    setInput("");
    await sendMessage({ text });
  };

  const escalated = convQuery.data?.escalated ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 pt-10 pb-6">
        <header className="mb-6">
          <Link
            to="/dashboard"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Dashboard
          </Link>
          <div className="mt-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <MessageCircleHeart className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold">
                Ask us anything
              </h1>
              <p className="text-sm text-muted-foreground">
                Answered instantly by our assistant. If we can't help, we'll
                forward your message to the admin team.
              </p>
            </div>
          </div>
          {escalated && (
            <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary">
              This conversation has been forwarded to the admin team. You'll
              hear back by email.
            </div>
          )}
        </header>

        <div className="flex-1 rounded-lg border border-border bg-card/40">
          <Conversation className="h-[60vh]">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  title="Say hello"
                  description="Ask about events, RSVPs, health screenings, membership — anything."
                />
              ) : (
                messages.map((m) => {
                  const text = m.parts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("");
                  if (m.role === "system") {
                    return (
                      <div
                        key={m.id}
                        className="mx-auto my-2 max-w-md text-center text-xs text-muted-foreground"
                      >
                        {text}
                      </div>
                    );
                  }
                  return (
                    <Message key={m.id} from={m.role}>
                      <MessageContent>
                        {m.role === "assistant" ? (
                          <MessageResponse>{text}</MessageResponse>
                        ) : (
                          <span className="whitespace-pre-wrap">{text}</span>
                        )}
                      </MessageContent>
                    </Message>
                  );
                })
              )}
              {isBusy && (
                <div className="px-4 py-2 text-sm">
                  <Shimmer>Thinking…</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {error && (
          <p className="mt-3 text-sm text-destructive">
            Something went wrong: {error.message}
          </p>
        )}

        <div className="mt-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question…"
              autoFocus
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                status={status}
                disabled={isBusy || input.trim().length === 0}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
