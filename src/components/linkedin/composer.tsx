"use client";

import * as React from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX = 8000;

/**
 * Message box. Enter sends; Shift+Enter adds a line (owner, 2026-11-09). The text clears as soon as the message
 * is handed over: the thread shows it right away.
 */
export function Composer({
  placeholder,
  disabled,
  hint,
  onSend,
  autoFocus,
  initialText = "",
}: {
  placeholder: string;
  disabled?: boolean;
  hint?: React.ReactNode;
  onSend: (text: string) => void | Promise<unknown>;
  autoFocus?: boolean;
  /** Prefilled text (an approved outreach draft); still sent by a click. */
  initialText?: string;
}) {
  const [text, setText] = React.useState(initialText);
  const area = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const canSend = !disabled && text.trim().length > 0 && text.length <= MAX;

  function submit(event?: React.SyntheticEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const value = text;
    setText("");
    void onSend(value);
    area.current?.focus();
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface/60 p-3">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-sm transition-[border-color,box-shadow] duration-200 ease-motion-out",
          "focus-within:border-electric/40 focus-within:shadow-[0_0_0_4px_hsl(var(--electric)/0.08)]",
        )}
      >
        <textarea
          ref={area}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={MAX}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line (never while an IME is composing).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
          }}
          className="max-h-[220px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-muted focus:outline-none focus-visible:outline-none disabled:opacity-60"
          aria-label={placeholder}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            "mb-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white transition-[transform,opacity,background-color] duration-150 ease-motion-out active:scale-[0.97]",
            canSend ? "bg-[#0a66c2] hover:bg-[#004182]" : "bg-[#0a66c2]/40",
          )}
        >
          <Send className="h-4 w-4" aria-hidden />
          Send
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[0.7rem] text-muted">
        <span className="min-w-0 truncate">{hint}</span>
        <span className="shrink-0 tabular-nums">
          {text.length > MAX - 1000 ? `${text.length}/${MAX} · ` : ""}Enter to send · Shift+Enter for a new line
        </span>
      </div>
    </form>
  );
}
