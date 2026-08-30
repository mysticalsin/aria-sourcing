"use client";

import Link from "next/link";
import { ArrowUpRight, Compass } from "lucide-react";
import { Badge, Card, Eyebrow } from "@/components/ui";
import { MiniFunnel } from "@/components/charts/mini-funnel";
import { useActions } from "@/lib/store";
import { campaignHealth, nextActionForCampaign } from "@/lib/rules";
import { cn, formatNumber, toneForUrgency, type Tone } from "@/lib/utils";
import type { Campaign, CampaignStatus } from "@/lib/types";

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  Intake: "neutral",
  Sourcing: "electric",
  Outreach: "tangerine",
  Interviewing: "violet",
  Closing: "aqua",
  Filled: "success",
  Paused: "warning",
};

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const { setActiveCampaign } = useActions();
  // Fail-soft: sparse remote campaigns can omit metrics before hydrate repair.
  const m = campaign.metrics ?? {
    sourced: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    booked: 0,
    interviewed: 0,
    offer: 0,
    hired: 0,
    notInterested: 0,
    replyRate: 0,
    avgMatchScore: 0,
    timeToFirstInterviewHours: null,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  };
  const health = campaignHealth(campaign);
  const nextAction = nextActionForCampaign(campaign);

  const counts: { label: string; value: number }[] = [
    { label: "Sourced", value: m.sourced },
    { label: "Contacted", value: m.contacted },
    { label: "Replied", value: m.replied },
    { label: "Booked", value: m.booked },
  ];

  return (
    <Card interactive className="group relative overflow-hidden p-0">
      <Link
        href={`/campaigns/${campaign.id}`}
        onClick={() => setActiveCampaign(campaign.id)}
        aria-label={`Open campaign ${campaign.title}`}
        className="block rounded-2xl p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{campaign.department}</Eyebrow>
            <h3 className="mt-1 truncate text-lg font-bold tracking-tight text-ink">
              {campaign.title}
            </h3>
          </div>
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-ink-soft transition-all duration-200 group-hover:bg-ink group-hover:text-paper"
            aria-hidden
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={toneForUrgency(campaign.urgency)} size="sm" dot>
            {campaign.urgency}
          </Badge>
          <Badge tone={STATUS_TONE[campaign.status]} size="sm">
            {campaign.status}
          </Badge>
          <Badge
            tone={health.tone}
            size="sm"
            dot
            title={health.detail}
            className="ml-auto"
          >
            {health.label}
          </Badge>
        </div>

        <div className="mt-5">
          <MiniFunnel metrics={m} />
        </div>

        <dl className="mt-5 grid grid-cols-4 gap-2">
          {counts.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl bg-canvas/60 px-2 py-2.5 text-center ring-1 ring-inset ring-line"
            >
              <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
                {c.label}
              </dt>
              <dd className="mt-0.5 text-lg font-extrabold tabular-nums text-ink">
                {formatNumber(c.value)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-sm">
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tangerine-soft text-tangerine",
            )}
            aria-hidden
          >
            <Compass className="h-3.5 w-3.5" />
          </span>
          <span className="text-muted">Next</span>
          <span className="truncate font-semibold text-ink">{nextAction}</span>
        </div>
      </Link>
    </Card>
  );
}
