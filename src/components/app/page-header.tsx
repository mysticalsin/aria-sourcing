"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2 block">{eyebrow}</Eyebrow>}
        <h1 className="display text-3xl sm:text-4xl text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[0.95rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Renders a skeleton until the client store hydrates, preventing layout flash. */
export function HydrationGate({
  hydrated,
  fallback,
  children,
}: {
  hydrated: boolean;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!hydrated) return <>{fallback}</>;
  return <>{children}</>;
}
