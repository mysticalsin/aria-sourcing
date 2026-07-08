"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Badge, Card, CardBody, CardHeader, CardTitle, Eyebrow } from "@/components/ui";
import { useCampaigns, useOutreach } from "@/lib/store";
import { useCountUp } from "@/components/reveal/use-count-up";
import type { Campaign } from "@/lib/types";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export interface WarRoomLane {
  campaignId: string;
  /** True while this role's sourcing waves are still in flight. Presentation
   *  only — the sourced COUNT always comes from the campaign's real metrics,
   *  never from this flag. */
  sourcing: boolean;
}

export interface WarRoomBoardProps {
  lanes: WarRoomLane[];
  className?: string;
}

/**
 * One lane per launched role, each reading its live sourced count straight off
 * the real store (`useCampaigns()` — `campaign.metrics.sourced`, the same
 * number `recomputeMetrics` derives from that campaign's actual candidates).
 * Nothing here is a fake incrementer: the climb the user sees is the real
 * store committing real (synthetic, offline) candidates batch by batch.
 */
export function WarRoomBoard({ lanes, className }: WarRoomBoardProps) {
  const campaigns = useCampaigns();
  const outreach = useOutreach();
  const reducedMotion = usePrefersReducedMotion();

  const campaignById = React.useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const resolved = React.useMemo(
    () =>
      lanes
        .map((lane) => ({ lane, campaign: campaignById.get(lane.campaignId) }))
        .filter((x): x is { lane: WarRoomLane; campaign: Campaign } => Boolean(x.campaign)),
    [lanes, campaignById],
  );
  const campaignIdSet = React.useMemo(() => new Set(lanes.map((l) => l.campaignId)), [lanes]);

  const totalSourced = resolved.reduce((sum, { campaign }) => sum + campaign.metrics.sourced, 0);
  const totalSent = outreach.filter((m) => campaignIdSet.has(m.campaignId) && m.sentAt).length;
  const anySourcing = lanes.some((l) => l.sourcing);
  const displaySourced = useCountUp(totalSourced, { durationMs: 700 });

  if (resolved.length === 0) return null;

  return (
    <div className={className}>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Eyebrow>War room</Eyebrow>
            <CardTitle className="mt-1">
              {Math.round(displaySourced)} sourced across {resolved.length} role
              {resolved.length === 1 ? "" : "s"}, {totalSent} sent, awaiting approval
            </CardTitle>
          </div>
          <Badge tone={anySourcing ? "electric" : "success"} dot className="shrink-0">
            {anySourcing ? "Sourcing live" : "All lanes ready"}
          </Badge>
        </CardHeader>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {resolved.map(({ lane, campaign }, index) => (
          <LaneCard
            key={campaign.id}
            campaign={campaign}
            sourcing={lane.sourcing}
            index={index}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
    </div>
  );
}

function LaneCard({
  campaign,
  sourcing,
  index,
  reducedMotion,
}: {
  campaign: Campaign;
  sourcing: boolean;
  index: number;
  reducedMotion: boolean;
}) {
  const displaySourced = useCountUp(campaign.metrics.sourced, { durationMs: 700 });
  const skills = campaign.jobAnalysis.requiredSkills.slice(0, 3).join(", ");

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.36, delay: reducedMotion ? 0 : index * 0.07, ease: "easeOut" }}
      className="h-full"
    >
      <Card className="h-full">
        <CardHeader className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow className="truncate">{campaign.department}</Eyebrow>
            <CardTitle className="mt-1 truncate text-lg" title={campaign.title}>
              {campaign.title}
            </CardTitle>
          </div>
          <Badge tone={sourcing ? "electric" : "success"} size="sm" dot className="shrink-0">
            {sourcing ? "Sourcing…" : "Ready"}
          </Badge>
        </CardHeader>
        <CardBody className="pt-0">
          <div className="flex items-baseline gap-2">
            <span
              className="text-4xl font-extrabold tabular-nums text-ink"
              aria-label={`${campaign.metrics.sourced} sourced`}
            >
              {Math.round(displaySourced)}
            </span>
            <span className="text-sm text-muted">sourced</span>
          </div>
          <p className="mt-1.5 truncate text-xs text-muted" title={skills}>
            {campaign.jobAnalysis.seniority} · {campaign.jobAnalysis.locationType}
            {skills ? ` · ${skills}` : ""}
          </p>
        </CardBody>
      </Card>
    </motion.div>
  );
}
