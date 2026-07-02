"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSeats, useActions, useChatThread, useSettings } from "@/lib/store";
import { hermesAvailable } from "@/lib/ai/hermes";
import { ChatComposer } from "./chat-composer";
import { Bot, User, Loader2, Info, Sparkles, AlertTriangle } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

interface ChatThreadViewProps {
  threadId: string;
  onNew?: () => void;
}

export function ChatThreadView({ threadId, onNew }: ChatThreadViewProps) {
  const thread = useChatThread(threadId);
  const seats = useSeats();
  const actions = useActions();
  const settings = useSettings();
  const isLive = hermesAvailable(settings);
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const seat = thread ? seats.find((s) => s.id === thread.seatId) : undefined;

  // Scroll to bottom whenever messages change.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  if (!thread) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <Bot className="h-12 w-12 text-muted mb-3" />
        <p className="text-sm font-semibold text-ink-soft">Select or start a chat</p>
        <p className="text-xs text-muted mt-1">Pick an agent on the left to open a thread.</p>
      </div>
    );
  }

  async function handleSend(text: string) {
    if (!thread) return;

    // Handle slash commands.
    if (text === "/clear") {
      // Actually empty the thread's messages (keeps the thread/id).
      actions.clearChatThread(thread.id);
      return;
    }
    if (text === "/new") {
      onNew?.();
      return;
    }
    if (text === "/persona") {
      actions.appendChatMessage(thread.id, {
        id: crypto.randomUUID(),
        role: "system",
        content: seat?.persona
          ? `**${seat.name} persona:**\n\n${seat.persona}`
          : "No persona configured for this agent.",
        at: new Date().toISOString(),
      });
      return;
    }

    setSending(true);
    try {
      await actions.sendChat(thread.id, text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-violet/10">
        <div>
          <p className="text-sm font-bold text-ink">{thread.title}</p>
          {seat && (
            <p className="text-xs text-muted mt-0.5">
              {seat.operatorEmail} · {seat.provider}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full",
              isLive
                ? "bg-success/10 text-success"
                : "bg-ink/5 text-muted",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isLive ? "bg-success animate-pulse" : "bg-muted",
              )}
            />
            {isLive ? "live" : "demo"}
          </span>
          {seat && (
            <span className="text-xs text-muted hidden sm:inline">
              {seat.modelId ?? settings.defaultModels?.chat ?? "default model"}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {thread.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Sparkles className="h-8 w-8 text-muted mb-3" />
            <p className="text-sm font-semibold text-ink-soft">Start the conversation</p>
            <p className="text-xs text-muted mt-1">
              Ask about campaigns, candidates, or strategy.
              <br />
              Type <code className="font-mono text-electric">/</code> for commands.
            </p>
          </div>
        )}
        {thread.messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {sending && thread.messages[thread.messages.length - 1]?.pending !== true && (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 px-6 py-4 border-t border-violet/10">
        <ChatComposer onSend={handleSend} sending={sending} />
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div className="flex items-start gap-2 text-xs text-muted italic">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted" />
        <span className="whitespace-pre-wrap">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-start gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold",
          isUser ? "bg-tangerine" : "bg-gradient-to-br from-electric to-violet",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-ink text-paper rounded-tr-sm"
            : msg.error
              ? "bg-danger-soft border border-danger/20 text-danger rounded-tl-sm"
              : "bg-surface border border-violet/10 text-ink rounded-tl-sm",
        )}
      >
        {msg.pending && !msg.content ? (
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted animate-bounce [animation-delay:0ms]" />
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted animate-bounce [animation-delay:150ms]" />
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted animate-bounce [animation-delay:300ms]" />
          </span>
        ) : msg.error ? (
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="whitespace-pre-wrap">{msg.content}</span>
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        )}
      </div>
    </div>
  );
}
