import * as React from "react";
import { cn } from "@/lib/utils";

/** Initials on a gradient picked from the name: the same person keeps the same colour. */
export function Avatar({
  name,
  size = "md",
  unread,
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  unread?: boolean;
  className?: string;
}) {
  const initials =
    name
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const dims = size === "sm" ? "h-8 w-8 text-[0.7rem]" : size === "lg" ? "h-11 w-11 text-sm" : "h-10 w-10 text-xs";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn("inline-flex items-center justify-center rounded-full font-bold text-white shadow-sm", dims)}
        style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 72% 46%))` }}
      >
        {initials}
      </span>
      {unread && (
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-[#0a66c2]" aria-label="Unread" />
      )}
    </span>
  );
}
