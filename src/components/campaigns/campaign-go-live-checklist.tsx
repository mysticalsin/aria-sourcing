"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Circle, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  evaluateCampaignGoLive,
  mergeDurableCampaignSeatsForGoLive,
  type ComputerHealthLike,
  type DurableCampaignSeatLike,
  type GoLiveCheck,
} from "@/lib/campaign-go-live";
import type { AgentSeat, Candidate, SystemSettings } from "@/lib/types";

export function CampaignGoLiveChecklist(props: {
  campaignId: string;
  settings: Pick<SystemSettings, "dryRunMode" | "minScoreToContact">;
  seats: AgentSeat[];
  computers?: ComputerHealthLike[];
  candidate?: Pick<Candidate, "matchScore"> | null;
  className?: string;
  compact?: boolean;
}) {
  const [polledComputers, setPolledComputers] = React.useState<ComputerHealthLike[]>([]);
  const [durableSeats, setDurableSeats] = React.useState<DurableCampaignSeatLike[] | undefined>();
  React.useEffect(() => {
    if (props.computers) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/fleet/computers?campaignId=${encodeURIComponent(props.campaignId)}`,
          { credentials: "same-origin" },
        );
        if (cancelled) return;
        if (!res.ok) {
          // Fail closed: empty fleet poll — Hermes twin alone must not green attach.
          setPolledComputers([]);
          return;
        }
        const data = (await res.json()) as {
          computers?: ComputerHealthLike[];
          campaignSeats?: DurableCampaignSeatLike[];
        };
        const comps = data.computers ?? [];
        // Scope to durable campaign seats when Fleet returns them — never paint
        // foreign desk health into this campaign's go-live checklist.
        const authIds = Array.isArray(data.campaignSeats)
          ? new Set(data.campaignSeats.map((s) => s.id))
          : null;
        const scoped = authIds
          ? comps.filter((c) => c.seatId && authIds.has(c.seatId))
          : comps.filter((c) => {
              const seat = props.seats.find((s) => s.id === c.seatId);
              return Boolean(
                seat &&
                  (seat.assignedCampaignIds ?? []).includes(props.campaignId),
              );
            });
        if (!cancelled) {
          setPolledComputers(scoped);
          if (Array.isArray(data.campaignSeats)) {
            setDurableSeats(data.campaignSeats);
          }
        }
      } catch {
        if (!cancelled) setPolledComputers([]);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [props.campaignId, props.computers, props.seats]);

  // props.computers wins; otherwise fail-closed [] until/after poll (never undefined Hermes-only path).
  const computers = props.computers ?? polledComputers;
  const seatsForEval = React.useMemo(
    () => mergeDurableCampaignSeatsForGoLive(props.seats, durableSeats, props.campaignId),
    [props.seats, durableSeats, props.campaignId],
  );
  const { ready, checks, nextAction } = React.useMemo(
    () =>
      evaluateCampaignGoLive({
        campaignId: props.campaignId,
        settings: props.settings,
        seats: seatsForEval,
        computers,
        candidate: props.candidate,
      }),
    [props.campaignId, props.settings, seatsForEval, computers, props.candidate],
  );

  return (
    <Card
      className={cn(
        "border",
        ready ? "border-success/30 bg-success-soft/20" : "border-warning/30 bg-warning-soft/15",
        props.className,
      )}
    >
      <CardContent className={cn("space-y-3", props.compact && "py-3")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {ready ? (
              <Check className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            )}
            <p className="text-sm font-semibold text-ink">
              {ready ? "Ready to go live" : "Go-live checklist"}
            </p>
            <Badge tone={ready ? "success" : "warning"} size="sm">
              {checks.filter((c) => c.ok).length}/{checks.length}
            </Badge>
          </div>
          {nextAction?.ctaHref && nextAction.ctaLabel ? (
            <Link href={nextAction.ctaHref}>
              <Button size="sm" variant="secondary">
                {nextAction.ctaLabel}
              </Button>
            </Link>
          ) : null}
        </div>
        {!props.compact ? (
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <GoLiveRow key={c.id} check={c} />
            ))}
          </ul>
        ) : null}
        {props.compact && nextAction ? (
          <p className="text-xs text-muted">{nextAction.detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GoLiveRow({ check }: { check: GoLiveCheck }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {check.ok ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      )}
      <div className="min-w-0">
        <p className={cn("font-medium", check.ok ? "text-ink-soft" : "text-ink")}>{check.label}</p>
        <p className="text-xs text-muted">{check.detail}</p>
      </div>
    </li>
  );
}
