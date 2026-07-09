"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  EmptyState,
  useToast,
} from "@/components/ui";
import { FitRadar } from "@/components/charts/fit-radar";
import { useActions, useCandidate, useCampaign, useSettings } from "@/lib/store";
import { checkOutreachApproval, type ApprovalCheck } from "@/lib/rules";
import type { Candidate, MatchBreakdownItem, OutreachMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, X, CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Sparkles, Radar as RadarIcon } from "lucide-react";

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

/* ---- Checklist row -------------------------------------------------------- */

const STATUS_ICON: Record<ApprovalCheck["status"], React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />,
  warn: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />,
  block: <XCircle className="h-4 w-4 text-danger" aria-hidden />,
};

const STATUS_ROW_CLASS: Record<ApprovalCheck["status"], string> = {
  pass: "border-success/20 bg-success-soft/60",
  warn: "border-warning/30 bg-warning-soft/60",
  block: "border-danger/30 bg-danger-soft/70",
};

function ChecklistRow({
  check,
  index,
  reducedMotion,
}: {
  check: ApprovalCheck;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <motion.li
      // `initial` only fires on mount, so a live status change (e.g. toggling
      // do-not-contact) re-renders this row's color/icon INSTANTLY with no
      // replay of the stagger-in animation — only the very first paint of
      // this checklist streams in one row at a time.
      initial={reducedMotion ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reducedMotion ? { duration: 0 } : { delay: index * 0.09, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm",
        STATUS_ROW_CLASS[check.status],
      )}
    >
      <span className="mt-0.5 shrink-0">{STATUS_ICON[check.status]}</span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{check.rule}</span>
        <span className="block text-xs text-muted">{check.detail}</span>
      </span>
    </motion.li>
  );
}

/* ---- Claim -> signal map --------------------------------------------------- */

/** Best-effort classifier tying a personalization sentence back to the real
 *  scoring dimension it draws on. Read-only and additive: it never changes
 *  what evidence is stored, it only labels what's already there for display.
 *  Falls back to "general" whenever nothing in the sentence ties to a
 *  specific candidate signal. */
function classifyEvidence(evidence: string, candidate: Candidate): MatchBreakdownItem["key"] | null {
  const text = evidence.toLowerCase();

  if (candidate.techStack.some((skill) => skill.trim() && text.includes(skill.toLowerCase())))
    return "skills";

  if (/\byrs?\b|\byears?\b/.test(text)) return "experience";

  const activityText = candidate.recentActivity.toLowerCase().replace(/\.$/, "");
  if (activityText && text.includes(activityText)) return "activity";
  if (
    /this week|days ago|active|shipped|merged|launched|speaking|this month|recently|published|maintains|contribut|last year|inactive|dormant|quiet/.test(
      text,
    )
  )
    return "activity";

  if (candidate.companyStageExperience.some((stage) => text.includes(stage.toLowerCase())))
    return "companyStage";
  if (/stage compan/.test(text)) return "companyStage";

  if (candidate.industryExperience.some((ind) => ind.trim() && text.includes(ind.toLowerCase())))
    return "industry";

  if (candidate.location.trim() && text.includes(candidate.location.toLowerCase())) return "location";

  if (candidate.currentCompany.trim() && text.includes(candidate.currentCompany.toLowerCase()))
    return "companyStage";

  return null;
}

