"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Send, Loader2 } from "lucide-react";

interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  sending?: boolean;
}

const SLASH_HINTS = [
  { cmd: "/clear", hint: "Clear this thread's messages" },
  { cmd: "/new", hint: "Start a new thread with this agent" },
  { cmd: "/persona", hint: "Show this agent's persona" },
];

export function ChatComposer({ onSend, disabled, sending }: ChatComposerProps) {
  const [value, setValue] = React.useState("");
  const [showHints, setShowHints] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    setShowHints(v.startsWith("/"));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || sending) return;
    setValue("");
    setShowHints(false);
    onSend(trimmed);
    // Restore focus after state flush
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="relative">
      {showHints && (
        <div className="absolute bottom-full mb-2 left-0 right-0 rounded-2xl border border-violet/10 bg-surface/95 backdrop-blur shadow-soft overflow-hidden">
          {SLASH_HINTS.map(({ cmd, hint }) => (
            <button
              key={cmd}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-violet/[0.06] transition-colors"
              onClick={() => {
                setValue(cmd);
                setShowHints(false);
                textareaRef.current?.focus();
              }}
            >
              <span className="text-sm font-mono font-bold text-electric">{cmd}</span>
              <span className="text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message Aria… (Shift+Enter for new line, /cmd for commands)"
          disabled={disabled || sending}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-2xl border border-violet/10 bg-surface/80 backdrop-blur-sm px-4 py-3 text-sm text-ink placeholder:text-muted",
            "transition focus:border-electric/60 focus:outline-none focus:ring-2 focus:ring-electric/20 disabled:opacity-60",
            "max-h-[140px] overflow-y-auto leading-relaxed",
          )}
          style={{ height: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
          }}
        />
        <button
          onClick={submit}
          disabled={!value.trim() || disabled || sending}
          className={cn(
            "shrink-0 h-11 w-11 flex items-center justify-center rounded-full transition-all",
            value.trim() && !disabled && !sending
              ? "bg-gradient-to-br from-electric to-violet text-white shadow-glow-purple hover:opacity-90"
              : "bg-ink/5 text-muted cursor-not-allowed",
          )}
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
