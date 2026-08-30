"use client";

import * as React from "react";
import { Badge, Button, Field, Select } from "@/components/ui";
import { useActivities, useActions, useSettings } from "@/lib/store";
import { formatTimeAgo } from "@/lib/utils";
import type { Tone } from "@/lib/utils";
import type { Candidate, CandidateLawfulBasis } from "@/lib/types";
import { recordedCandidateLawfulBasis } from "@/lib/candidate-lawful-basis";
import { recordedCandidateFitEndorsement } from "@/lib/candidate-fit-endorsement";
import { Eye, ShieldCheck, Timer } from "lucide-react";

/** WORKSTREAM 4.4 — Consent Passport & Data Lineage.
 *
 *  Display derivation over persisted candidate/activity fields, plus the
 *  operator control that records lawful basis (enforced in rules.ts). Labels
 *  reflect operator inputs and are not a legal determination. */

const ILLUSTRATIVE_LABEL =
  "Illustrative compliance display only; not a legal determination.";

interface ConsentBasis {
  sourceLabel: string;
  basisLabel: string;
  tone: Tone;
}

/** Derives a source + lawful-basis pair from persisted provenance/source data.
 *  Referral and Talent Pool leads are modeled as
 *  consent-based (the person opted in / was introduced); everything else with
 *  a public sourceUrl is modeled as legitimate interest over public profile
 *  data; anything without a sourceUrl falls back to a generic sourced-outreach
 *  legitimate-interest basis. */
function deriveConsentBasis(
  candidate: Pick<
    Candidate,
    | "sourcePlatform"
    | "sourceUrl"
    | "provenance"
    | "lawfulBasis"
    | "lawfulBasisRecordedAt"
    | "lawfulBasisSource"
  >,
): ConsentBasis {
  const recordedBasis = recordedCandidateLawfulBasis(candidate);
  if (recordedBasis === "consent") {
    return {
      sourceLabel:
        candidate.provenance === "manual"
          ? "Manual entry"
          : candidate.sourcePlatform || "Sourced",
      basisLabel: "Consent (operator recorded)",
      tone: "violet",
    };
  }
  if (recordedBasis === "legitimate_interest") {
    return {
      sourceLabel:
        candidate.provenance === "manual"
          ? "Manual entry"
          : candidate.sourcePlatform || "Sourced",
      basisLabel: "Legitimate interest (operator recorded)",
      tone: "aqua",
    };
  }
  if (candidate.provenance === "manual") {
    return {
      sourceLabel: "Manual entry",
      basisLabel: "Lawful basis not recorded",
      tone: "warning",
    };
  }
  if (candidate.sourcePlatform === "Referral") {
    return { sourceLabel: "Referral", basisLabel: "Consent (referral introduction)", tone: "violet" };
  }
  if (candidate.sourcePlatform === "Talent Pool") {
    return { sourceLabel: "Talent pool", basisLabel: "Consent (opted-in pool)", tone: "violet" };
  }
  if (candidate.sourceUrl || candidate.sourcePlatform === "LinkedIn") {
    return {
      sourceLabel: `${candidate.sourcePlatform} · public profile`,
      basisLabel: "Lawful basis not recorded — required before approve",
      tone: "warning",
    };
  }
  return {
    sourceLabel: candidate.sourcePlatform,
    basisLabel: "Lawful basis not recorded — required before approve",
    tone: "warning",
  };
}

/** Small provenance chip for candidate rows — same derivation as the passport,
 *  compressed to a single badge with the detail in the title tooltip. */
export function ProvenanceChip({
  candidate,
}: {
  candidate: Pick<
    Candidate,
    | "sourcePlatform"
    | "sourceUrl"
    | "provenance"
    | "lawfulBasis"
    | "lawfulBasisRecordedAt"
    | "lawfulBasisSource"
  >;
}) {
  const { sourceLabel, basisLabel, tone } = deriveConsentBasis(candidate);
  return (
    <Badge tone={tone} size="sm" title={`${sourceLabel} · ${basisLabel}`}>
      {sourceLabel}
    </Badge>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Retention countdown = compliance retention-days setting minus the record's
 *  age (now − createdAt). Negative remaining means the record has outlived
 *  the configured retention window. */
function retentionInfo(createdAt: string, retentionDays: number) {
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / DAY_MS));
  return { ageDays, remaining: retentionDays - ageDays };
}

/** The PII-reveal activity's `notes` is written as "…Purpose: outreach." by
 *  recordPiiReveal in store.ts — pull the stated purpose out for display,
 *  falling back to the raw note if the format ever changes. */
function purposeFromNotes(notes: string): string {
  const match = notes.match(/Purpose:\s*(.+)$/i);
  return match ? match[1].trim() : notes;
}

