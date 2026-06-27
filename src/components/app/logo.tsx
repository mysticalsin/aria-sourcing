import * as React from "react";
import { cn } from "@/lib/utils";

/** Hermes mark — winged-courier glyph on a Mantu-purple tile (pure SVG, no stock). */
export function HermesMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-2xl shadow-soft",
        className,
      )}
      style={{
        background: "linear-gradient(140deg, hsl(var(--electric)), hsl(var(--tangerine)))",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M12 7c3.5 0 6-1.2 8-3-0.6 3.2-3 5-8 5" stroke="hsl(var(--mantu-yellow))" />
        <path d="M12 7c-3.5 0-6-1.2-8-3 .6 3.2 3 5 8 5" />
        <circle cx="12" cy="14.5" r="2.2" stroke="hsl(var(--mantu-yellow))" />
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
          <span className="eyebrow !text-[0.5625rem] !tracking-[0.2em] text-tangerine">
            SOURCING · BY MANTU
          </span>
        </span>
      )}
    </span>
  );
}
