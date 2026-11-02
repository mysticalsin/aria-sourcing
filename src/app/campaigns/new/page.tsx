"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { SingleRoleIntake } from "@/components/campaigns/single-role-intake";
import { MultiRoleLaunch } from "@/components/campaigns/multi-role-launch";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

/** The single place to create campaigns: one role from an email and a job
 *  description, or several roles from one brief. /intake and /launch redirect
 *  here (next.config.mjs). */
export default function NewCampaignPage() {
  return (
    <React.Suspense fallback={null}>
      <NewCampaign />
    </React.Suspense>
  );
}

const MODES = [
  { id: "one", label: "One role", href: "/campaigns/new" },
  { id: "several", label: "Several roles", href: "/campaigns/new?roles=several" },
] as const;

function NewCampaign() {
  const several = useSearchParams().get("roles") === "several";
  return (
    <div>
      <PageHeader
        eyebrow="Recruit"
        title="New campaign"
        description={
          several
            ? supabaseEnabled
              ? "Create one campaign per role, then review each source plan before searching."
              : "Paste a brief with several roles. Aria creates one campaign per role and sources them in parallel."
            : "Paste a hiring request. Aria turns it into an editable brief, then starts a sourcing campaign."
        }
      />
      <nav aria-label="Campaign type" className="mb-6">
        <ul className="flex w-max gap-1 rounded-2xl border border-line bg-surface p-1">
          {MODES.map((mode) => {
            const active = (mode.id === "several") === several;
            return (
              <li key={mode.id}>
                <Link
                  href={mode.href}
                  replace
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                    active ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
                  )}
                >
                  {mode.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {several ? <MultiRoleLaunch /> : <SingleRoleIntake />}
    </div>
  );
}
