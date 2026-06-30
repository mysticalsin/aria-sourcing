"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";
import { HermesWordmark } from "./logo";
import { useIntegrations, useSettings } from "@/lib/store";
import { integrationHealthSummary } from "@/lib/integrations";
import { ShieldCheck, Activity } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const integrations = useIntegrations();
  const settings = useSettings();
  const health = integrationHealthSummary(integrations);

  const sections = ["Operate", "System"] as const;

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col sidebar-glass sticky top-0 h-screen">
      <div className="px-5 py-5">
        <Link href="/" className="flex justify-center rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric">
          <HermesWordmark />
        </Link>
        <a
          href="https://www.linkedin.com/in/tonywalteur/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 block text-center text-[0.65rem] font-medium tracking-wide text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          Created by Tony Walteur
        </a>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {sections.map((section) => (
          <div key={section} className="mb-5">
            <p className="eyebrow px-3 pb-2">{section}</p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((n) => n.section === section).map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all",
                        active
                          ? "bg-gradient-to-r from-electric/90 to-violet/80 text-white shadow-soft"
                          : "text-ink-soft hover:bg-violet/[0.06] hover:text-ink",
                      )}
                    >
                      <Icon className={cn("h-[18px] w-[18px]", active ? "text-mantu-yellow" : "text-muted group-hover:text-ink")} />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-violet/10 p-4 space-y-3">
        <div className="flex items-center justify-between rounded-2xl bg-violet/[0.06] border border-violet/[0.08] px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <Activity className="h-4 w-4 text-success" />
            Integrations
          </span>
          <span className="text-xs font-bold text-ink">
            {health.connected}/{health.total}
          </span>
        </div>
        {settings.dryRunMode && (
          <div className="flex items-center gap-2 rounded-2xl bg-tangerine-soft px-3 py-2.5 text-xs font-semibold text-tangerine">
            <ShieldCheck className="h-4 w-4" />
            Dry-run mode enabled
          </div>
        )}
      </div>
    </aside>
  );
}
