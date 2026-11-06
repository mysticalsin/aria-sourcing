"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { Avatar } from "./avatar";
import { shortWhen, useNow } from "./format";
import type { Conversation, OutboxStatus } from "./types";

const EASE = [0.23, 1, 0.32, 1] as const;

export function conversationName(c: Conversation): string {
  if (c.title) return c.title;
  const names = c.participants.map((p) => p.name).filter(Boolean);
  return names.length ? names.join(", ") : (c.last_message_sender ?? "LinkedIn conversation");
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  pending,
  highlighted,
}: {
  conversations: Conversation[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Conversations with a message on its way, and its stage. */
  pending: ReadonlyMap<string, OutboxStatus>;
  highlighted: ReadonlySet<string>;
}) {
  const reduced = usePrefersReducedMotion();
  const now = useNow(30_000);
  const [query, setQuery] = React.useState("");
  const [onlyUnread, setOnlyUnread] = React.useState(false);
  const unreadCount = conversations?.filter((c) => c.unread).length ?? 0;
  const needle = query.trim().toLowerCase();
  const shown = (conversations ?? []).filter(
    (c) =>
      (!onlyUnread || c.unread) &&
      (!needle || `${conversationName(c)} ${c.last_message_preview ?? ""}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 w-full rounded-full border border-line bg-ink/[0.03] pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,background-color] duration-150 ease-motion-out placeholder:text-muted focus:border-electric/40 focus:bg-surface"
          />
        </label>
        <div className="flex gap-1.5" role="tablist" aria-label="Filter conversations">
          {[
            { key: false, label: "All" },
            { key: true, label: unreadCount ? `Unread · ${unreadCount}` : "Unread" },
          ].map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={onlyUnread === tab.key}
              onClick={() => setOnlyUnread(tab.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-[background-color,color] duration-150 ease-motion-out",
                onlyUnread === tab.key ? "bg-ink text-paper" : "bg-ink/[0.05] text-ink-soft hover:bg-ink/10",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations === null &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line/60 px-4 py-3">
              <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-ink/[0.07]" />
              <span className="flex-1 space-y-2">
                <span className="block h-3 w-1/2 animate-pulse rounded bg-ink/[0.07]" />
                <span className="block h-2.5 w-4/5 animate-pulse rounded bg-ink/[0.05]" />
              </span>
            </div>
          ))}
        {conversations !== null && !shown.length && (
          <p className="p-6 text-center text-sm text-muted">
            {conversations.length
              ? onlyUnread
                ? "Nothing unread. Nice."
                : "No match."
              : "No conversation yet. They appear here as the extension syncs your LinkedIn inbox."}
          </p>
        )}
        <ul>
          <AnimatePresence initial={false}>
            {shown.map((c) => {
              const name = conversationName(c);
              const sending = pending.get(c.id);
              const flash = highlighted.has(c.id);
              return (
                <motion.li
                  key={c.id}
                  layout={reduced ? false : "position"}
                  initial={reduced ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={selectedId === c.id ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left transition-[background-color] duration-300 ease-motion-out",
                      selectedId === c.id ? "bg-[#0a66c2]/[0.08]" : "hover:bg-ink/[0.03]",
                      flash && "bg-[#0a66c2]/[0.12]",
                    )}
                  >
                    {selectedId === c.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-[#0a66c2]" aria-hidden />}
                    <Avatar name={name} unread={c.unread} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("truncate text-sm text-ink", c.unread ? "font-bold" : "font-semibold")}>{name}</span>
                        <span className={cn("ml-auto shrink-0 text-[0.7rem] tabular-nums", c.unread ? "font-semibold text-[#0a66c2]" : "text-muted")}>
                          {shortWhen(c.last_activity_at, now)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {sending ? (
                          <span className="inline-flex items-center gap-1 truncate text-xs font-medium text-[#0a66c2]">
                            <Loader2 className={cn("h-3 w-3 shrink-0", !reduced && "animate-spin")} aria-hidden />
                            {sending === "queued" ? "Queued…" : "Sending…"}
                          </span>
                        ) : (
                          <span className={cn("truncate text-xs", c.unread ? "font-medium text-ink" : "text-muted")}>
                            {c.last_message_direction === "outbound" && c.last_message_preview ? "You: " : ""}
                            {c.last_message_preview ?? ""}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
