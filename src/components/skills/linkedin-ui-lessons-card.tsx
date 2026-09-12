"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, CardTitle, Badge } from "@/components/ui";
import { MonitorSmartphone, Sparkles, Zap } from "lucide-react";

type Lesson = {
  at: string;
  goal: string;
  ok: boolean;
  detail: string;
  preferredName?: string;
};

type Efficiency = {
  lessons: number;
  llmSkips: number;
  tokensSaved: number;
  paceMultiplier: number;
  topControls: Array<{
    goal: string;
    name: string;
    wins: number;
    fails: number;
    confidence: number;
  }>;
};

/**
 * VM second-brain panel — LinkedIn UI usage lessons (not outreach copy).
 * Shows how each lesson compounds into fewer LLM picks and faster pacing.
 */
export function LinkedInUiLessonsCard() {
  const [lessons, setLessons] = React.useState<Lesson[]>([]);
  const [summary, setSummary] = React.useState({
    total: 0,
    wins: 0,
    fails: 0,
    llmSkips: 0,
    tokensSaved: 0,
    paceMultiplier: 1,
  });
  const [topControls, setTopControls] = React.useState<Efficiency["topControls"]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/knowledge/linkedin-ui-lessons", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          lessons?: Lesson[];
          summary?: {
            total: number;
            wins: number;
            fails: number;
            llmSkips?: number;
            tokensSaved?: number;
            paceMultiplier?: number;
          };
          efficiency?: Efficiency;
        };
        if (cancelled) return;
        setLessons(Array.isArray(json.lessons) ? json.lessons.slice(-8).reverse() : []);
        if (json.summary) {
          setSummary({
            total: json.summary.total,
            wins: json.summary.wins,
            fails: json.summary.fails,
            llmSkips: json.summary.llmSkips ?? 0,
            tokensSaved: json.summary.tokensSaved ?? 0,
            paceMultiplier: json.summary.paceMultiplier ?? 1,
          });
        }
        if (json.efficiency?.topControls) setTopControls(json.efficiency.topControls);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pacePct = Math.round((1 - summary.paceMultiplier) * 100);

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4">
        <div>
          <Eyebrow>
            <MonitorSmartphone
              className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-tangerine"
              aria-hidden
            />
            Browser Computer · second brain
          </Eyebrow>
          <CardTitle className="mt-0.5">LinkedIn UI lessons</CardTitle>
          <p className="mt-1 text-sm text-ink-soft">
            Every win compounds: confident desks skip Aria LLM picks, shrink prompts, and
            accelerate pacing. Copy learning stays in outreach skill — this is VM chrome memory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">{summary.total} lessons</Badge>
          <Badge tone="success">{summary.wins} wins</Badge>
          <Badge tone="warning">{summary.fails} fails</Badge>
          <Badge tone="neutral">
            <Zap className="mr-1 inline h-3 w-3" aria-hidden />
            {summary.llmSkips} LLM skips
          </Badge>
          <Badge tone="success">~{summary.tokensSaved} tokens saved</Badge>
          {pacePct > 0 ? <Badge tone="success">{pacePct}% faster waits</Badge> : null}
        </div>
        {topControls.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-canvas/40 px-3 py-2 text-sm">
            <div className="mb-1 text-xs font-medium text-ink-soft">Top controls by confidence</div>
            <ul className="flex flex-col gap-1">
              {topControls.slice(0, 4).map((c) => (
                <li key={`${c.goal}-${c.name}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-ink-soft">{c.goal}</span>
                  <Badge tone={c.confidence >= 0.7 ? "success" : "neutral"}>
                    {(c.confidence * 100).toFixed(0)}%
                  </Badge>
                  <span className="text-xs text-ink-soft">
                    {c.wins}w/{c.fails}f
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {lessons.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No UI lessons yet. After Take control + a sealed send attempt, wins and fails land
            here automatically — and start cutting tokens on the next run.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lessons.map((l, i) => (
              <li
                key={`${l.at}-${i}`}
                className="rounded-md border border-border/60 bg-canvas/40 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.ok ? "success" : "warning"}>{l.ok ? "OK" : "FAIL"}</Badge>
                  <span className="font-medium">{l.goal}</span>
                  {l.preferredName ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      {l.preferredName}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-ink-soft">{l.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
