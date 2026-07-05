import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as Notification[]);
  };

  useEffect(() => {
    if (!userId) return;
    load();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unread = items.filter((i) => !i.read_at).length;

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    load();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative rounded-md border border-white/10 bg-white/5 p-2.5 text-white/80 hover:bg-white/10"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-white/10 bg-black/95 shadow-2xl backdrop-blur"
        >
          <div className="border-b border-white/10 px-4 py-3 text-xs uppercase tracking-widest text-white/60">
            Recent activity
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-white/50">No notifications yet.</li>
            )}
            {items.map((n) => {
              const content = (
                <div className="border-b border-white/5 px-4 py-3 hover:bg-white/5">
                  <div className="text-sm font-semibold text-white">{n.title}</div>
                  {n.body && <div className="mt-0.5 text-xs text-white/60">{n.body}</div>}
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.link_url ? (
                    <Link to={n.link_url} onClick={() => setOpen(false)}>
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
