"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, CardTitle, Badge } from "@/components/ui";
import { MonitorSmartphone, Sparkles } from "lucide-react";

type Lesson = {
  at: string;
  goal: string;
  ok: boolean;
  detail: string;
  preferredName?: string;
};

/**
 * VM second-brain panel — LinkedIn UI usage lessons (not outreach copy).
 * Fed by OpenBot send outcomes; next runs prefer winning controls.
 */
export function LinkedInUiLessonsCard() {
  const [lessons, setLessons] = React.useState<Lesson[]>([]);
  const [summary, setSummary] = React.useState({ total: 0, wins: 0, fails: 0 });

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
          summary?: { total: number; wins: number; fails: number };
        };
        if (cancelled) return;
        setLessons(Array.isArray(json.lessons) ? json.lessons.slice(-8).reverse() : []);
        if (json.summary) setSummary(json.summary);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
            Agents remember which LinkedIn controls worked — Message vs Connect, note fields,
            Send proof — and get sharper on the next seat run. Copy learning stays in outreach
            skill; this is VM chrome memory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">{summary.total} lessons</Badge>
          <Badge tone="success">{summary.wins} wins</Badge>
          <Badge tone="warning">{summary.fails} fails</Badge>
        </div>
        {lessons.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No UI lessons yet. After Take control + a sealed send attempt, wins and fails land
            here automatically.
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
