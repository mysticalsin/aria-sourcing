"use client";

import * as React from "react";
import { Card, Badge, Button, useToast } from "@/components/ui";
import { useCandidate, useActions } from "@/lib/store";
import {
  cn,
  toneForIntent,
  formatCountdown,
  formatPercent,
  formatTimeAgo,
} from "@/lib/utils";
import type { ClassifiedReply, ReplyIntent } from "@/lib/types";
import {
  Clock,
  CheckCheck,
  CornerUpRight,
  ShieldAlert,
  User,
} from "lucide-react";

const INTENT_LABELS: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  QUALIFIED_INTEREST: "Qualified interest",
  NOT_INTERESTED: "Not interested",
  REFERRAL: "Referral",
  OOO: "Out of office",
  UNCLEAR: "Unclear",
  NEGATIVE: "Negative",
};

const HOT_INTENTS: ReplyIntent[] = ["INTERESTED", "QUALIFIED_INTEREST"];

export function ReplyCard({ reply }: { reply: ClassifiedReply }) {
  const candidate = useCandidate(reply.candidateId);
  const a = useActions();
  const { toast } = useToast();

  // Live SLA tick — only after mount to avoid hydration drift.
  const [now, setNow] = React.useState<number | null>(null);
  const isHot = HOT_INTENTS.includes(reply.intent);
  const showSla = Boolean(reply.slaDueAt) && isHot && !reply.handled;

  React.useEffect(() => {
    if (!showSla) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [showSla]);

  const countdown =
    showSla && reply.slaDueAt && now != null
      ? formatCountdown(reply.slaDueAt, now)
      : null;

  const candidateName = candidate?.name ?? "Unlinked candidate";

  function handleApply() {
    a.applyReplyAction(reply.id);
    toast({
      title: "Action applied",
      description: reply.suggestedAction,
      variant: "success",
    });
  }

  function handleHandled() {
    a.markReplyHandled(reply.id);
    toast({ title: "Marked as handled", variant: "info" });
  }

  return (
    <Card className={cn("p-5 animate-fade-in", reply.handled && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneForIntent(reply.intent)} dot>
            {INTENT_LABELS[reply.intent]}
          </Badge>
          <Badge tone="neutral" size="sm">
            {formatPercent(reply.confidence)} confidence
          </Badge>
          <Badge tone="neutral" size="sm">
            {reply.channel}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {countdown && (
            <Badge tone={countdown.overdue ? "danger" : "warning"} size="sm" dot>
              <Clock className="h-3 w-3" aria-hidden />
              {countdown.label}
            </Badge>
          )}
          {reply.handled && (
            <Badge tone="neutral" size="sm">
              <CheckCheck className="h-3 w-3" aria-hidden />
              Handled
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <User className="h-3.5 w-3.5 text-muted" aria-hidden />
        {candidateName}
        <span className="ml-1 text-xs font-normal text-muted">
          · {formatTimeAgo(reply.receivedAt)}
        </span>
      </div>

      <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-soft line-clamp-3">
        {reply.body}
      </blockquote>

      <p className="mt-3 text-sm text-muted">
        <span className="font-semibold text-ink-soft">Suggested: </span>
        {reply.suggestedAction}
      </p>

      {reply.intent === "NEGATIVE" && (
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-danger">Stop outreach &amp; escalate</p>
            <p className="text-xs text-danger/80">
              Suppress this candidate immediately and remove them from all sequences.
            </p>
          </div>
        </div>
      )}

      {!reply.handled && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<CornerUpRight className="h-3.5 w-3.5" aria-hidden />}
            onClick={handleApply}
          >
            Apply action
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
            onClick={handleHandled}
          >
            Mark handled
          </Button>
        </div>
      )}
    </Card>
  );
}
