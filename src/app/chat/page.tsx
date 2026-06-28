"use client";

import * as React from "react";
import { useHydrated, useSeats, useChats, useActions, useSettings } from "@/lib/store";
import { ChatList } from "@/components/chat/chat-list";
import { ChatThreadView } from "@/components/chat/chat-thread-view";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { SkeletonCard, Card, CardContent, Eyebrow, Badge } from "@/components/ui";
import { getHermesSessions, hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import { MessageSquare, Server } from "lucide-react";

export default function ChatPage() {
  const hydrated = useHydrated();
  const seats = useSeats();
  const chats = useChats();
  const actions = useActions();
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(null);
  const [hermesSessions, setHermesSessions] = React.useState<unknown[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

  // Auto-select the first thread on hydration if none is selected.
  React.useEffect(() => {
    if (!hydrated) return;
    if (!selectedThreadId && chats.length > 0) {
      setSelectedThreadId(chats[0].id);
    }
  }, [hydrated, chats, selectedThreadId]);

  // Poll Aria runtime sessions when live mode is on.
  React.useEffect(() => {
    if (!live) {
      setHermesSessions(null);
      return;
    }
    let cancelled = false;
    setSessionsLoading(true);
    getHermesSessions(settings).then((res) => {
      if (cancelled) return;
      setSessionsLoading(false);
      if (res.ok) setHermesSessions(Array.isArray(res.data) ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [live, settings]);

  function handleNew() {
    if (seats.length === 0) return;
    const currentThread = chats.find((t) => t.id === selectedThreadId);
    const seatId = currentThread?.seatId ?? seats[0].id;
    const thread = actions.createChatThread(seatId);
    setSelectedThreadId(thread.id);
  }

  const fallback = (
    <div className="space-y-4">
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );

  return (
    <HydrationGate hydrated={hydrated} fallback={fallback}>
      <PageHeader
        eyebrow="Operate"
        title="Chat"
        description="Talk to any Aria agent, live or demo"
      />
      <div className="flex h-[calc(100vh-11rem)] min-h-[400px] gap-0 rounded-3xl overflow-hidden border border-violet/10 bg-surface/60 backdrop-blur shadow-soft">
        {/* Left pane — agent + thread list */}
        <div className="w-64 shrink-0 border-r border-violet/10 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-violet/10">
            <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">Agents</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ChatList
              selectedThreadId={selectedThreadId}
              onSelectThread={setSelectedThreadId}
            />
          </div>
        </div>

        {/* Center pane — active thread */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedThreadId ? (
            <ChatThreadView
              threadId={selectedThreadId}
              onNew={handleNew}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <MessageSquare className="h-12 w-12 text-muted mb-3" />
              <p className="text-sm font-semibold text-ink-soft">No thread selected</p>
              <p className="text-xs text-muted mt-1">
                {seats.length === 0
                  ? "Add agents in the Agent Fleet page first."
                  : "Select an agent on the left or click + to start a chat."}
              </p>
            </div>
          )}
        </div>

        {/* Right pane — Aria runtime sessions (live mode only) */}
        {live && (
          <div className="w-64 shrink-0 border-l border-violet/10 overflow-hidden flex flex-col bg-surface/40">
            <div className="px-4 py-3 border-b border-violet/10 flex items-center justify-between">
              <p className="text-xs font-bold text-ink-soft uppercase tracking-wider">Aria sessions</p>
              <Badge tone="success" size="sm" dot>Live</Badge>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sessionsLoading ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : !hermesSessions || hermesSessions.length === 0 ? (
                <p className="text-xs text-muted">No sessions on the runtime yet.</p>
              ) : (
                hermesSessions.map((s, i) => (
                  <Card key={i}>
                    <CardContent className="p-2.5">
                      <p className="text-xs font-medium text-ink truncate">
                        {typeof s === "object" && s !== null && "name" in s ? String((s as Record<string, unknown>).name) : `Session ${i + 1}`}
                      </p>
                      <p className="text-[10px] text-muted truncate">
                        {typeof s === "object" && s !== null && "id" in s ? String((s as Record<string, unknown>).id) : "hermes-agent"}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </HydrationGate>
  );
}
