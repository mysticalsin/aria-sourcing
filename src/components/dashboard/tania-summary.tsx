"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow, Button, Badge } from "@/components/ui";
import { SCORE_BANDS, SourceBadge, scoreBand } from "@/components/tania/badges";
import { useCandidates, useChatboxSubmissions } from "@/lib/store";
import { deriveLeadSource } from "@/lib/tania";
import { LEAD_SOURCES } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_BAR: Record<(typeof LEAD_SOURCES)[number], string> = {
  Applicant: "bg-electric",
  Referral: "bg-violet",
  Outbound: "bg-tangerine",
};

/** Home summary of the pipeline: inbound applicant queue, lead-source mix and
 *  match-score distribution. Reuses existing tokens — no new design language. */
export function TaniaSummary() {
  const candidates = useCandidates();
  const submissions = useChatboxSubmissions();

  const newApplicants = submissions.filter((s) => s.status === "new").length;

  const sourceCounts = React.useMemo(() => {
    const counts: Record<string, number> = { Applicant: 0, Referral: 0, Outbound: 0 };
    for (const c of candidates) counts[deriveLeadSource(c)] += 1;
    return counts;
  }, [candidates]);

  const bandCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of candidates) {
      const band = scoreBand(c.matchScore).id;
      counts[band] = (counts[band] ?? 0) + 1;
    }
    return counts;
  }, [candidates]);

  const total = candidates.length || 1;

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Sources & scores</CardTitle>
        <Link
          href="/funnel"
          className="inline-flex items-center gap-1 text-sm font-semibold text-electric hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          Pipeline <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardHeader>
      <CardBody className="space-y-5 pt-0">
        {/* Applicant inbox */}
        <Link
          href="/applicants"
          className="flex items-center justify-between rounded-2xl border border-line bg-canvas/60 p-3 transition hover:border-electric/30 hover:bg-electric-soft/40"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-electric-soft text-electric">
              <Inbox className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">Applicant inbox</span>
              <span className="block text-xs text-muted">Chatbox applications awaiting screening</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {newApplicants > 0 && <Badge tone="tangerine" size="sm">{newApplicants} new</Badge>}
            <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden />
          </span>
        </Link>

        {/* Source mix */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Lead source mix</p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink/[0.06]">
            {LEAD_SOURCES.map((s) => (
              <div
                key={s}
                className={cn(SOURCE_BAR[s], "h-full")}
                style={{ width: `${(sourceCounts[s] / total) * 100}%` }}
                title={`${s}: ${sourceCounts[s]}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LEAD_SOURCES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SourceBadge source={s} size="sm" showLabel={false} />
                <span className="text-xs text-muted">{s} {sourceCounts[s]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Match score bands: the one rating scale */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Match score</p>
          <div className="flex flex-wrap gap-2">
            {SCORE_BANDS.map((b) => (
              <span
                key={b.id}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ring-1 ring-inset", b.className)}
              >
                {b.label}
                <span className="tabular-nums">{bandCounts[b.id] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
