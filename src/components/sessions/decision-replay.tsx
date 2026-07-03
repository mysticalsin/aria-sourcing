"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Badge, Button, Drawer, EmptyState, Eyebrow } from "@/components/ui";
import { FitRadar } from "@/components/charts/fit-radar";
import { ScoreBreakdown } from "@/components/candidates/score-breakdown";
import { useCampaign, useCandidate, useEntityTimeline, useSettings } from "@/lib/store";
import type { TimelineEvent } from "@/lib/store";
import type {
  Activity,
  Booking,
  Candidate,
  ClassifiedReply,
  InterviewRecord,
  OutreachMessage,
} from "@/lib/types";
import { cn, formatDateTime, formatTimeAgo, toneForBookingStatus, toneForIntent, toneForOutreachStatus, toneForStage } from "@/lib/utils";
import type { Tone } from "@/lib/utils";
import { AuditPack } from "@/components/sessions/audit-pack";
import {
  Ban,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  FileText,
  History,
  MessageSquare,
  Pause,
  Play,
  Printer,
  Radar,
  Search,
  Send,
  ShieldAlert,
  StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ============================================================================
   Decision Replay (workstream 4.2) — replays a candidate's full journey
   (sourced → scored → drafted → approved → replied → booked) as a scrubbable
   timeline with an evidence rail that switches by step kind, plus a printable
   audit pack export. Read-only: nothing here mutates state.
   ========================================================================== */

export type ReplayStepKind =
  | "sourced"
  | "scored"
  | "drafted"
  | "approved"
  | "sent"
  | "rejected"
  | "replied"
  | "booked"
  | "compliance"
  | "note"
  | "other";

export interface ReplayStep {
  key: string;
  kind: ReplayStepKind;
  at: string;
  title: string;
  outcome: string;
  notes: string;
  /** The human (or agent) signature behind this step. */
  who: string;
  /** True for the two canonical opening steps that have no discrete activity
   *  log entry of their own (see buildReplayChain) — surfaced in the UI so
   *  the replay never claims a log entry that doesn't exist. */
  synthesized: boolean;
  message?: OutreachMessage;
  reply?: ClassifiedReply;
  booking?: Booking;
  interview?: InterviewRecord;
}

const STEP_META: Record<ReplayStepKind, { label: string; icon: LucideIcon; tone: Tone }> = {
  sourced: { label: "Sourced", icon: Search, tone: "neutral" },
  scored: { label: "Scored", icon: Radar, tone: "electric" },
  drafted: { label: "Drafted", icon: FileText, tone: "aqua" },
  approved: { label: "Approved", icon: ClipboardCheck, tone: "success" },
  sent: { label: "Sent", icon: Send, tone: "electric" },
  rejected: { label: "Rejected", icon: Ban, tone: "danger" },
  replied: { label: "Replied", icon: MessageSquare, tone: "tangerine" },
  booked: { label: "Booked", icon: CalendarCheck2, tone: "violet" },
  compliance: { label: "Compliance", icon: ShieldAlert, tone: "warning" },
  note: { label: "Note", icon: StickyNote, tone: "neutral" },
  other: { label: "Event", icon: Circle, tone: "neutral" },
};

const TONE_VAR: Record<Tone, string> = {
  neutral: "--muted",
  tangerine: "--tangerine",
  electric: "--electric",
  aqua: "--aqua",
  violet: "--violet",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

/* ---- Chain synthesis ------------------------------------------------------
   The activity log is a real, campaign-wide audit trail, but two canonical
   moments in every candidate's journey — being sourced and being scored —
   are only ever logged at the campaign level (bulk re-score, batch sourcing),
   never per candidate. So every candidate's chain opens with two synthesized
   steps derived straight from the candidate record, then appends whatever
   real, candidate-linked activity actually happened (drafts, approvals,
   sends, replies, bookings, compliance actions). A candidate with nothing
   else on record still replays as a coherent 2-step chain instead of an
   empty one. --------------------------------------------------------------- */

function classifyActivity(a: Activity): ReplayStepKind {
  switch (a.type) {
    case "parse":
    case "sourcing":
      return "sourced";
    case "score":
      return "scored";
    case "outreach":
      if (a.title.includes("rejected")) return "rejected";
      if (a.title.includes("approved")) return "approved";
      if (a.title.includes("sent")) return "sent";
      return "drafted";
    case "reply":
      return "replied";
    case "booking":
      return "booked";
    case "compliance":
      return "compliance";
    case "system":
      return "note";
    default:
      return "other";
  }
}

function closestByTime<T>(pool: T[], targetIso: string, getIso: (item: T) => string): T | undefined {
  if (pool.length === 0) return undefined;
  const target = new Date(targetIso).getTime();
  return pool.reduce((best, cur) => {
    const bestDelta = Math.abs(new Date(getIso(best)).getTime() - target);
    const curDelta = Math.abs(new Date(getIso(cur)).getTime() - target);
    return curDelta < bestDelta ? cur : best;
  });
}

/** Pure builder — exported so it can be unit-tested / reused independently
 *  of the component. Takes the merged timeline from useEntityTimeline. */
export function buildReplayChain(candidate: Candidate, timeline: TimelineEvent[], operatorName: string): ReplayStep[] {
  const outreachPool = timeline
    .filter((e): e is Extract<TimelineEvent, { kind: "outreach" }> => e.kind === "outreach")
    .map((e) => e.message);
  const replyPool = timeline
    .filter((e): e is Extract<TimelineEvent, { kind: "reply" }> => e.kind === "reply")
    .map((e) => e.reply);
  const activityEvents = timeline.filter(
    (e): e is Extract<TimelineEvent, { kind: "activity" }> => e.kind === "activity",
  );

  const steps: ReplayStep[] = [
    {
      key: `${candidate.id}-sourced`,
      kind: "sourced",
      at: candidate.createdAt,
      title: `Sourced from ${candidate.sourcePlatform}`,
      outcome: candidate.sourceQuery || candidate.sourcePlatform,
      notes: `${candidate.currentTitle}${candidate.currentCompany ? ` at ${candidate.currentCompany}` : ""}${
        candidate.techStack.length ? ` — ${candidate.techStack.slice(0, 5).join(", ")}` : ""
      }.`,
      who: "Aria — Sourcing Agent",
      synthesized: true,
    },
    {
      key: `${candidate.id}-scored`,
      kind: "scored",
      at: candidate.createdAt,
      title: `Scored ${Math.round(candidate.matchScore)}/100${candidate.starRating ? ` · ${candidate.starRating}` : ""}`,
      outcome: candidate.matchBreakdown.length
        ? `${candidate.matchBreakdown.length} dimensions weighed`
        : `${Math.round(candidate.matchScore)}/100`,
      notes: "Composite match score computed against the role's scoring weights.",
      who: "Aria — Scoring Engine",
      synthesized: true,
    },
  ];

  for (const { activity } of activityEvents) {
    const kind = classifyActivity(activity);
    let message: OutreachMessage | undefined;
    let reply: ClassifiedReply | undefined;
    let booking: Booking | undefined;
    let interview: InterviewRecord | undefined;

    if (kind === "drafted" || kind === "approved" || kind === "sent" || kind === "rejected") {
      message = closestByTime(outreachPool, activity.createdAt, (m) => m.createdAt);
    }
    if (kind === "replied") {
      reply = closestByTime(replyPool, activity.createdAt, (r) => r.receivedAt);
    }
    if (kind === "booked") {
      if (activity.linkedEntityType === "booking" && candidate.booking?.id === activity.linkedEntityId) {
        booking = candidate.booking;
      } else if (candidate.interviews?.length) {
        interview = closestByTime(candidate.interviews, activity.createdAt, (i) => i.createdAt);
      }
    }

    const who: string =
      kind === "drafted"
        ? `Aria — Outreach Agent${activity.notes.toLowerCase().includes("live") ? " (live)" : ""}`
        : kind === "approved" || kind === "sent"
          ? message?.approvedBy || operatorName
          : kind === "rejected"
            ? operatorName
            : kind === "replied"
              ? candidate.name
              : kind === "booked"
                ? operatorName
                : kind === "compliance"
                  ? activity.title.toLowerCase().includes("not synced")
                    ? "System"
                    : operatorName
                  : operatorName;

    steps.push({
      key: activity.id,
      kind,
      at: activity.createdAt,
      title: activity.title,
      outcome: activity.outcome,
      notes: activity.notes,
      who,
      synthesized: false,
      message,
      reply,
      booking,
      interview,
    });
  }

  return steps.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/* ---- Motion helpers -------------------------------------------------------- */

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

/* ---- Evidence rail ---------------------------------------------------------- */

function EvidenceRail({ step, candidate }: { step: ReplayStep; candidate: Candidate }) {
  switch (step.kind) {
    case "sourced":
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="electric">{candidate.sourcePlatform}</Badge>
            <Badge tone={toneForStage(candidate.stage)}>{candidate.stage}</Badge>
          </div>
          <p className="text-sm text-ink">
            {candidate.currentTitle}
            {candidate.currentCompany ? ` at ${candidate.currentCompany}` : ""}
          </p>
          {candidate.sourceQuery && (
            <div>
              <Eyebrow>Sourcing query</Eyebrow>
              <p className="mt-1 rounded-xl bg-ink/[0.04] px-3 py-2 font-mono text-xs text-ink-soft">
                {candidate.sourceQuery}
              </p>
            </div>
          )}
          {candidate.techStack.length > 0 && (
            <div>
              <Eyebrow>Tech stack</Eyebrow>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {candidate.techStack.map((t) => (
                  <Badge key={t} tone="neutral" size="sm">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {candidate.recentActivity && <p className="text-xs text-muted">{candidate.recentActivity}</p>}
        </div>
      );

    case "scored":
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <FitRadar matchBreakdown={candidate.matchBreakdown} size={200} label={candidate.name} />
          </div>
          <ScoreBreakdown breakdown={candidate.matchBreakdown} />
        </div>
      );

    case "drafted": {
      const evidence = step.message?.personalizationEvidence.filter((e) => e.trim().length > 0) ?? [];
      return (
        <div className="space-y-4">
          {step.message && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="aqua">{step.message.channel}</Badge>
              <Badge tone="neutral">{step.message.tone}</Badge>
            </div>
          )}
          {step.message ? (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <p className="text-sm font-semibold text-ink">{step.message.subject}</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{step.message.body}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Draft copy is no longer available.</p>
          )}
          {evidence.length > 0 && (
            <div>
              <Eyebrow>Personalization evidence</Eyebrow>
              <ul className="mt-1.5 space-y-1">
                {evidence.map((e, i) => (
                  <li key={i} className="text-xs text-ink-soft">
                    • {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    case "approved":
    case "sent":
    case "rejected":
      return (
        <div className="space-y-3">
          {step.message && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneForOutreachStatus(step.message.status)}>{step.message.status}</Badge>
              <Badge tone="neutral">{step.message.channel}</Badge>
              {step.message.dryRun && <Badge tone="warning">Dry-run</Badge>}
            </div>
          )}
          <p className="text-sm text-ink">{step.outcome}</p>
          <p className="text-xs text-muted">{step.notes}</p>
          {step.message?.approvedBy && (
            <p className="text-xs text-muted">
              Approved by <span className="font-semibold text-ink-soft">{step.message.approvedBy}</span>
            </p>
          )}
          {step.message?.sentAt && <p className="text-xs text-muted">Sent {formatDateTime(step.message.sentAt)}</p>}
        </div>
      );

    case "replied":
      return (
        <div className="space-y-3">
          {step.reply ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneForIntent(step.reply.intent)}>{step.reply.intent}</Badge>
                <Badge tone="neutral" size="sm">
                  {Math.round(step.reply.confidence * 100)}% confidence
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{step.reply.body}</p>
              {step.reply.reasoning && (
                <div>
                  <Eyebrow>Classifier reasoning</Eyebrow>
                  <p className="mt-1 text-xs text-muted">{step.reply.reasoning}</p>
                </div>
              )}
              {step.reply.suggestedAction && (
                <div>
                  <Eyebrow>Suggested action</Eyebrow>
                  <p className="mt-1 text-xs text-muted">{step.reply.suggestedAction}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{step.notes}</p>
          )}
        </div>
      );

    case "booked":
      return (
        <div className="space-y-3">
          {step.booking ? (
            <>
              <Badge tone={toneForBookingStatus(step.booking.status)}>{step.booking.status}</Badge>
              <p className="text-sm text-ink">{step.booking.interviewer}</p>
              <p className="text-xs text-muted">
                {formatDateTime(step.booking.startTime)} ({step.booking.timezone})
              </p>
              {step.booking.agenda.length > 0 && (
                <ul className="space-y-1">
                  {step.booking.agenda.map((a, i) => (
                    <li key={i} className="text-xs text-ink-soft">
                      • {a}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-3 pt-1 text-xs">
                {step.booking.teamsLink && (
                  <a className="font-semibold text-electric underline" href={step.booking.teamsLink} target="_blank" rel="noreferrer">
                    Teams link
                  </a>
                )}
                {step.booking.calLink && (
                  <a className="font-semibold text-electric underline" href={step.booking.calLink} target="_blank" rel="noreferrer">
                    Cal.com link
                  </a>
                )}
              </div>
            </>
          ) : step.interview ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">{step.interview.kind}</Badge>
                <Badge tone="neutral">{step.interview.outcome}</Badge>
              </div>
              <p className="text-sm text-ink">{step.interview.interviewer}</p>
              {step.interview.scheduledFor && (
                <p className="text-xs text-muted">{formatDateTime(step.interview.scheduledFor)}</p>
              )}
              {step.interview.hmFeedback && <p className="text-xs text-ink-soft">{step.interview.hmFeedback}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">{step.notes}</p>
          )}
        </div>
      );

    case "compliance":
    case "note":
    case "other":
    default:
      return (
        <div className="space-y-2">
          <p className="text-sm text-ink">{step.outcome}</p>
          <p className="text-xs text-muted">{step.notes}</p>
        </div>
      );
  }
}

/* ---- Scrubber -------------------------------------------------------------- */

function ScrubberTrack({
  steps,
  index,
  onSelect,
  reducedMotion,
}: {
  steps: ReplayStep[];
  index: number;
  onSelect: (i: number) => void;
  reducedMotion: boolean;
}) {
  const n = steps.length;
  return (
    <div className="space-y-2">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink/10" aria-hidden />
        <motion.div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-electric to-violet"
          animate={{ width: `${(n <= 1 ? 1 : (index + 1) / n) * 100}%` }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-between">
          {steps.map((s, i) => {
            const meta = STEP_META[s.kind];
            const Icon = meta.icon;
            const active = i === index;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`${meta.label}: ${s.title}`}
                aria-current={active}
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-paper transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric",
                  active ? "scale-125 bg-ink text-paper" : "bg-ink/15 text-ink-soft hover:bg-ink/25",
                )}
              >
                <Icon className="h-2.5 w-2.5" aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[0.6875rem] font-medium text-muted">
        <span>Sourced {formatTimeAgo(steps[0].at)}</span>
        <span>Latest {formatTimeAgo(steps[n - 1].at)}</span>
      </div>
    </div>
  );
}

function StepHeader({ step }: { step: ReplayStep }) {
  const meta = STEP_META[step.kind];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `hsl(var(${TONE_VAR[meta.tone]}) / 0.12)`, color: `hsl(var(${TONE_VAR[meta.tone]}))` }}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
          {step.synthesized && (
            <Badge tone="neutral" size="sm">
              Synthesized
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
        <p className="text-xs text-muted">
          {formatDateTime(step.at)} · <span className="font-semibold text-ink-soft">{step.who}</span>
        </p>
      </div>
    </div>
  );
}

/* ---- Main component ---------------------------------------------------------- */

export function DecisionReplay({
  candidateId,
  onClose,
}: {
  candidateId: string | null;
  onClose: () => void;
}) {
  const candidate = useCandidate(candidateId);
  const campaign = useCampaign(candidate?.campaignId);
  const timeline = useEntityTimeline("candidate", candidateId);
  const settings = useSettings();
  const reducedMotion = usePrefersReducedMotion();

  const steps = React.useMemo(
    () => (candidate ? buildReplayChain(candidate, timeline, settings.operatorName) : []),
    [candidate, timeline, settings.operatorName],
  );

  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [candidateId]);

  React.useEffect(() => {
    if (!playing || steps.length === 0) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 2400);
    return () => window.clearInterval(id);
  }, [playing, steps.length]);

  // Print export: portal a plain, ink-on-paper trace to <body> and hide
  // everything else for the duration of the print, via a scoped @media print
  // rule below — works regardless of the Drawer's own fixed/overlay markup.
  React.useEffect(() => {
    if (!exporting) return;
    document.body.classList.add("decision-replay-printing");
    window.print();
    const onAfterPrint = () => setExporting(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      document.body.classList.remove("decision-replay-printing");
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [exporting]);

  const safeIndex = steps.length === 0 ? 0 : Math.min(index, steps.length - 1);
  const step = steps[safeIndex];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
    if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
  };

  return (
    <>
      <Drawer
        open={Boolean(candidateId)}
        onClose={onClose}
        title={candidate ? candidate.name : "Decision Replay"}
        description={candidate ? `${candidate.currentTitle}${campaign ? ` · ${campaign.title}` : ""}` : undefined}
        width="max-w-3xl"
        footer={
          candidate && steps.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-muted">
                Step {safeIndex + 1} of {steps.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous step"
                  leftIcon={<ChevronLeft className="h-4 w-4" />}
                  onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                  disabled={safeIndex === 0}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={playing ? "Pause replay" : "Play replay"}
                  leftIcon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  onClick={() => setPlaying((p) => !p)}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next step"
                  leftIcon={<ChevronRight className="h-4 w-4" />}
                  onClick={() => setIndex((i) => Math.min(i + 1, steps.length - 1))}
                  disabled={safeIndex === steps.length - 1}
                />
                <Button variant="subtle" size="sm" leftIcon={<Printer className="h-4 w-4" />} onClick={() => setExporting(true)}>
                  Export audit pack
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <div onKeyDown={handleKeyDown}>
          {!candidate ? (
            <EmptyState
              icon={<History className="h-7 w-7" />}
              title="Candidate not found"
              description="This candidate may have been removed from the workspace."
            />
          ) : steps.length === 0 ? (
            <EmptyState
              icon={<History className="h-7 w-7" />}
              title="Nothing to replay yet"
              description="No sourcing, scoring, or outreach recorded for this candidate."
            />
          ) : (
            <div className="space-y-6">
              <ScrubberTrack steps={steps} index={safeIndex} onSelect={setIndex} reducedMotion={reducedMotion} />
              <div className="rounded-2xl border border-line p-5">
                <StepHeader step={step} />
                <div className="mt-4">
                  <EvidenceRail step={step} candidate={candidate} />
                </div>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {exporting && candidate && typeof document !== "undefined"
        ? createPortal(
            <div id="decision-replay-audit-root">
              <AuditPack candidate={candidate} campaign={campaign} steps={steps} />
            </div>,
            document.body,
          )
        : null}
      <style>{`
        #decision-replay-audit-root { display: none; }
        @media print {
          body.decision-replay-printing > *:not(#decision-replay-audit-root) {
            display: none !important;
          }
          #decision-replay-audit-root {
            display: block !important;
          }
        }
      `}</style>
    </>
  );
}
