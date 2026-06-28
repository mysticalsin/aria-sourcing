"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSeats, useChats, useActions } from "@/lib/store";
import type { AgentSeat, ChatThread } from "@/lib/types";
import { MessageSquare, Plus, Trash2, Search } from "lucide-react";
import { Button, Input } from "@/components/ui";

interface ChatListProps {
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
}

export function ChatList({ selectedThreadId, onSelectThread }: ChatListProps) {
  const seats = useSeats();
  const chats = useChats();
  const actions = useActions();
  const [query, setQuery] = React.useState("");

  function handleNew(seat: AgentSeat) {
    const thread = actions.createChatThread(seat.id);
    onSelectThread(thread.id);
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    actions.deleteChatThread(id);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (thread: ChatThread) =>
    !normalizedQuery ||
    thread.title.toLowerCase().includes(normalizedQuery) ||
    thread.messages.some((m) => m.content.toLowerCase().includes(normalizedQuery));

  if (seats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
        <MessageSquare className="h-10 w-10 text-muted mb-3" />
        <p className="text-sm text-ink-soft font-semibold">No agents yet</p>
        <p className="text-xs text-muted mt-1">Add agents in the Agent Fleet page to start chatting.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            className="pl-8 text-xs"
          />
        </div>
      </div>
      <div className="flex flex-col gap-4 p-3 overflow-y-auto flex-1">
      {seats.map((seat) => {
        const seatThreads = chats.filter((t) => t.seatId === seat.id).filter(matches);
        return (
          <div key={seat.id}>
            <div className="flex items-center justify-between px-2 pb-1.5">
              <p className="text-xs font-bold text-ink-soft uppercase tracking-wider truncate flex-1 pr-2">
                {seat.name}
              </p>
              <button
                onClick={() => handleNew(seat)}
                title="New chat"
                className="rounded-full p-1 text-muted hover:text-ink hover:bg-violet/[0.08] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {seatThreads.length === 0 ? (
              <button
                onClick={() => handleNew(seat)}
                className="w-full flex items-center gap-2 rounded-2xl px-3 py-2 text-xs text-muted hover:bg-violet/[0.06] hover:text-ink transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>Start a chat</span>
              </button>
            ) : (
              <ul className="space-y-0.5">
                {seatThreads.map((thread) => (
                  <ChatThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === selectedThreadId}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={(e) => handleDelete(e, thread.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function ChatThreadRow({
  thread,
  active,
  onSelect,
  onDelete,
}: {
  thread: ChatThread;
  active: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const lastMsg = thread.messages[thread.messages.length - 1];
  return (
    <li>
      <button
        onClick={onSelect}
        className={cn(
          "group w-full flex items-start gap-2 rounded-2xl px-3 py-2 text-left transition-all",
          active
            ? "bg-gradient-to-r from-electric/90 to-violet/80 text-white"
            : "text-ink-soft hover:bg-violet/[0.06] hover:text-ink",
        )}
      >
        <MessageSquare
          className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", active ? "text-mantu-yellow" : "text-muted")}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{thread.title}</p>
          {lastMsg && (
            <p className={cn("text-xs truncate mt-0.5", active ? "text-white/70" : "text-muted")}>
              {lastMsg.role === "user" ? "You: " : ""}
              {lastMsg.content.slice(0, 50) || "…"}
            </p>
          )}
        </div>
        <button
          onClick={onDelete}
          title="Delete thread"
          className={cn(
            "shrink-0 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
            active ? "text-white/70 hover:text-white" : "text-muted hover:text-danger",
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </button>
    </li>
  );
}
