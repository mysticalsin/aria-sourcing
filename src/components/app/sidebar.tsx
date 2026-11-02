"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, NAV_SECTIONS, NEW_CAMPAIGN_HREF, isNavActive, type NavItem } from "./nav";
import { HermesLockup } from "./logo";
import { useIntegrations } from "@/lib/store";
import { integrationCounts } from "@/lib/integrations";
import { Activity, Plus } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const integrations = useIntegrations();
  const health = integrationCounts(integrations);

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col sidebar-glass sticky top-0 h-screen print:!hidden">
      {/* Horizontal lockup: the whole nav fits a 900px-high screen. */}
      <div className="px-5 pb-3 pt-4">
        <Link
          href="/"
          className="block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
        >
          <HermesLockup />
        </Link>
        <Link
          href={NEW_CAMPAIGN_HREF}
          aria-current={pathname === NEW_CAMPAIGN_HREF ? "page" : undefined}
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-tangerine px-3 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-tangerine/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New campaign
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Primary">
        <ul className="mb-3">
          {NAV_ITEMS.filter((n) => n.section === "Home").map((item) => (
            <SidebarLink key={item.href} item={item} active={isNavActive(item, pathname)} />
          ))}
        </ul>
        {NAV_SECTIONS.map((section) => (
          <div key={section} className="mb-3">
            <p className="eyebrow px-3 pb-1">{section}</p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((n) => n.section === section).map((item) => (
                <SidebarLink key={item.href} item={item} active={isNavActive(item, pathname)} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-violet/10 p-3">
        <Link
          href="/settings#integrations"
          title={`${health.live} live, ${health.simulated} simulated, ${health.notConfigured} not configured, of ${health.total} built integrations`}
          className="flex items-center justify-between rounded-2xl bg-violet/[0.06] border border-violet/[0.08] px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <Activity className={cn("h-4 w-4", health.live > 0 ? "text-success" : "text-muted")} aria-hidden />
            Integrations
          </span>
          <span className="text-xs font-bold text-ink">
            {health.live}/{health.total} live
            <span className="sr-only">, {health.simulated} simulated</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold transition-all",
          active
            ? "bg-violet/[0.10] text-ink"
            : "text-ink-soft hover:bg-violet/[0.06] hover:text-ink",
        )}
      >
        <Icon className={cn("h-[18px] w-[18px]", active ? "text-violet" : "text-muted group-hover:text-ink")} />
        <span className="flex-1">{item.label}</span>
      </Link>
    </li>
  );
}
