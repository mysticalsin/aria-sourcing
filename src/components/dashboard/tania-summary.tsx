"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow, Button, Badge } from "@/components/ui";
import { SourceBadge, StarBadge } from "@/components/tania/badges";
import { useCandidates, useChatboxSubmissions, useSettings } from "@/lib/store";
import { deriveLeadSource, deriveStarRating, DEFAULT_STAR_THRESHOLDS } from "@/lib/tania";
import { LEAD_SOURCES, STAR_RATINGS } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_BAR: Record<(typeof LEAD_SOURCES)[number], string> = {
  Applicant: "bg-electric",
  Referral: "bg-violet",
  Outbound: "bg-tangerine",
};

/** Command-center summary of the TAnIA layer: inbound applicant queue, lead-source
 *  mix and star-tier distribution. Reuses existing tokens — no new design language. */
export function TaniaSummary() {
  const candidates = useCandidates();
  const submissions = useChatboxSubmissions();
  const thresholds = useSettings().starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;

  const newApplicants = submissions.filter((s) => s.status === "new").length;

  const sourceCounts = React.useMemo(() => {
    const counts: Record<string, number> = { Applicant: 0, Referral: 0, Outbound: 0 };
    for (const c of candidates) counts[deriveLeadSource(c)] += 1;
    return counts;
  }, [candidates]);

  const starCounts = React.useMemo(() => {
    const counts: Record<string, number> = { TopGun: 0, A: 0, B: 0, C: 0, D: 0 };
    for (const c of candidates) counts[c.starRating ?? deriveStarRating(c.matchScore, thresholds)] += 1;
    return counts;
  }, [candidates, thresholds]);

  const total = candidates.length || 1;

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex items-center justify-between">
        <div>
          <Eyebrow>TAnIA pipeline</Eyebrow>
          <CardTitle className="mt-1">Sources & ratings</CardTitle>
        </div>
        <Link
          href="/funnel"
          className="inline-flex items-center gap-1 text-sm font-semibold text-electric hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          Funnel <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
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

        {/* Star tiers */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Star rating distribution</p>
          <div className="flex flex-wrap gap-2">
            {STAR_RATINGS.map((r) => (
              <span key={r} className="inline-flex items-center gap-1">
                <StarBadge rating={r} size="sm" showLabel={false} />
                <span className="text-xs font-semibold tabular-nums text-ink-soft">{starCounts[r]}</span>
              </span>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
