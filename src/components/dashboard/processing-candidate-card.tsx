"use client";

import { Card, Eyebrow } from "@/components/ui";

export interface ScoreDimension {
  label: string;
  score: number;
  weight: number;
  contribution: number;
  rationale: string;
}

function points(item: ScoreDimension): string {
  return `${Math.round(item.contribution)}/${Math.round(item.weight * 100)}`;
}

/** Explainable match score. The number is a suggestion, never a decision. */
export function ProcessingCandidateCard({
  name,
  title,
  company,
  stageLabel,
  score,
  breakdown,
}: {
  name: string;
  title: string;
  company: string;
  stageLabel: string;
  score: number | null;
  breakdown: readonly ScoreDimension[] | null;
}) {
  const unknown = breakdown?.some((item) => /unknown/i.test(item.rationale)) ?? false;
  return (
    <Card className="p-5">
      <Eyebrow>{stageLabel}</Eyebrow>
      <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-ink">{name}</h3>
      <p className="mt-1 text-sm text-muted">
        {title}
        {company ? ` · ${company}` : ""}
      </p>
      <p className="mt-4 text-3xl font-extrabold tabular-nums leading-none text-ink">
        {score == null ? "Score unavailable" : score}
        {score != null && <span className="ml-2 text-sm font-semibold text-muted">suggestion only</span>}
      </p>
      {breakdown == null || breakdown.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No scoring breakdown yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {breakdown.map((item) => (
            <li key={item.label} className="border-t border-line pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{item.label}</span>
                <span className="text-sm font-bold tabular-nums text-ink">{points(item)}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{item.rationale}</p>
            </li>
          ))}
        </ul>
      )}
      {unknown && (
        <p className="mt-3 text-xs leading-relaxed text-muted">Unknowns count at a fixed 30, never invented.</p>
      )}
    </Card>
  );
}
