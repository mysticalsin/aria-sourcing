"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, RotateCcw, ShieldCheck, Check, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandSearch } from "./command-search";
import { HermesWordmark } from "./logo";
import {
  useActions,
  useActiveCampaign,
  useCampaigns,
  useDashboardKpis,
  useSettings,
} from "@/lib/store";
import { useToast } from "@/components/ui";
import { supabaseEnabled } from "@/lib/supabase/config";
import { getCurrentUser, type CurrentUser } from "@/lib/supabase/workspace";

export function TopBar() {
  const router = useRouter();
  const campaigns = useCampaigns();
  const active = useActiveCampaign();
  const kpis = useDashboardKpis();
  const settings = useSettings();
  const { setActiveCampaign, resetDemo } = useActions();
  const { toast } = useToast();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [userOpen, setUserOpen] = React.useState(false);
  const [authUser, setAuthUser] = React.useState<CurrentUser | null>(null);

  React.useEffect(() => {
    if (supabaseEnabled) getCurrentUser().then(setAuthUser);
  }, []);

  const displayName = authUser?.name ?? settings.operatorName;
  const displayInitials = displayName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const notifications = [
    kpis.pendingApprovals > 0 && {
      label: `${kpis.pendingApprovals} outreach drafts awaiting approval`,
      href: "/outreach",
    },
    kpis.hotReplies > 0 && { label: `${kpis.hotReplies} hot replies within SLA`, href: "/replies" },
    kpis.awaitingBooking > 0 && {
      label: `${kpis.awaitingBooking} interested candidates to book`,
      href: "/calendar",
    },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="lg:hidden">
          <HermesWordmark compact />
        </Link>

        <div className="hidden flex-1 sm:block">
          <CommandSearch />
        </div>

        {/* Active campaign switcher */}
        {campaigns.length > 0 && (
          <div className="relative hidden md:block">
            <label htmlFor="campaign-switcher" className="sr-only">
              Active campaign
            </label>
            <select
              id="campaign-switcher"
              value={active?.id ?? ""}
              onChange={(e) => setActiveCampaign(e.target.value)}
              className="h-10 max-w-[200px] appearance-none truncate rounded-full border border-ink/12 bg-surface pl-4 pr-9 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
        )}

        <span
          className="hidden items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-xs font-bold text-success lg:inline-flex"
          title="Human approval gate is on"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {settings.humanApprovalGate ? "Approval gate ON" : "Gate OFF"}
        </span>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen((o) => !o);
              setUserOpen(false);
            }}
            aria-label={`Notifications (${notifications.length})`}
            aria-expanded={notifOpen}
            className="relative rounded-full p-2.5 text-ink-soft hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
          >
            <Bell className="h-5 w-5" />
            {notifications.length > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-tangerine ring-2 ring-paper" />
            )}
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} aria-hidden />
              <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-3xl border border-line bg-paper shadow-lift animate-scale-in">
                <p className="border-b border-line px-4 py-3 text-sm font-bold text-ink">Attention needed</p>
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">All clear. Nothing needs you.</p>
                ) : (
                  <ul className="p-2">
                    {notifications.map((n, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            router.push(n.href);
                            setNotifOpen(false);
                          }}
                          className="flex w-full items-start gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-ink/5"
                        >
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-tangerine" />
                          {n.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => {
              setUserOpen((o) => !o);
              setNotifOpen(false);
            }}
            aria-label="User menu"
            aria-expanded={userOpen}
            className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-electric text-sm font-bold text-white">
              {displayInitials}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
          </button>
          {userOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} aria-hidden />
              <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-3xl border border-line bg-paper shadow-lift animate-scale-in">
                <div className="border-b border-line px-4 py-3">
                  <p className="truncate text-sm font-bold text-ink">{displayName}</p>
                  <p className="truncate text-xs text-muted">{authUser?.email ?? "Sourcing Operator"}</p>
                </div>
                <div className="p-2">
                  <Link
                    href="/settings"
                    onClick={() => setUserOpen(false)}
                    className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-ink-soft hover:bg-ink/5"
                  >
                    <ShieldCheck className="h-4 w-4" /> Settings & compliance
                  </Link>
                  <button
                    onClick={() => {
                      resetDemo();
                      setUserOpen(false);
                      toast({ title: "Demo reset", description: "Workspace seed restored.", variant: "success" });
                      router.push("/");
                    }}
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-ink/5"
                  >
                    <RotateCcw className="h-4 w-4" /> Reset demo data
                  </button>
                  {supabaseEnabled && (
                    <a
                      href="/auth/signout"
                      className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-danger hover:bg-danger-soft"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-muted">
                  <Check className="h-3.5 w-3.5 text-success" /> Synthetic data · dry-run
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile search row */}
      <div className="px-4 pb-3 sm:hidden">
        <CommandSearch />
      </div>
    </header>
  );
}
