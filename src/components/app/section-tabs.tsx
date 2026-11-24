"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { sectionTabsFor } from "./nav";

/** Tabs between pages that share one nav entry (Candidates, Reports). The
 *  shell renders them from the URL, so each page stays its own route. */
export function SectionTabs({ pathname }: { pathname: string }) {
  const tabs = sectionTabsFor(pathname);
  if (!tabs) return null;
  return (
    <nav aria-label="Views" className="-mx-1 mb-5 overflow-x-auto px-1 print:hidden">
      <ul className="flex w-max gap-1 rounded-2xl border border-line bg-surface p-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                  active ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
