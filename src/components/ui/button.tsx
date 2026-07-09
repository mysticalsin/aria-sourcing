"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle" | "gradient";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-paper hover:bg-ink/90 shadow-soft",
  secondary:
    "bg-tangerine text-white hover:bg-tangerine/90 shadow-soft",
  outline:
    "border border-ink/15 bg-surface text-ink hover:bg-canvas",
  ghost: "text-ink hover:bg-ink/5",
  subtle: "bg-ink/5 text-ink hover:bg-ink/10",
  danger: "bg-danger text-white hover:bg-danger/90 shadow-soft",
  gradient:
    "bg-gradient-to-br from-electric to-violet text-white hover:from-tangerine hover:to-violet shadow-glow-purple",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-full",
  md: "h-11 px-5 text-sm gap-2 rounded-full",
  lg: "h-12 px-7 text-base gap-2 rounded-full",
  icon: "h-10 w-10 rounded-full justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, leftIcon, rightIcon, children, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center font-semibold transition-[transform,background-color,color,opacity] duration-150 ease-motion-out select-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
          "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97]",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : leftIcon}
        {size !== "icon" && children}
        {!loading && rightIcon}
      </button>
    );
  },
);
Button.displayName = "Button";
