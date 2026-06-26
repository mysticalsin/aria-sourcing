"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

/**
 * Accessible tab list. Arrow-key navigable, roving tabindex, aria-selected.
 * Controlled via `value` / `onValueChange`.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  className,
  idBase = "tab",
}: {
  items: TabItem[];
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  idBase?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    refs.current[next]?.focus();
    onValueChange(items[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label="Workspace sections"
      className={cn(
        "flex gap-1 overflow-x-auto no-scrollbar rounded-full bg-ink/[0.04] p-1",
        className,
      )}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${idBase}-${item.value}`}
            aria-selected={active}
            aria-controls={`${idBase}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all",
              active ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
            )}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-[0.6875rem] font-bold",
                  active ? "bg-ink/10 text-ink" : "bg-ink/5 text-muted",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  value,
  active,
  idBase = "tab",
  className,
  children,
}: {
  value: string;
  active: boolean;
  idBase?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-${value}`}
      tabIndex={0}
      className={cn("animate-fade-in focus:outline-none", className)}
    >
      {children}
    </div>
  );
}