export function ConsentPassport({ candidate }: { candidate: Candidate }) {
  const activities = useActivities();
  const settings = useSettings();
  const { recordCandidateLawfulBasis, endorseCandidateFit } = useActions();
  const retentionDays = settings.compliance.candidateRetentionDays;
  const recorded = recordedCandidateLawfulBasis(candidate);
  const fitEndorsed = recordedCandidateFitEndorsement(candidate);
  const needsFitEndorsement =
    candidate.matchScore < settings.minScoreToContact && !fitEndorsed;
  const [pendingBasis, setPendingBasis] = React.useState<CandidateLawfulBasis | "">("");
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [endorseError, setEndorseError] = React.useState<string | null>(null);

  const { sourceLabel, basisLabel, tone } = deriveConsentBasis(candidate);
  const { ageDays, remaining } = retentionInfo(candidate.createdAt, retentionDays);

  // Reveal ledger: PII-reveal activities linked to this exact candidate.
  // Activities carry no per-event actor field in this single-operator demo,
  // so "operator" reflects the current settings.operatorName — the same
  // attribution the rest of the app uses (e.g. approvedBy in store.ts).
  const ledger = activities
    .filter(
      (a) =>
        a.type === "compliance" &&
        a.linkedEntityType === "candidate" &&
        a.linkedEntityId === candidate.id &&
        a.title === "Candidate PII revealed",
    )
    .map((a) => ({
      id: a.id,
      at: a.createdAt,
      operator: settings.operatorName,
      purpose: purposeFromNotes(a.notes),
    }));

  const onRecord = () => {
    if (!pendingBasis) {
      setRecordError("Select consent or legitimate interest.");
      return;
    }
    const result = recordCandidateLawfulBasis(candidate.id, pendingBasis);
    if (!result.ok) {
      setRecordError(result.error);
      return;
    }
    setRecordError(null);
    setPendingBasis("");
  };

  const onEndorseFit = () => {
    const result = endorseCandidateFit(candidate.id);
    if (!result.ok) {
      setEndorseError(result.error);
      return;
    }
    setEndorseError(null);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-canvas/60 p-4">
      <p className="inline-flex items-center gap-1.5 text-xs italic text-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {ILLUSTRATIVE_LABEL}
      </p>

      {/* Source + lawful basis — display chips + operator recording. */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Source & lawful basis</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="electric" size="sm">
            {sourceLabel}
          </Badge>
          <Badge tone={tone} size="sm">
            {basisLabel}
          </Badge>
        </div>
        {!recorded && !candidate.complianceFlags?.anonymized ? (
          <div className="mt-3 space-y-2 rounded-xl bg-ink/[0.03] p-3">
            <Field
              label="Record lawful basis"
              htmlFor={`lawful-basis-${candidate.id}`}
              hint="Required before outreach approval. Aria records your choice; it does not make the legal determination."
            >
              <Select
                id={`lawful-basis-${candidate.id}`}
                value={pendingBasis}
                onChange={(event) => {
                  setPendingBasis(event.target.value as CandidateLawfulBasis | "");
                  setRecordError(null);
                }}
                options={[
                  { value: "", label: "Select a basis…" },
                  { value: "consent", label: "Consent" },
                  { value: "legitimate_interest", label: "Legitimate interest" },
                ]}
              />
            </Field>
            {recordError ? <p className="text-xs text-danger">{recordError}</p> : null}
            <Button type="button" size="sm" onClick={onRecord} disabled={!pendingBasis}>
              Save lawful basis
            </Button>
          </div>
        ) : null}
        {needsFitEndorsement && !candidate.complianceFlags?.anonymized ? (
          <div className="mt-3 space-y-2 rounded-xl bg-ink/[0.03] p-3">
            <p className="text-sm text-ink-soft">
              Match score {candidate.matchScore} is below the {settings.minScoreToContact} contact
              floor. After reviewing the profile, endorse role fit so Approve can proceed with a
              warning (score stays unchanged).
            </p>
            {endorseError ? <p className="text-xs text-danger">{endorseError}</p> : null}
            <Button type="button" size="sm" variant="outline" onClick={onEndorseFit}>
              Endorse role fit for outreach
            </Button>
          </div>
        ) : null}
        {fitEndorsed ? (
          <p className="mt-2 text-xs text-muted">
            Role fit endorsed {candidate.fitEndorsedAt ? formatTimeAgo(candidate.fitEndorsedAt) : ""}.
            Approval will warn that the score is below the contact floor.
          </p>
        ) : null}
      </div>

      {/* Retention countdown. */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Retention</p>
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          {remaining > 0 ? (
            <p className="text-sm text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">{remaining}</span>
              {` of ${retentionDays} days remaining `}
              <span className="text-xs text-muted">(record is {ageDays}d old)</span>
            </p>
          ) : (
            <Badge tone="danger" size="sm">
              Retention window elapsed {Math.abs(remaining)}d ago, flag for review
            </Badge>
          )}
        </div>
      </div>

      {/* Reveal ledger — filtered from activities, PII not exposed here. */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Reveal ledger</p>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted">No PII reveals recorded for this candidate.</p>
        ) : (
          <ul className="space-y-1.5">
            {ledger.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-ink/[0.03] px-3 py-2 text-sm"
              >
                <span className="inline-flex items-center gap-1.5 font-medium text-ink-soft">
                  <Eye className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  {entry.operator}
                </span>
                <span className="text-xs text-muted">{entry.purpose}</span>
                <span className="text-xs text-muted tabular-nums">{formatTimeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
