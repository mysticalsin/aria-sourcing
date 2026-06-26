import * as React from "react";
import { cn } from "@/lib/utils";

/** Original Hermes mark — a winged-courier glyph rendered in pure SVG. */
export function HermesMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-ink text-paper shadow-soft",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M12 7c3.5 0 6-1.2 8-3-0.6 3.2-3 5-8 5" className="text-tangerine" stroke="hsl(var(--tangerine))" />
        <path d="M12 7c-3.5 0-6-1.2-8-3 .6 3.2 3 5 8 5" />
        <circle cx="12" cy="14.5" r="2.2" stroke="hsl(var(--tangerine))" />
      </svg>
    </span>
  );
}

export function HermesWordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <HermesMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[0.95rem] font-extrabold tracking-tight text-ink">HERMES</span>
          <span className="eyebrow !text-[0.5625rem] !tracking-[0.22em] text-tangerine">SOURCING</span>
        </span>
      )}
    </span>
  );
}
