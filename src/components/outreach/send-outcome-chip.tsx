"use client";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  classifySendOutcome,
  type SendOutcome,
  type SendOutcomeKind,
} from "@/lib/send-outcome";

const TONE: Record<
  SendOutcomeKind,
  "success" | "warning" | "danger" | "neutral" | "electric"
> = {
  dry_run: "warning",
  sent: "success",
  queued: "electric",
  authwall: "danger",
  refused_human_control: "warning",
  seat_cap: "warning",
  gap_wait: "neutral",
  business_hours: "neutral",
  session_unhealthy: "danger",
  error: "danger",
};

export function SendOutcomeChip(props: {
  dryRun?: boolean;
  status?: string;
  detail?: string;
  paceReason?: string;
  outcome?: SendOutcome;
  className?: string;
  showNextAction?: boolean;
}) {
  const outcome =
    props.outcome ??
    classifySendOutcome({
      dryRun: props.dryRun,
      status: props.status,
      detail: props.detail,
      paceReason: props.paceReason,
    });

  return (
    <div className={cn("space-y-1", props.className)}>
      <Badge tone={TONE[outcome.kind]} size="sm">
        {outcome.title}
      </Badge>
      <p className="text-xs text-muted">{outcome.detail}</p>
      {props.showNextAction !== false && outcome.nextAction ? (
        <p className="text-xs font-medium text-ink-soft">Next: {outcome.nextAction}</p>
      ) : null}
    </div>
  );
}
