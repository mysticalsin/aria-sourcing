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
        "flex gap-1 overflow-x-auto no-scrollbar rounded-full bg-violet/[0.05] p-1 ring-1 ring-inset ring-violet/[0.08]",
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
              active
                ? "bg-surface/90 text-ink shadow-soft ring-1 ring-inset ring-violet/10"
                : "text-muted hover:text-ink hover:bg-violet/[0.05]",
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
  // Mount-once-keep-mounted: a panel's children only render once the panel
  // has been visited at least once, and stay mounted after that (so in-panel
  // state, e.g. a filter or an in-progress form, survives switching tabs).
  // Panels never visited never render their (often heavy) subtree at all —
  // this is what keeps first paint cheap on tab-heavy pages.
  const [hasBeenActive, setHasBeenActive] = React.useState(active);
  React.useEffect(() => {
    if (active) setHasBeenActive(true);
  }, [active]);

  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-${value}`}
      tabIndex={active ? 0 : -1}
      hidden={!active}
      className={cn(active && "animate-fade-in", "focus:outline-none", className)}
    >
      {hasBeenActive && children}
    </div>
  );
}
