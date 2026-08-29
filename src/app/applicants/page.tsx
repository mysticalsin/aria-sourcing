"use client";

import Link from "next/link";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui";
import { ApplicantInbox } from "@/components/tania/applicant-inbox";
import { useHydrated } from "@/lib/store";
import { ExternalLink } from "lucide-react";

export default function ApplicantsPage() {
  const hydrated = useHydrated();
  return (
    <div>
      <PageHeader
        eyebrow="Candidate Intelligence · Applicant Screener"
        title="Applicant inbox"
        description="Scored applications from the career-site chatbox, ready for recruiter handoff. Aria proposes, you decide who advances."
        actions={
          <Link
            href="/careers"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-ink/15 bg-surface px-5 text-sm font-semibold text-ink transition hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> Open public chatbox
          </Link>
        }
      />
      <HydrationGate
        hydrated={hydrated}
        fallback={
          <EmptyState
            title="Loading applicants…"
            description="Applicant inbox appears after workspace hydrate — no placeholder rows."
          />
        }
      >
        <ApplicantInbox />
      </HydrationGate>
    </div>
  );
}
