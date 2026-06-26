import * as React from "react";
import { cn, type Tone } from "@/lib/utils";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-soft ring-ink/10",
  tangerine: "bg-tangerine-soft text-tangerine ring-tangerine/20",
  electric: "bg-electric-soft text-electric ring-electric/20",
  aqua: "bg-aqua-soft text-aqua ring-aqua/20",
  violet: "bg-violet-soft text-violet ring-violet/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-[hsl(32_90%_34%)] ring-warning/30",
  danger: "bg-danger-soft text-danger ring-danger/20",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  size?: "sm" | "md";
}

export function Badge({ className, tone = "neutral", dot, size = "md", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold ring-1 ring-inset rounded-full whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}
