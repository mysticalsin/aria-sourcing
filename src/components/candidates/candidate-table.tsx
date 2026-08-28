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
  formatTimeAgo,
  initialsFrom,
  scoreTone,
  toneForStage,
  type Tone,
} from "@/lib/utils";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { deriveLeadSource, deriveStarRating, DEFAULT_STAR_THRESHOLDS } from "@/lib/tania";
import { SourceBadge, StarBadge } from "@/components/tania/badges";
import { ProvenanceChip } from "@/components/candidates/consent-passport";
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
  const starThresholds = settings.starRatingThresholds ?? DEFAULT_STAR_THRESHOLDS;
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
    <Table caption="Candidates" className="min-w-[40rem]">
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
          <TH>Last activity</TH>
          <TH>Flags</TH>
        </TR>
      </THead>
      <TBody>
        {candidates.map((c) => {
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
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-xs font-bold text-ink-soft"
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
                  <span className="text-sm text-ink-soft">
                    {campaignTitle.get(c.campaignId) ?? "—"}
                  </span>
                </TD>
              )}
              <TD>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SourceBadge source={deriveLeadSource(c)} size="sm" />
                  {/* The "Source" filter above narrows by the literal sourcePlatform
                      (GitHub, LinkedIn, ...), but SourceBadge only shows the collapsed
                      lead-source taxonomy (Applicant/Referral/Outbound) — surface the
                      literal platform too so a platform filter stays visually verifiable
                      (see CAND-P1-1). */}
                  <span className="text-xs text-muted">{c.sourcePlatform}</span>
                  <ProvenanceChip candidate={c} />
                  {c.vivier && (
                    <Badge tone="violet" size="sm" title="In #Vivier (talent pool)">
                      <Bookmark className="h-3 w-3" aria-hidden /> Vivier
                    </Badge>
                  )}
                  {c.provenance === "synthetic" && (
                    <Badge tone="warning" size="sm" title="Demo data: not a real sourced profile">
                      Synthetic
                    </Badge>
                  )}
                  {c.provenance === "manual" && (
                    <Badge tone="warning" size="sm" title="Operator-entered profile">
                      Manual
                    </Badge>
                  )}
                  {c.provenance === "live" && (
                    <Badge
                      tone="success"
                      size="sm"
                      title="Returned by live provider/API (sourcing-agent, GitHub, Apollo, …)"
                    >
                      Live
                    </Badge>
                  )}
                </div>
              </TD>
              <TD>
                <div className="flex items-center gap-2">
                  <StarBadge rating={c.starRating ?? deriveStarRating(c.matchScore, starThresholds)} size="sm" showLabel={false} />
                  <span className="text-xs font-semibold tabular-nums text-ink-soft">{Math.round(c.matchScore)}</span>
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
                <span className="whitespace-nowrap text-sm text-muted tabular-nums">
                  {formatTimeAgo(lastIso)}
                </span>
              </TD>
              <TD>
                {flags.length === 0 ? (
                  <span className="text-muted" aria-label="No compliance flags">
                    —
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {flags.map((f) => (
                      <span
                        key={f.key}
                        title={f.label}
                        aria-label={f.label}
                        className={
                          f.tone === "danger"
                            ? "flex h-6 w-6 items-center justify-center rounded-full bg-danger-soft text-danger"
                            : f.tone === "warning"
                              ? "flex h-6 w-6 items-center justify-center rounded-full bg-warning-soft text-[hsl(32_90%_34%)]"
                              : f.tone === "violet"
                                ? "flex h-6 w-6 items-center justify-center rounded-full bg-violet-soft text-violet"
                                : "flex h-6 w-6 items-center justify-center rounded-full bg-aqua-soft text-aqua"
                        }
                      >
                        {f.icon}
                      </span>
                    ))}
                  </div>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
