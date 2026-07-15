"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  CardTitle,
  Badge,
  Button,
  EmptyState,
  SkeletonCard,
  Tabs,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { SkillCard } from "@/components/skills/skill-card";
import { LearningSession } from "@/components/skills/learning-session";
import {
  useHydrated,
  useActiveCampaign,
  useSkills,
  useActions,
  useRole,
} from "@/lib/store";
import { can } from "@/lib/rbac";
import { SKILL_ORDER } from "@/lib/skills";
import type { SkillKey, SkillUpdate } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Brain,
  Sparkles,
  Check,
  X,
  ArrowRight,
  Activity as ActivityIcon,
  Lightbulb,
  CheckCheck,
  Repeat,
  BookOpen,
} from "lucide-react";

/* ---------------------------------------------------------------------------
 * The self-improvement loop, told as four steps. Outcomes from real campaign
 * activity become proposals; an operator accepts; accepted params feed straight
 * back into scoring, outreach, and reply classification on the next run.
 * ------------------------------------------------------------------------- */
const LOOP_STEPS: { icon: React.ReactNode; label: string; detail: string }[] = [
  {
    icon: <ActivityIcon className="h-4 w-4" aria-hidden />,
    label: "Outcomes",
    detail: "Replies, interest, and conversions from live campaigns",
  },
  {
    icon: <Lightbulb className="h-4 w-4" aria-hidden />,
    label: "Proposals",
    detail: "Learning drafts concrete before to after changes",
  },
  {
    icon: <CheckCheck className="h-4 w-4" aria-hidden />,
    label: "Accept",
    detail: "You approve the change before it ever ships",
  },
  {
    icon: <Repeat className="h-4 w-4" aria-hidden />,
    label: "Feed back",
    detail: "Params re-tune scoring, outreach, and replies",
  },
];

