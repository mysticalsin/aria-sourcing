"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Eyebrow,
  useToast,
} from "@/components/ui";
import { RevealStream } from "@/components/reveal/reveal-stream";
import { ImpactBar } from "@/components/charts/impact-bar";
import { diffWords, type DiffToken } from "@/lib/diff";
import { analyzeOutcomes } from "@/lib/skills";
import { useActions, useCampaign, useCandidates, useOutreach, useReplies } from "@/lib/store";
import type { AgentSkill, HermesState, SkillUpdate } from "@/lib/types";
import { cn, round } from "@/lib/utils";
import {
  Brain,
  Check,
  Lightbulb,
  MessageSquareText,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";

const MAX_DIFF_TOKENS = 240;

type StreamEntry =
  | { kind: "line"; key: string; text: string }
  | { kind: "diff"; key: string }
  | { kind: "impact"; key: string };

/* ---------------------------------------------------------------------------
 * "Watch it learn" — a streamed, narrated review of ONE skill's most recent
 * proposal. Every line, the word-diff, and the impact bar are built from the
 * real `AgentSkill.metrics` and real reply/outreach counts (via
 * `analyzeOutcomes`, the same function `runLearning` uses) — nothing here is
 * invented. Accept calls the existing `acceptSkillLearning` /
 * `setSkillUpdateStatus` actions, so the version bump and the params mutation
 * are the real thing, not a cosmetic replay of one.
 * ------------------------------------------------------------------------- */
export function LearningSession({
  skill,
  campaignId,
  canEdit,
  className,
}: {
  skill: AgentSkill;
  campaignId: string | null;
  canEdit: boolean;
  className?: string;
}) {
  const actions = useActions();
  const { toast } = useToast();
  const campaign = useCampaign(campaignId);
  const candidates = useCandidates();
  const outreach = useOutreach();
  const replies = useReplies();

  const [running, setRunning] = React.useState(false);
  const [streamDone, setStreamDone] = React.useState(false);

  // analyzeOutcomes only reads candidates/outreach/replies off HermesState —
  // build just enough of the shape to call the real, canonical analysis
  // function instead of re-deriving tone/score/reply-outcome numbers by hand.
  const analysis = React.useMemo(
    () => analyzeOutcomes({ candidates, outreach, replies } as unknown as HermesState),
    [candidates, outreach, replies],
  );

  const skillProposals = React.useMemo(
    () =>
      (campaign?.skillUpdates ?? [])
        .filter((u) => u.skill === skill.key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [campaign, skill.key],
  );
  // Sorted newest-first by createdAt: runLearning() prepends new proposals
  // but generateReport() appends them (store.ts), so array position alone
  // isn't a reliable "most recent" signal — createdAt is.
  const latest: SkillUpdate | null = skillProposals[0] ?? null;
  const pending = latest && latest.status === "proposed" ? latest : null;

  React.useEffect(() => {
    setStreamDone(false);
  }, [pending?.id]);

  function runReview() {
    if (!canEdit) return;
    setRunning(true);
    const result = actions.runLearning();
    setRunning(false);
    toast({
      title:
        result.length > 0
          ? `Learning run complete: ${result.length} proposal${result.length === 1 ? "" : "s"}`
          : "Learning run complete",
      description:
        result.length > 0
          ? "Review the streamed analysis below and accept if it's worth keeping."
          : "No new refinements surfaced from the latest outcomes.",
      variant: result.length > 0 ? "success" : "info",
    });
  }

  function accept() {
    if (!canEdit || !pending || !campaignId) return;
    actions.acceptSkillLearning(pending.skill);
    actions.setSkillUpdateStatus(campaignId, pending.id, "accepted");
    toast({
      title: "Learning accepted",
      description: `${pending.title} is now v${skill.version + 1} of ${skill.filename}. It applies on the next run.`,
      variant: "success",
    });
  }

  function dismiss() {
    if (!canEdit || !pending || !campaignId) return;
    actions.setSkillUpdateStatus(campaignId, pending.id, "rejected");
    toast({
      title: "Proposal dismissed",
      description: `${pending.title} was not applied.`,
      variant: "info",
    });
  }

  const lines = React.useMemo(() => {
    if (!pending) return [];
    const out: string[] = [];
    out.push(
      `Reviewing ${skill.title} — v${skill.version}, applied ${skill.metrics.applied}× so far, outcome signal ${
        skill.metrics.outcomeSignal > 0 ? "+" : ""
      }${round(skill.metrics.outcomeSignal, 1)}.`,
    );
    out.push(
      `${analysis.contacted} candidate${analysis.contacted === 1 ? "" : "s"} contacted, ${analysis.converted} converted to Interested+, across ${replies.length} classified repl${
        replies.length === 1 ? "y" : "ies"
      } analyzed.`,
    );
    if (skill.key === "outreach_skill" && analysis.bestTone) {
      const r = analysis.toneRates.find((t) => t.tone === analysis.bestTone);
      if (r) {
        out.push(
          `${r.tone} converted ${(r.rate * 100).toFixed(0)}% of ${r.sent} sends — the strongest tone tested this cycle.`,
        );
      }
    }
    if (skill.key === "scoring_skill" && analysis.topDimension) {
      out.push(
        `Converters average ${analysis.topDimension.avg} on "${analysis.topDimension.key}" — today's weights under-value it.`,
      );
    }
    if (skill.key === "reply_classification_skill") {
      out.push(
        `${(analysis.unclearRate * 100).toFixed(0)}% of classified replies landed UNCLEAR against the current interest floor.`,
      );
    }
    out.push(pending.rationale);
    return out;
  }, [pending, skill, analysis, replies.length]);

  const diffTokens = React.useMemo<DiffToken[]>(
    () => (pending ? diffWords(pending.before, pending.after) : []),
    [pending],
  );
  // Cap what actually renders — diff.ts already guards the LCS table itself
  // against pathological inputs; this caps the DOM cost of a huge diff too.
  const displayTokens = React.useMemo<DiffToken[]>(() => {
    if (diffTokens.length <= MAX_DIFF_TOKENS) return diffTokens;
    const omitted = diffTokens.length - MAX_DIFF_TOKENS;
    return [
      ...diffTokens.slice(0, MAX_DIFF_TOKENS),
      { text: ` … ${omitted} more token${omitted === 1 ? "" : "s"} omitted`, type: "same" },
    ];
  }, [diffTokens]);

  const entries = React.useMemo<StreamEntry[]>(() => {
    if (!pending) return [];
    const out: StreamEntry[] = lines.map((text, i) => ({ kind: "line", key: `line-${i}`, text }));
    out.push({ kind: "diff", key: "diff" });
    out.push({ kind: "impact", key: "impact" });
    return out;
  }, [pending, lines]);

  // The exact formula applyLearning() uses on accept (store.ts / skills.ts) —
  // mirrored here so the projected bar matches what actually happens, not an
  // invented estimate.
  const projectedSignal = round(skill.metrics.outcomeSignal + 0.5, 1);

  if (!campaignId || !campaign) {
    return (
      <Card className={className}>
        <CardContent>
          <EmptyState
            icon={<Brain className="h-7 w-7" />}
            title="No active campaign"
            description="Run a campaign first so Aria has real outcomes to learn from, then come back to watch it learn."
          />
        </CardContent>
      </Card>
    );
  }

  if (!latest) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center gap-4 py-2 text-center">
          <EmptyState
            icon={<Lightbulb className="h-7 w-7" />}
            title={`No review yet for ${skill.title}`}
            description="Run learning to analyze real outcomes for this skill and stream the review here."
          />
          <Button
            variant="secondary"
            size="md"
            loading={running}
            leftIcon={<Brain className="h-4 w-4" />}
            onClick={runReview}
            disabled={!canEdit}
            title={canEdit ? undefined : "Viewers cannot run learning"}
          >
            Run learning
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!pending) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>Watch it learn</Eyebrow>
              <h3 className="text-base font-bold text-ink">{skill.title}</h3>
              <p className="mt-1 text-sm text-muted">
                Most recent review: <span className="font-semibold text-ink-soft">{latest.title}</span>
              </p>
            </div>
            <Badge tone={latest.status === "accepted" ? "success" : "danger"} dot>
              {latest.status === "accepted" ? "Accepted" : "Rejected"}
            </Badge>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={running}
            leftIcon={<Brain className="h-4 w-4" />}
            onClick={runReview}
            disabled={!canEdit}
            title={canEdit ? undefined : "Viewers cannot run learning"}
            className="self-start"
          >
            Run another review
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>
              <Brain className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-tangerine" aria-hidden />
              Watch it learn
            </Eyebrow>
            <h3 className="mt-0.5 text-base font-bold leading-tight text-ink">{pending.title}</h3>
            <p className="mt-1 text-xs text-muted">
              {skill.filename} · v{skill.version} → v{skill.version + 1}
            </p>
          </div>
          <Badge tone="warning" dot>
            Awaiting review
          </Badge>
        </div>

        <RevealStream
          key={pending.id}
          items={entries}
          keyExtractor={(entry) => entry.key}
          staggerMs={550}
          itemClassName="mb-3 last:mb-0"
          onDone={() => setStreamDone(true)}
          renderItem={(entry) => {
            if (entry.kind === "line") {
              return (
                <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
                  <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  <span>{entry.text}</span>
                </p>
              );
            }
            if (entry.kind === "diff") {
              return (
                <div className="rounded-2xl bg-ink/[0.04] px-4 py-3.5">
                  <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                    Playbook change
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">
                    {displayTokens.map((t, i) => (
                      <span
                        key={i}
                        className={
                          t.type === "add"
                            ? "rounded bg-success-soft px-0.5 text-success"
                            : t.type === "del"
                              ? "rounded bg-danger-soft px-0.5 text-danger line-through"
                              : "text-ink-soft"
                        }
                      >
                        {t.text}
                      </span>
                    ))}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    On accept, appended to {skill.filename} as a new version entry.
                  </p>
                </div>
              );
            }
            return (
              <div className="rounded-2xl bg-ink/[0.04] px-4 py-3.5">
                <div className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  Outcome signal on accept
                </div>
                <ImpactBar
                  before={skill.metrics.outcomeSignal}
                  after={projectedSignal}
                  beforeLabel="Current"
                  afterLabel="After accept"
                />
              </div>
            );
          }}
        />

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 transition-opacity",
            !streamDone && "opacity-60",
          )}
        >
          <Badge tone="electric">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {pending.impact}
          </Badge>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X className="h-4 w-4" />}
              onClick={dismiss}
              disabled={!canEdit || !streamDone}
              title={canEdit ? undefined : "Viewers cannot dismiss proposals"}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Check className="h-4 w-4" />}
              onClick={accept}
              disabled={!canEdit || !streamDone}
              title={canEdit ? undefined : "Viewers cannot accept proposals"}
            >
              Accept
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
