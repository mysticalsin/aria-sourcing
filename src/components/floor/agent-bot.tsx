"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Original glossy "agent" character (pure SVG/CSS — no third-party assets).
   Bobs, eyes glow + blink; motion intensity reflects the agent's state. */

export type BotColor = "blue" | "orange" | "green" | "purple" | "yellow" | "red";

const COLORS: Record<BotColor, { base: string; dark: string }> = {
  blue: { base: "#2f6df6", dark: "#1b46c2" },
  orange: { base: "#f8852b", dark: "#d4661a" },
  green: { base: "#2fb457", dark: "#1c8a40" },
  purple: { base: "#7c3aed", dark: "#5b21b6" },
  yellow: { base: "#eab308", dark: "#b8860a" },
  red: { base: "#ef4444", dark: "#b91c1c" },
};

const PALETTE: BotColor[] = ["blue", "orange", "green", "purple", "yellow", "red"];

export function botColorForSeat(seatId: string): BotColor {
  const h = seatId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length];
}

export function AgentBot({
  color,
  size = 64,
  busy = false,
  paused = false,
  warming = false,
  className,
}: {
  color: BotColor;
  size?: number;
  busy?: boolean;
  paused?: boolean;
  warming?: boolean;
  className?: string;
}) {
  const c = COLORS[color];
  const eyeColor = paused ? "#9aa3b2" : "#9becff";

  return (
    <span
      className={cn(
        "inline-block select-none",
        !paused && (busy ? "bot-float-fast" : "bot-float"),
        className,
      )}
      style={{ width: size, height: size, opacity: paused ? 0.55 : 1, filter: paused ? "grayscale(0.5)" : undefined }}
      aria-hidden
    >
      <svg viewBox="0 0 64 80" width={size} height={size} fill="none">
        {/* antenna */}
        <line x1="32" y1="3" x2="32" y2="9" stroke={c.dark} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="3" r="2.4" fill={c.base} className={paused ? undefined : "bot-glow"} />

        {/* body */}
        <rect x="16" y="40" width="32" height="32" rx="13" fill={c.base} />
        <rect x="16" y="40" width="32" height="32" rx="13" fill="url(#botShadeB)" />
        {/* arms */}
        <rect x="7" y="46" width="9" height="20" rx="4.5" fill={c.dark} />
        <rect x="48" y="46" width="9" height="20" rx="4.5" fill={c.dark} />

        {/* head */}
        <rect x="11" y="8" width="42" height="36" rx="16" fill={c.base} />
        <rect x="11" y="8" width="42" height="36" rx="16" fill="url(#botShadeH)" />
        {/* visor */}
        <rect x="16" y="16" width="32" height="20" rx="10" fill="#0b1020" opacity="0.92" />
        {/* eyes */}
        <g
          className={cn(!paused && "bot-eyes", !paused && "bot-glow")}
          style={{ filter: paused ? undefined : `drop-shadow(0 0 2.5px ${eyeColor})` }}
        >
          <ellipse cx="26" cy="26" rx="3.6" ry="4.6" fill={eyeColor} />
          <ellipse cx="38" cy="26" rx="3.6" ry="4.6" fill={eyeColor} />
        </g>
        {/* gloss highlight */}
        <ellipse cx="24" cy="15" rx="9" ry="4" fill="#ffffff" opacity="0.22" />

        <defs>
          <linearGradient id="botShadeH" x1="0" y1="8" x2="0" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="botShadeB" x1="0" y1="40" x2="0" y2="72" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="0.6" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.26" />
          </linearGradient>
        </defs>
      </svg>
      {warming && !paused && (
        <span className="sr-only">warming up</span>
      )}
    </span>
  );
}
