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
import { useToast, useConfirm } from "@/components/ui";
import { supabaseEnabled } from "@/lib/supabase/config";
import { getCurrentUser, type CurrentUser } from "@/lib/supabase/workspace";

/**
 * Keyboard handler shared by both dropdown menus.
 * Escape closes the menu and restores focus to the trigger.
 * ArrowDown/ArrowUp cycle focus among role="menuitem" descendants.
 */
function menuKeyHandler(
  e: React.KeyboardEvent<HTMLDivElement>,
  close: () => void,
  triggerRef: React.RefObject<HTMLButtonElement | null>
) {
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')
  );
  const idx = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    triggerRef.current?.focus();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    items[(idx + 1) % items.length]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    items[(idx - 1 + items.length) % items.length]?.focus();
  }
}

export function TopBar() {
  const router = useRouter();
  const campaigns = useCampaigns();
  const active = useActiveCampaign();
  const kpis = useDashboardKpis();
  const settings = useSettings();
  const { setActiveCampaign, resetDemo } = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [userOpen, setUserOpen] = React.useState(false);
  const [authUser, setAuthUser] = React.useState<CurrentUser | null>(null);

  // Refs for trigger buttons (focus restoration on close) and menu panels (focus-in on open).
  const notifTriggerRef = React.useRef<HTMLButtonElement>(null);
  const notifMenuRef = React.useRef<HTMLDivElement>(null);
  const userTriggerRef = React.useRef<HTMLButtonElement>(null);
  const userMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (supabaseEnabled) getCurrentUser().then(setAuthUser);
  }, []);

  // Move focus to the first menuitem when the notification panel opens.
  // Fall back to the panel itself (tabIndex=-1) when the list is empty.
  React.useEffect(() => {
    if (notifOpen && notifMenuRef.current) {
      const first = notifMenuRef.current.querySelector<HTMLElement>('[role="menuitem"]');
      (first ?? notifMenuRef.current).focus();
    }
  }, [notifOpen]);

  // Move focus to the first menuitem when the user panel opens.
  React.useEffect(() => {
    if (userOpen && userMenuRef.current) {
      const first = userMenuRef.current.querySelector<HTMLElement>('[role="menuitem"]');
      (first ?? userMenuRef.current).focus();
    }
  }, [userOpen]);

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
    <header className="sticky top-0 z-40 topbar-glass">
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
              className="h-10 max-w-[200px] appearance-none truncate rounded-full border border-violet/10 bg-surface/80 backdrop-blur-sm pl-4 pr-9 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
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
          className="hidden items-center gap-1.5 rounded-full bg-success-soft/80 px-3 py-1.5 text-xs font-bold text-success ring-1 ring-success/15 lg:inline-flex"
          title="Human approval gate is on"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {settings.humanApprovalGate ? "Approval gate ON" : "Gate OFF"}
        </span>

        {/* Notifications */}
        <div className="relative">
          <button
            ref={notifTriggerRef}
            onClick={() => {
              setNotifOpen((o) => !o);
              setUserOpen(false);
            }}
            aria-label={`Notifications (${notifications.length})`}
            aria-expanded={notifOpen}
            aria-haspopup="menu"
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
              <div
                ref={notifMenuRef}
                role="menu"
                aria-label="Notifications"
                tabIndex={-1}
                onKeyDown={(e) => menuKeyHandler(e, () => setNotifOpen(false), notifTriggerRef)}
                className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-3xl glass-dropdown animate-scale-in"
              >
                <p className="border-b border-violet/10 px-4 py-3 text-sm font-bold text-ink">Attention needed</p>
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">All clear. Nothing needs you.</p>
                ) : (
                  <ul className="p-2">
                    {notifications.map((n, i) => (
                      <li key={i}>
                        <button
                          role="menuitem"
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
            ref={userTriggerRef}
            onClick={() => {
              setUserOpen((o) => !o);
              setNotifOpen(false);
            }}
            aria-label="User menu"
            aria-expanded={userOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full gradient-purple text-sm font-bold text-white shadow-soft">
              {displayInitials}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
          </button>
          {userOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} aria-hidden />
              <div
                ref={userMenuRef}
                role="menu"
                aria-label="Account menu"
                tabIndex={-1}
                onKeyDown={(e) => menuKeyHandler(e, () => setUserOpen(false), userTriggerRef)}
                className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-3xl glass-dropdown animate-scale-in"
              >
                <div className="border-b border-violet/10 px-4 py-3">
                  <p className="truncate text-sm font-bold text-ink">{displayName}</p>
                  <p className="truncate text-xs text-muted">{authUser?.email ?? "Sourcing Operator"}</p>
                </div>
                <div className="p-2">
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setUserOpen(false)}
                    className="flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-ink-soft hover:bg-ink/5"
                  >
                    <ShieldCheck className="h-4 w-4" /> Settings & compliance
                  </Link>
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setUserOpen(false);
                      const ok = await confirm({
                        title: "Reset workspace to defaults?",
                        description:
                          "This discards all local changes and restores the workspace to factory defaults. This can't be undone.",
                        confirmLabel: "Reset",
                        danger: true,
                      });
                      if (!ok) return;
                      resetDemo();
                      toast({ title: "Reset to defaults", description: "Workspace restored to factory defaults.", variant: "success" });
                      // Full reload (not router.push) so the seeded in-memory state is
                      // discarded before any debounced persist can overwrite a live
                      // shared workspace. In live mode this re-hydrates from Supabase.
                      window.location.href = "/";
                    }}
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-ink/5"
                  >
                    <RotateCcw className="h-4 w-4" /> Reset to defaults
                  </button>
                  {supabaseEnabled && (
                    <a
                      href="/auth/signout"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-danger hover:bg-danger-soft"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5 border-t border-violet/10 px-4 py-2.5 text-xs text-muted">
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
