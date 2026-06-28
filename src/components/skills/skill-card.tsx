"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Field,
  Textarea,
  useToast,
} from "@/components/ui";
import { useActions } from "@/lib/store";
import type { AgentSkill, AgentSkillParams } from "@/lib/types";
import { cn, formatTimeAgo, formatNumber, round } from "@/lib/utils";
import {
  FileCode2,
  Save,
  RotateCcw,
  History,
  ChevronDown,
  SlidersHorizontal,
  TrendingUp,
  Activity as ActivityIcon,
  BookOpen,
} from "lucide-react";

/* Human-readable labels for the scoring weight dimensions. */
const WEIGHT_LABELS: Record<string, string> = {
  skills: "Skills",
  experience: "Experience",
  companyStage: "Company stage",
  industry: "Industry",
  location: "Location",
  activity: "Activity",
};

/** Flatten the learned params into a tidy {label, value} list for the summary. */
function paramSummary(params: AgentSkillParams): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];

  if (params.preferredTone) out.push({ label: "Tone", value: params.preferredTone });

  if (typeof params.leadWithArtifact === "boolean") {
    out.push({ label: "Lead with artifact", value: params.leadWithArtifact ? "Yes" : "No" });
  }

  if (params.qualifiedInterestFloor != null) {
    out.push({ label: "Interest floor", value: String(params.qualifiedInterestFloor) });
  }

  if (params.preferredPlatforms && params.preferredPlatforms.length > 0) {
    out.push({ label: "Platforms", value: params.preferredPlatforms.join(" · ") });
  }

  if (params.weights && Object.keys(params.weights).length > 0) {
    const weights = Object.entries(params.weights)
      .filter(([, v]) => typeof v === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number));
    for (const [key, v] of weights) {
      out.push({ label: WEIGHT_LABELS[key] ?? key, value: `${round(v as number)}%` });
    }
  }

  return out;
}

export function SkillCard({ skill }: { skill: AgentSkill }) {
  const actions = useActions();
  const { toast } = useToast();

  const [content, setContent] = React.useState(skill.content);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // Re-sync local draft if the underlying skill changes (e.g. learning accepted).
  React.useEffect(() => {
    setContent(skill.content);
  }, [skill.content]);

  const dirty = content !== skill.content;
  const params = paramSummary(skill.params);
  const signal = skill.metrics.outcomeSignal;
  const historyId = `skill-history-${skill.key}`;
  const contentId = `skill-content-${skill.key}`;

  function save() {
    if (!dirty) return;
    const res = actions.updateSkillContent(skill.key, content);
    if (!res.ok) {
      toast({ title: "Playbook rejected", description: res.error ?? "This content violates a guardrail.", variant: "error" });
      return;
    }
    toast({
      title: "Playbook saved",
      description: `${skill.title} updated. The agent uses this on the next run.`,
      variant: "success",
    });
  }

  function reset() {
    setContent(skill.content);
  }

  return (
    <Card className="flex h-full flex-col animate-fade-in">
      <CardContent className="flex flex-1 flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>
              <BookOpen className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-tangerine" aria-hidden />
              Living playbook
            </Eyebrow>
            <h3 className="mt-0.5 text-lg font-bold leading-tight text-ink">{skill.title}</h3>
            <code className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
              <FileCode2 className="h-3.5 w-3.5 text-muted" aria-hidden />
              {skill.filename}
            </code>
          </div>
          <Badge tone="violet" dot>
            v{skill.version}
          </Badge>
        </div>

        <p className="text-sm leading-relaxed text-ink-soft">{skill.description}</p>

        {/* Tuned parameters */}
        {params.length > 0 && (
          <div className="rounded-2xl bg-ink/[0.04] px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Tuned parameters
            </div>
            <dl className="mt-2.5 flex flex-wrap gap-2">
              {params.map((p) => (
                <div
                  key={`${p.label}-${p.value}`}
                  className="inline-flex items-baseline gap-1.5 rounded-xl bg-surface px-2.5 py-1 ring-1 ring-line"
                >
                  <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted">
                    {p.label}
                  </dt>
                  <dd className="font-mono text-xs font-semibold text-ink">{p.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Metrics summary */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            <ActivityIcon className="h-3.5 w-3.5" aria-hidden />
            Applied {formatNumber(skill.metrics.applied)}×
          </Badge>
          <Badge tone={signal > 0 ? "success" : "neutral"}>
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Outcome signal {signal > 0 ? "+" : ""}
            {round(signal, 1)}
          </Badge>
          <span className="ml-auto text-xs text-muted">Updated {formatTimeAgo(skill.updatedAt)}</span>
        </div>

        {/* Editable content */}
        <Field
          label="Playbook content"
          htmlFor={contentId}
          hint="Markdown the agent reads at runtime. Edits take effect on the next sourcing or outreach run."
        >
          <Textarea
            id={contentId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="min-h-[200px] font-mono text-xs leading-relaxed"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save className="h-4 w-4" />}
            onClick={save}
            disabled={!dirty}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="h-4 w-4" />}
            onClick={reset}
            disabled={!dirty}
          >
            Reset
          </Button>
          {dirty && (
            <Badge tone="warning" size="sm" dot>
              Unsaved changes
            </Badge>
          )}
        </div>

        {/* Version history */}
        <div className="mt-auto border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls={historyId}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-1 py-1 text-left text-sm font-semibold text-ink-soft transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <span className="flex items-center gap-1.5">
              <History className="h-4 w-4 text-muted" aria-hidden />
              Version history
              <span className="font-normal text-muted">({skill.history.length})</span>
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-muted transition-transform", historyOpen && "rotate-180")}
              aria-hidden
            />
          </button>

          {historyOpen && (
            <ol id={historyId} className="mt-2 space-y-2.5 pl-1">
              {skill.history.map((h) => (
                <li key={h.version} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-soft font-mono text-[0.6875rem] font-bold text-violet">
                    v{h.version}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-snug text-ink">{h.summary}</p>
                    <p className="text-xs text-muted">{formatTimeAgo(h.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
