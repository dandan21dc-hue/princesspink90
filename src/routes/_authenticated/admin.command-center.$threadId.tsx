import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { UIMessage } from "ai";
import { Loader2 } from "lucide-react";
import { AdminAssistantChat } from "@/components/AdminAssistantChat";
import { getAdminThreadMessages } from "@/lib/admin-assistant-threads.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/command-center/$threadId",
)({
  component: ThreadChatPage,
});

function ThreadChatPage() {
  const { threadId } = Route.useParams();
  const load = useServerFn(getAdminThreadMessages);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-thread-messages", threadId],
    queryFn: () => load({ data: { threadId } }),
  });

  if (isLoading) {
    return (
      <div className="flex h-[75vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading conversation…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  const initialMessages = (data ?? []) as unknown as UIMessage[];

  return (
    <AdminAssistantChat
      key={threadId}
      threadId={threadId}
      initialMessages={initialMessages}
    />
  );
}
