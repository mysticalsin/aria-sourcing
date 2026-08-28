"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ConfirmProvider } from "@/components/ui";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { MOBILE_NAV } from "./nav";
import { Onboarding } from "./onboarding";
import { WorkspaceStatusPanel } from "./workspace-status-panel";
import { useHermes } from "@/lib/store";
import { workspaceBlocksProduct } from "@/lib/workspace-status";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Auth screens and public candidate/marketing surfaces render full-bleed,
  // without the recruiter console chrome.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/careers") ||
    pathname.startsWith("/hub") ||
    pathname.startsWith("/product") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/unsubscribe")
  ) {
    return <>{children}</>;
  }

  return <ProtectedAppShell pathname={pathname}>{children}</ProtectedAppShell>;
}

function ProtectedAppShell({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const { workspaceStatus, retryWorkspace, retrySave } = useHermes();

  // Loading: paint recruiter chrome + page children immediately. Pages use
  // HydrationGate skeletons — do NOT replace the main column with a blocking
  // "Refreshing workspace…" wait (that was the ~7s hard-reload dead zone).
  // Mutations stay blocked via workspaceAllowsMutation until phase === ready.
  if (workspaceStatus.phase === "loading") {
    return (
      <ConfirmProvider>
        <div className="flex min-h-screen max-w-full overflow-x-hidden">
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div
              className="border-b border-line/60 bg-paper/80 px-4 py-1.5 text-center text-xs text-muted sm:px-6 lg:px-8"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              {workspaceStatus.mode === "demo"
                ? "Refreshing demo workspace…"
                : "Refreshing workspace…"}
            </div>
            <main id="main-content" className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
              <div className="mx-auto w-full max-w-[1400px]">{children}</div>
            </main>
          </div>
        </div>
      </ConfirmProvider>
    );
  }

  if (workspaceBlocksProduct(workspaceStatus)) {
    return (
      <WorkspaceStatusPanel
        status={workspaceStatus}
        onRetryWorkspace={retryWorkspace}
        onRetrySave={retrySave}
      />
    );
  }

  return (
    <ConfirmProvider>
    <div className="flex min-h-screen max-w-full overflow-x-hidden">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main-content" className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-violet/10 bg-paper/85 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
        aria-label="Primary mobile"
      >
        {MOBILE_NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 text-[0.625rem] font-semibold transition",
                active ? "text-ink" : "text-muted",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "text-tangerine")} />
              {item.label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>

      {/* First-run guided tour (shows once per browser) */}
      <Onboarding />
    </div>
    </ConfirmProvider>
  );
}