function ClaimSignalMap({
  evidence,
  candidate,
  matchBreakdown,
}: {
  evidence: string[];
  candidate: Candidate | undefined;
  matchBreakdown: MatchBreakdownItem[];
}) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  const classified: (MatchBreakdownItem["key"] | "general" | null)[] = evidence.map((ev) =>
    candidate ? classifyEvidence(ev, candidate) ?? "general" : null,
  );
  const highlightKey = hoverIdx != null ? classified[hoverIdx] : null;

  if (evidence.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <Eyebrow className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" aria-hidden /> Claim → signal map
        </Eyebrow>
        <p className="mt-2 text-sm text-muted">No personalization sentences to map yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <Eyebrow className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" aria-hidden /> Claim → signal map
      </Eyebrow>
      <ul className="space-y-1.5">
        {evidence.map((ev, i) => (
          <li
            key={i}
            tabIndex={0}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            onFocus={() => setHoverIdx(i)}
            onBlur={() => setHoverIdx(null)}
            className={cn(
              "cursor-default rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-inset ring-transparent transition-colors",
              hoverIdx === i && "bg-electric-soft ring-electric/20 text-ink",
            )}
          >
            {ev}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
        {matchBreakdown.map((item) => (
          <Badge
            key={item.key}
            size="sm"
            tone={highlightKey === item.key ? "electric" : "neutral"}
            className={cn("transition-colors", highlightKey === item.key && "ring-2 ring-electric/40")}
          >
            {item.label}
          </Badge>
        ))}
        <Badge
          size="sm"
          tone={highlightKey === "general" ? "electric" : "neutral"}
          className={cn("transition-colors", highlightKey === "general" && "ring-2 ring-electric/40")}
        >
          General
        </Badge>
      </div>
    </div>
  );
}

/* ---- Glass-box panel -------------------------------------------------------- */

export interface GlassBoxPanelProps {
  message: OutreachMessage;
}

/**
 * "Glass-box" approval companion for a single draft — makes the guardrail
 * engine that gates Approve visible instead of a black box: an animated,
 * per-rule checklist derived straight from `checkOutreachApproval`'s real
 * `checks` (never invented client-side state), the candidate's FitRadar, and
 * a claim -> signal map for the personalization sentences. Purely additive
 * and read-only over the existing rules/store — it reports the same gate the
 * card's own Approve button already enforces, it never relaxes it.
 */
export function GlassBoxPanel({ message }: GlassBoxPanelProps) {
  const candidate = useCandidate(message.candidateId);
  const campaign = useCampaign(message.campaignId);
  const settings = useSettings();
  const actions = useActions();
  const { toast } = useToast();
  const reducedMotion = usePrefersReducedMotion();

  if (!candidate || !campaign) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
            title="Candidate or campaign unavailable"
            description="This draft's linked candidate/campaign could not be loaded."
          />
        </CardContent>
      </Card>
    );
  }

  const result = checkOutreachApproval({
    candidate,
    message,
    settings,
    emailsSentToday: campaign.metrics.emailsSentToday,
    linkedinSentToday: campaign.metrics.linkedinSentToday,
  });
  const checks = result.checks ?? [];
  const hasBlock = checks.some((c) => c.status === "block");
  const actionable = message.status === "Needs Approval" || message.status === "Draft";
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  async function handleApprove() {
    if (approving) return;
    setApproving(true);
    const res = await actions.approveOutreach(message.id);
    setApproving(false);
    if (!res.allowed) {
      toast({ title: "Approval blocked", description: res.blockers.join(" "), variant: "error" });
      return;
    }
    toast({
      title: "Approved: queued for send",
      description: res.warnings.length
        ? res.warnings.join(" ")
        : "Goes live once the agent seat is connected and its sending domain is verified.",
      variant: "success",
    });
  }

  async function handleReject() {
    if (rejecting) return;
    setRejecting(true);
    const result = await actions.rejectOutreach(message.id);
    setRejecting(false);
    if (!result.ok) {
      toast({ title: "Could not reject outreach", description: result.error, variant: "error" });
      return;
    }
    toast({ title: "Outreach rejected", description: "Removed from the approval queue.", variant: "warning" });
  }

  return (
    <Card className="border-electric/20">
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow className="flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Glass-box approval
          </Eyebrow>
          <Badge tone={hasBlock ? "danger" : "success"} size="sm" dot>
            {hasBlock ? "Blocked" : "Clear to approve"}
          </Badge>
        </div>

        <ul className="space-y-1.5">
          {checks.map((c, i) => (
            <ChecklistRow key={c.rule} check={c} index={i} reducedMotion={reducedMotion} />
          ))}
        </ul>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col items-center rounded-2xl border border-line bg-surface p-4">
            <Eyebrow className="flex w-full items-center gap-1.5">
              <RadarIcon className="h-3 w-3" aria-hidden /> Fit radar
            </Eyebrow>
            <FitRadar matchBreakdown={candidate.matchBreakdown} label={candidate.name} size={180} />
          </div>
          <ClaimSignalMap
            evidence={message.personalizationEvidence}
            candidate={candidate}
            matchBreakdown={candidate.matchBreakdown}
          />
        </div>

        {actionable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Check className="h-4 w-4" />}
              onClick={handleApprove}
              loading={approving}
              disabled={hasBlock || approving || rejecting}
              title={hasBlock ? "Blocked by a failing guardrail check above" : undefined}
            >
              {approving ? "Recording approval…" : "Approve"}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={handleReject} disabled={approving || rejecting}>
              {rejecting ? "Revoking…" : "Reject"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
