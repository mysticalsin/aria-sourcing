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
import type { Candidate, ComplianceFlags } from "@/lib/types";
import { Ban, Download, EyeOff, Lock, MailX, UserX, Users } from "lucide-react";

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
}: {
  candidates: Candidate[];
  onSelect: (c: Candidate) => void;
  showCampaign?: boolean;
}) {
  const campaigns = useCampaigns();
  const confidentialityMode = Boolean(useSettings().confidentialityMode);
  const campaignTitle = React.useMemo(() => {
    const map = new Map<string, string>();
    campaigns.forEach((c) => map.set(c.id, c.title));
    return map;
  }, [campaigns]);

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="No candidates yet"
        description="Source a batch to populate the pipeline. Matched candidates will appear here ranked by fit."
      />
    );
  }

  return (
    <Table caption="Candidates" className="min-w-[40rem]">
      <THead>
        <TR className="border-b border-line">
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
                          title="PII minimized — confidential"
                          aria-label="PII minimized — confidential"
                          className="shrink-0 text-violet"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {c.currentTitle} @ {c.currentCompany}
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
                <Badge tone="neutral" size="sm">
                  {c.sourcePlatform}
                </Badge>
              </TD>
              <TD>
                <div className="flex items-center gap-2">
                  <Badge tone={scoreTone(c.matchScore)} size="sm">
                    {Math.round(c.matchScore)}
                  </Badge>
                  <Progress
                    value={c.matchScore}
                    tone={scoreTone(c.matchScore)}
                    className="w-16"
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
