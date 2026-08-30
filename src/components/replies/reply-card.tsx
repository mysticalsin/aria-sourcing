"use client";

import * as React from "react";
import { Card, Badge, Button, useToast } from "@/components/ui";
import { useCandidate, useCampaign, useActions, useSettings } from "@/lib/store";
import { maskEmailBody } from "@/lib/confidential";
import {
  cn,
  toneForIntent,
  formatCountdown,
  formatPercent,
  formatTimeAgo,
} from "@/lib/utils";
import type { ClassifiedReply } from "@/lib/types";
import {
  HOT_REPLY_INTENTS,
  REPLY_INTENT_LABELS,
} from "@/lib/reply-intents";
import {
  Clock,
  CheckCheck,
  CornerUpRight,
  ShieldAlert,
  User,
  Eye,
  EyeOff,
  Send,
  ChevronDown,
} from "lucide-react";

export function ReplyCard({ reply }: { reply: ClassifiedReply }) {
  const candidate = useCandidate(reply.candidateId);
  const campaign = useCampaign(candidate?.campaignId);
  const a = useActions();
  const { toast } = useToast();
  const confidentialityMode = useSettings().confidentialityMode;
  const [revealed, setRevealed] = React.useState(false);
  const showBody = revealed || !confidentialityMode;

  // Reveal the raw reply body (with its email/phone PII); audited on first reveal.
  function toggleReveal() {
    if (!revealed && reply.candidateId) a.recordPiiReveal(reply.candidateId);
    setRevealed((v) => !v);
  }

  // Live SLA tick — only after mount to avoid hydration drift.
  const [now, setNow] = React.useState<number | null>(null);
  const isHot = HOT_REPLY_INTENTS.includes(reply.intent);
  const showSla = Boolean(reply.slaDueAt) && isHot && !reply.handled;
  const [detailsOpen, setDetailsOpen] = React.useState(false);

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

  const [applying, setApplying] = React.useState(false);

  async function handleApply() {
    if (applying) return;
    setApplying(true);
    const result = await a.applyReplyAction(reply.id);
    setApplying(false);
    if (!result.ok) {
      toast({ title: "Could not apply action", description: result.error, variant: "error" });
      return;
    }
    toast({
      title: "Action applied",
      description: result.warning ?? reply.suggestedAction,
      variant: result.warning ? "warning" : "success",
    });
  }

  function handleHandled() {
    a.markReplyHandled(reply.id);
    toast({ title: "Marked as handled", variant: "info" });
  }

  const canSendReply = Boolean(reply.candidateId) && reply.draftResponse.trim().length > 0;

  function handleSendReply() {
    if (campaign?.status === "Paused") {
      toast({
        title: "Campaign is paused",
        description: `${campaign.title} is paused. Resume it before drafting new outreach.`,
        variant: "warning",
      });
      return;
    }
    const msg = a.draftReplyResponse(reply.id);
    if (!msg) {
      toast({ title: "Could not draft a reply", description: "No linked candidate or draft text.", variant: "error" });
      return;
    }
    toast({
      title: "Reply drafted",
      description: `${candidateName}: review it in the outreach queue. Nothing is sent until you approve it.`,
      variant: "success",
    });
  }

  return (
    <Card className={cn("p-5 animate-fade-in", reply.handled && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneForIntent(reply.intent)} dot>
            {REPLY_INTENT_LABELS[reply.intent]}
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
        {showBody ? reply.body : maskEmailBody(reply.body)}
      </blockquote>
      {confidentialityMode && (
        <button
          type="button"
          onClick={toggleReveal}
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink-soft"
        >
          {revealed ? <EyeOff className="h-3 w-3" aria-hidden /> : <Eye className="h-3 w-3" aria-hidden />}
          {revealed ? "Hide details" : "Reveal details"}
        </button>
      )}

      <p className="mt-3 text-sm text-muted">
        <span className="font-semibold text-ink-soft">Suggested: </span>
        {reply.suggestedAction}
      </p>

      {(reply.reasoning?.trim() || reply.draftResponse?.trim()) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
            aria-expanded={detailsOpen}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} aria-hidden />
            {detailsOpen ? "Hide reasoning & draft" : "Show reasoning & draft"}
          </button>
          {detailsOpen && (
            <div className="mt-2 space-y-2 rounded-2xl bg-canvas/80 px-3.5 py-3 text-xs leading-relaxed text-ink-soft">
              {reply.reasoning?.trim() ? (
                <p>
                  <span className="font-semibold text-ink">Reasoning: </span>
                  {reply.reasoning}
                </p>
              ) : null}
              {reply.draftResponse?.trim() ? (
                <p>
                  <span className="font-semibold text-ink">Draft: </span>
                  {reply.draftResponse}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

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
            loading={applying}
            disabled={applying}
          >
            {applying ? "Applying…" : "Apply action"}
          </Button>
          {canSendReply && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Send className="h-3.5 w-3.5" aria-hidden />}
              onClick={handleSendReply}
            >
              Send reply
            </Button>
          )}
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
