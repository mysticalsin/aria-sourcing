import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** Aria M-mark — the gradient mark on a transparent background (reads on any
 *  surface; never tiled, circled, or cropped). */
export function HermesMark({ className }: { className?: string }) {
  return (
    <Image
      src="/aria-mark.png"
      alt="Aria"
      width={60}
      height={44}
      priority
      className={cn("h-9 w-auto object-contain", className)}
    />
  );
}

/**
 * Full brand lockup for light surfaces — the complete ARIA logo, rendered
 * transparent (no dark backdrop): the gradient M-mark above a spaced ink "ARIA"
 * wordmark and a gradient "AGENTIC SOURCING PLATFORM" tagline. Mirrors the
 * marketing logo (aria-logo.png), but with ink "ARIA" so it reads on the light
 * sidebar (the white-on-transparent aria-logo.png is used on the dark login).
 */
export function HermesWordmark({ className, compact }: { className?: string; compact?: boolean }) {
  if (compact) return <HermesMark className={className} />;
  return (
    <span className={cn("flex flex-col items-center gap-2 text-center", className)}>
      <Image
        src="/aria-mark.png"
        alt=""
        aria-hidden
        width={120}
        height={88}
        priority
        className="h-14 w-auto object-contain"
      />
      <span className="flex flex-col items-center leading-none">
        <span className="pl-[0.4em] text-2xl font-extrabold tracking-[0.4em] text-ink">
          ARIA
        </span>
        <span className="mt-2 bg-gradient-to-r from-violet via-electric to-aqua bg-clip-text pl-[0.28em] text-[0.5rem] font-bold uppercase tracking-[0.28em] text-transparent">
          Agentic Sourcing Platform
        </span>
      </span>
      <span className="sr-only">Aria: Agentic Sourcing Platform by Mantu</span>
    </span>
  );
}
