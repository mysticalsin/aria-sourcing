"use client";

import type { MatchEvidence } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

/**
 * Structured must-have / language / geo rationale for a shortlisted candidate.
 */
export function MatchEvidencePanel({ evidence }: { evidence: MatchEvidence }) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Why they fit</p>
        {evidence.hardGatePass ? (
          <Badge tone="success" size="sm">
            Gates clear
          </Badge>
        ) : (
          <Badge tone="danger" size="sm">
            Hard reject
          </Badge>
        )}
        {evidence.openToWork ? (
          <Badge tone="aqua" size="sm">
            Open to Work
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">{evidence.summary}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <EvidenceList
          label="Must-haves hit"
          items={evidence.mustHaveHits}
          empty="None"
          tone="success"
        />
        <EvidenceList
          label="Must-haves miss"
          items={evidence.mustHaveMisses}
          empty="None"
          tone="danger"
        />
        <EvidenceList
          label="Languages hit"
          items={evidence.languageHits}
          empty="n/a"
          tone="success"
        />
        <EvidenceList
          label="Languages miss"
          items={evidence.languageMisses}
          empty="n/a"
          tone="danger"
        />
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted">
        <span>Geo: {evidence.geoPass ? "ok" : "fail"}</span>
        <span>
          Seniority:{" "}
          {evidence.seniorityPass === null
            ? "unknown years"
            : evidence.seniorityPass
              ? "in band"
              : "out of band"}
        </span>
      </div>
      {!evidence.hardGatePass && evidence.hardGateReasons.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-danger">
          {evidence.hardGateReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EvidenceList({
  label,
  items,
  empty,
  tone,
}: {
  label: string;
  items: string[];
  empty: string;
  tone: "success" | "danger";
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {items.length === 0 ? (
        <span className="text-xs text-muted">{empty}</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={item} tone={tone} size="sm">
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
