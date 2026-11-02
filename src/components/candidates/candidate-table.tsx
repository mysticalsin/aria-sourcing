"use client";

import * as React from "react";
import {
  Badge,
  EmptyState,
  Progress,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { useCampaigns, useSettings } from "@/lib/store";
import {
  cn,
  formatTimeAgo,
  initialsFrom,
  scoreTone,
  toneForStage,
  type Tone,
} from "@/lib/utils";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { ProvenanceChip } from "@/components/candidates/consent-passport";
import { candidateReview } from "@/lib/candidate-review";
import type { Candidate, ComplianceFlags } from "@/lib/types";
import { Ban, Bookmark, Download, EyeOff, Lock, MailX, UserX, Users } from "lucide-react";

interface FlagDescriptor {
  key: keyof ComplianceFlags;
  label: string;
  tone: Tone;
  icon: React.ReactNode;
}

function activeFlags(flags: ComplianceFlags): FlagDescriptor[] {
  const out: FlagDescriptor[] = [];
  if (flags.doNotContact)
    out.push({ key: "doNotContact", label: "Do not contact", tone: "danger", icon: <Ban className="h-3.5 w-3.5" /> });
  if (flags.suppressed)
    out.push({ key: "suppressed", label: "Suppressed", tone: "danger", icon: <EyeOff className="h-3.5 w-3.5" /> });
  if (flags.unsubscribed)
    out.push({ key: "unsubscribed", label: "Unsubscribed", tone: "warning", icon: <MailX className="h-3.5 w-3.5" /> });
  if (flags.anonymized)
    out.push({ key: "anonymized", label: "Anonymized", tone: "violet", icon: <UserX className="h-3.5 w-3.5" /> });
  if (flags.gdprExportRequested)
    out.push({ key: "gdprExportRequested", label: "GDPR export requested", tone: "aqua", icon: <Download className="h-3.5 w-3.5" /> });
  return out;
}

export function CandidateTable({
  candidates,
  onSelect,
  showCampaign = false,
  emptyState,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: {
  candidates: Candidate[];
  onSelect: (c: Candidate) => void;
  showCampaign?: boolean;
  /** Overrides the empty-state copy — e.g. to distinguish "no data at all" from
   *  "filters matched nothing" (see CAND-P1-2). Falls back to the default. */
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  /** Providing both enables the bulk-select checkbox column (see CAND-P1-4).
   *  Omit both to keep a plain, unselectable table (e.g. the campaign detail page). */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}) {
  const campaigns = useCampaigns();
  const settings = useSettings();
  const confidentialityMode = Boolean(settings.confidentialityMode);
  const campaignTitle = React.useMemo(() => {
    const map = new Map<string, string>();
    campaigns.forEach((c) => map.set(c.id, c.title));
    return map;
  }, [campaigns]);
  const selectable = Boolean(selectedIds && onToggleSelect);

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title={emptyState?.title ?? "No candidates yet"}
        description={
          emptyState?.description ??
          "Source a batch to populate the pipeline. Matched candidates will appear here ranked by fit."
        }
        action={emptyState?.action}
      />
    );
  }

  const allSelected = selectable && candidates.every((c) => selectedIds!.has(c.id));

  return (
    <>
    {/* Under 640px a table cannot fit: one card per candidate instead. */}
    <ul className="space-y-2 sm:hidden" aria-label="Candidates">
      {candidates.map((c) => {
        const review = candidateReview(c, campaigns.find((campaign) => campaign.id === c.campaignId), settings);
        const display = applyConfidentiality(c, { confidentialityMode, reveal: hasOutreachPurpose(c.stage) });
        return (
          <li key={c.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3">
            {selectable && (
              <input
                type="checkbox"
                checked={selectedIds!.has(c.id)}
                onChange={() => onToggleSelect!(c.id)}
                aria-label={`Select ${c.name}`}
                className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
              />
            )}
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-ink">{display.name}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink" aria-label={`Match score ${Math.round(c.matchScore)} of 100`}>
                  {Math.round(c.matchScore)}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {[c.currentTitle, c.currentCompany].filter(Boolean).join(" @ ") || "Role not provided"}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={toneForStage(c.stage)} size="sm" dot>
                  {c.stage}
                </Badge>
                <ProvenanceChip candidate={c} />
                {activeFlags(c.complianceFlags).map((f) => (
                  <Badge key={f.key} tone={f.tone} size="sm">
                    {f.label}
                  </Badge>
                ))}
                <span className="truncate text-xs font-semibold text-ink-soft" title={review.detail}>{review.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
    {/* Compact rows (about 56px): one line per cell, so a laptop screen shows
        ten or more candidates at once. */}
    <div className="hidden sm:block">
    <Table caption="Candidates" className="min-w-[40rem] [&_td]:py-2">
      <THead>
        <TR className="border-b border-line">
          {selectable && (
            <TH>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Select all candidates"
                className="h-4 w-4 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
              />
            </TH>
          )}
          <TH>Candidate</TH>
          {showCampaign && <TH>Campaign</TH>}
          <TH>Source</TH>
          <TH>Match</TH>
          <TH>Stage</TH>
          <TH className="whitespace-nowrap">Next action</TH>
          <TH className="whitespace-nowrap">Last activity</TH>
        </TR>
      </THead>
      <TBody>
        {candidates.map((c) => {
          const review = candidateReview(c, campaigns.find((campaign) => campaign.id === c.campaignId), settings);
          const flags = activeFlags(c.complianceFlags);
          const lastIso = c.lastContactedAt ?? c.createdAt;
          const masked = confidentialityMode && !hasOutreachPurpose(c.stage);
          const display = applyConfidentiality(c, {
            confidentialityMode,
            reveal: hasOutreachPurpose(c.stage),
          });
          const initials = display.avatarInitials || initialsFrom(display.name);
          return (
            <TR
              key={c.id}
              onClick={() => onSelect(c)}
              className="cursor-pointer transition-colors hover:bg-canvas"
            >
              {selectable && (
                <TD>
                  <input
                    type="checkbox"
                    checked={selectedIds!.has(c.id)}
                    onChange={() => onToggleSelect!(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${c.name}`}
                    className="h-4 w-4 rounded border-line accent-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                  />
                </TD>
              )}
              <TD>
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-bold text-ink-soft"
                    aria-hidden
                  >
                    {initials}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(c);
                        }}
                        className="block truncate text-left text-sm font-semibold text-ink hover:text-tangerine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric rounded"
                      >
                        {display.name}
                      </button>
                      {masked && (
                        <span
                          title="PII minimized (confidential)"
                          aria-label="PII minimized (confidential)"
                          className="shrink-0 text-violet"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      )}
                      {/* Compliance flags are rare, so they sit beside the name
                          instead of holding a column of dashes. */}
                      {flags.map((f) => (
                        <span
                          key={f.key}
                          title={f.label}
                          aria-label={f.label}
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                            f.tone === "danger"
                              ? "bg-danger-soft text-danger"
                              : f.tone === "warning"
                                ? "bg-warning-soft text-[hsl(32_90%_34%)]"
                                : f.tone === "violet"
                                  ? "bg-violet-soft text-violet"
                                  : "bg-aqua-soft text-aqua",
                          )}
                        >
                          {f.icon}
                        </span>
                      ))}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {[c.currentTitle, c.currentCompany].filter(Boolean).join(" @ ") ||
                        "Role not provided"}
                    </p>
                  </div>
                </div>
              </TD>
              {showCampaign && (
                <TD>
                  <span className="block max-w-[10rem] truncate text-sm text-ink-soft" title={campaignTitle.get(c.campaignId)}>
                    {campaignTitle.get(c.campaignId) ?? "—"}
                  </span>
                </TD>
              )}
              <TD>
                {/* One source pill: the literal platform (what the Source filter
                    narrows by) or "Manual entry", coloured by lawful-basis status,
                    with the basis in its tooltip. Demo provenance is shown once in
                    the top bar, not on every row. */}
                <div className="flex items-center gap-1.5">
                  <ProvenanceChip candidate={c} />
                  {c.vivier && (
                    <span title="In the talent pool" className="shrink-0 text-violet">
                      <Bookmark className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">In the talent pool</span>
                    </span>
                  )}
                </div>
              </TD>
              <TD>
                <div className="flex items-center gap-2">
                  <span className="w-7 text-xs font-semibold tabular-nums text-ink-soft">{Math.round(c.matchScore)}</span>
                  <Progress
                    value={c.matchScore}
                    tone={scoreTone(c.matchScore)}
                    className="hidden w-16 sm:block"
                    aria-label={`Match score ${Math.round(c.matchScore)} of 100`}
                  />
                </div>
              </TD>
              <TD>
                <Badge tone={toneForStage(c.stage)} size="sm" dot>
                  {c.stage}
                </Badge>
              </TD>
              <TD>
                <span className="block max-w-[12rem] truncate text-xs font-semibold text-ink-soft" title={review.detail}>{review.label}</span>
              </TD>
              <TD>
                <span className="whitespace-nowrap text-sm text-muted tabular-nums">
                  {formatTimeAgo(lastIso)}
                </span>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
    </div>
    </>
  );
}