function LoopExplainer() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5">
        <div>
          <Eyebrow>
            <Brain className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-tangerine" aria-hidden />
            The learning loop
          </Eyebrow>
          <CardTitle className="mt-0.5">Experience compounds into better playbooks</CardTitle>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Aria never edits itself silently. It studies what actually converted, drafts a
            proposal, and waits for your sign-off. The accepted parameters then feed straight back
            into the next sourcing, outreach, and reply-classification run.
          </p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP_STEPS.map((step, i) => (
            <li key={step.label} className="relative">
              <div className="flex h-full flex-col gap-2 rounded-2xl bg-ink/[0.04] px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-surface text-tangerine ring-1 ring-line">
                    {step.icon}
                  </span>
                  <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-bold text-ink">{step.label}</span>
                </div>
                <p className="text-xs leading-relaxed text-ink-soft">{step.detail}</p>
              </div>
              {i < LOOP_STEPS.length - 1 && (
                <ArrowRight
                  className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted lg:block"
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/* A single learning proposal awaiting review. Accept applies the learned params
 * to the underlying skill AND marks the proposal accepted so it leaves the queue;
 * Dismiss rejects it. */
function ProposalCard({
  proposal,
  campaignId,
  canEdit,
}: {
  proposal: SkillUpdate;
  campaignId: string;
  canEdit: boolean;
}) {
  const actions = useActions();
  const { toast } = useToast();

  function accept() {
    if (!canEdit) return;
    const accepted = actions.setSkillUpdateStatus(campaignId, proposal.id, "accepted");
    if (!accepted) {
      toast({
        title: "Couldn't save the learning decision",
        description: "Refresh the campaign and try again.",
        variant: "error",
      });
      return;
    }
    toast({
      title: "Learning accepted",
      description: `${proposal.title} is now baked into ${proposal.skill}.md. It applies on the next run.`,
      variant: "success",
    });
  }

  function dismiss() {
    if (!canEdit) return;
    const rejected = actions.setSkillUpdateStatus(campaignId, proposal.id, "rejected");
    if (!rejected) {
      toast({
        title: "Couldn't save the learning decision",
        description: "Refresh the campaign and try again.",
        variant: "error",
      });
      return;
    }
    toast({
      title: "Proposal dismissed",
      description: `${proposal.title} was not applied.`,
      variant: "info",
    });
  }

  return (
    <Card className="flex h-full flex-col animate-fade-in">
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Proposed learning</Eyebrow>
            <h3 className="text-base font-bold leading-tight text-ink">{proposal.title}</h3>
            <code className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
              <BookOpen className="h-3.5 w-3.5 text-muted" aria-hidden />
              {proposal.skill}.md
            </code>
          </div>
          <Badge tone="warning" dot>
            Awaiting review
          </Badge>
        </div>

        <p className="text-sm leading-relaxed text-ink-soft">{proposal.rationale}</p>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-2xl bg-ink/[0.04] px-3.5 py-3">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              Before
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{proposal.before}</p>
          </div>
          <ArrowRight className="mx-auto hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
          <div className="rounded-2xl bg-success-soft px-3.5 py-3">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-success">
              After
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{proposal.after}</p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <Badge tone="electric">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {proposal.impact}
          </Badge>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X className="h-4 w-4" />}
              onClick={dismiss}
              disabled={!canEdit}
              title={canEdit ? undefined : "Viewers cannot dismiss proposals"}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Check className="h-4 w-4" />}
              onClick={accept}
              disabled={!canEdit}
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

export default function SkillsPage() {
  const hydrated = useHydrated();
  const activeCampaign = useActiveCampaign();
  const skills = useSkills();
  const actions = useActions();
  const { toast } = useToast();
  const canEditSkills = can(useRole(), "skills");

  const [running, setRunning] = React.useState(false);
  const [reviewSkillKey, setReviewSkillKey] = React.useState<SkillKey>(SKILL_ORDER[0]);

  const proposals = (activeCampaign?.skillUpdates ?? []).filter((u) => u.status === "proposed");

  // Order the skill playbooks by the canonical SKILL_ORDER, then anything new.
  const orderedSkills = React.useMemo(() => {
    const rank = new Map(SKILL_ORDER.map((k, i) => [k, i]));
    return [...skills].sort(
      (a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99),
    );
  }, [skills]);

  const reviewSkill = orderedSkills.find((s) => s.key === reviewSkillKey) ?? orderedSkills[0];

  function runLearning() {
    if (!canEditSkills) return;
    setRunning(true);
    const result = actions.runLearning();
    setRunning(false);
    const n = result.length;
    toast({
      title: n > 0 ? `Learning run complete: ${n} ${n === 1 ? "proposal" : "proposals"}` : "Learning run complete",
      description:
        n > 0
          ? "Review each proposed change below and accept the ones worth keeping."
          : activeCampaign
            ? "No new refinements surfaced from the latest outcomes."
            : "Run a campaign first so Aria has outcomes to learn from.",
      variant: n > 0 ? "success" : "info",
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Self-improvement"
        title="Skills that learn from experience."
        description="Living playbooks the agent reads at runtime and rewrites as it learns what books interviews. Every change is proposed, reviewed, and reversible."
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={running}
            leftIcon={<Brain className="h-4 w-4" />}
            onClick={runLearning}
            disabled={!canEditSkills}
            title={canEditSkills ? undefined : "Viewers cannot run learning"}
          >
            Run learning
          </Button>
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <div className="grid gap-5 lg:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        }
      >
        <div className="space-y-8">
          <LoopExplainer />

          {/* Watch it learn — a streamed, narrated review of one skill's real,
              most-recent proposal (metrics + reply outcomes + word-diff). */}
          {orderedSkills.length > 0 && reviewSkill && (
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Eyebrow>Live review</Eyebrow>
                  <CardTitle>Watch it learn</CardTitle>
                  <p className="mt-1 max-w-2xl text-sm text-muted">
                    Pick a skill to stream its most recent review: real metrics, a red/green
                    playbook diff, and the projected outcome signal, before you accept.
                  </p>
                </div>
                <Tabs
                  idBase="watch-it-learn"
                  value={reviewSkill.key}
                  onValueChange={(v) => setReviewSkillKey(v as SkillKey)}
                  items={orderedSkills.map((s) => ({ value: s.key, label: s.title }))}
                />
              </div>
              <LearningSession
                key={reviewSkill.key}
                skill={reviewSkill}
                campaignId={activeCampaign?.id ?? null}
                canEdit={canEditSkills}
              />
            </section>
          )}

          {/* Proposals awaiting review */}
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <Eyebrow>Pending review</Eyebrow>
                <CardTitle>Proposed learnings</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  {activeCampaign
                    ? `Drafted from ${activeCampaign.title}. Accept to apply the change to the playbook, or dismiss it.`
                    : "Run learning on an active campaign to surface proposals here."}
                </p>
              </div>
              {proposals.length > 0 && (
                <Badge tone="warning" dot>
                  {proposals.length} awaiting review
                </Badge>
              )}
            </div>

            {proposals.length === 0 ? (
              <EmptyState
                icon={<Lightbulb className="h-7 w-7" />}
                title="No proposals waiting"
                description="Run learning to analyze the latest campaign outcomes and surface concrete, reviewable refinements to the playbooks below."
                action={
                  <Button
                    variant="secondary"
                    size="md"
                    loading={running}
                    leftIcon={<Brain className="h-4 w-4" />}
                    onClick={runLearning}
                    disabled={!canEditSkills}
                    title={canEditSkills ? undefined : "Viewers cannot run learning"}
                  >
                    Run learning
                  </Button>
                }
              />
            ) : (
              <div className={cn("grid gap-5", proposals.length > 1 && "lg:grid-cols-2")}>
                {proposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    campaignId={activeCampaign!.id}
                    canEdit={canEditSkills}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Living playbooks */}
          <section>
            <div className="mb-4">
              <Eyebrow>Playbooks</Eyebrow>
              <CardTitle>The skills Aria runs on</CardTitle>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Each skill is markdown the agent reads at runtime plus the tuned parameters it has
                learned. Edit any playbook directly. Your changes take effect on the next run.
              </p>
            </div>

            {orderedSkills.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-7 w-7" />}
                title="No skills loaded"
                description="The default sourcing, scoring, outreach, and reply-classification playbooks will appear here once the demo data initializes."
              />
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                {orderedSkills.map((skill) => (
                  <SkillCard key={skill.key} skill={skill} canEdit={canEditSkills} />
                ))}
              </div>
            )}
          </section>
        </div>
      </HydrationGate>
    </div>
  );
}
