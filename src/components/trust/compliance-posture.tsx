"use client";

/* ============================================================================
   4.3 Trust & ROI Proof Center — compliance posture panel.

   Every tile below is a real, derived read of store state -- PII reveals are
   counted from the "compliance" activity log that recordPiiReveal() writes
   (candidate-drawer.tsx / reply-card.tsx), suppression adherence is checked
   by cross-referencing the suppression list against outreach that could
   still go out, and rate-limit adherence reads each seat's actual
   sentToday/dailyLimit. Nothing is asserted -- each number is computed here,
   and each tile deep-links into Sessions where the underlying activity log
   lives so a buyer can verify it themselves.
   ========================================================================== */

import * as React from "react";
import Link from "next/link";
import { ShieldCheck, Ban, Gauge, FileLock2, ArrowRight } from "lucide-react";
import { Card, CardBody, Badge } from "@/components/ui";
import { useActivities, useCandidates, useOutreach, useSeats, useSuppression } from "@/lib/store";
import { formatNumber, formatTimeAgo } from "@/lib/utils";
import type { Tone } from "@/lib/utils";
import type { Candidate } from "@/lib/types";

const PENDING_SEND_STATUSES = new Set(["Needs Approval", "Approved", "Scheduled", "Pending Manual Send"]);

function Tile({
  icon,
  title,
  tone,
  stat,
  statLabel,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  tone: Tone;
  stat: string;
  statLabel: string;
  detail: string;
}) {
  return (
    <Card interactive className="h-full">
      <CardBody className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink/[0.04] text-ink-soft">
            {icon}
          </div>
          <Badge tone={tone} size="sm" dot>
            {tone === "success" ? "Adhered" : tone === "danger" ? "Needs review" : "Tracked"}
          </Badge>
        </div>
        <div>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{stat}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{statLabel}</p>
        </div>
        <p className="flex-1 text-sm text-muted">{detail}</p>
        <p className="text-sm font-bold text-ink">{title}</p>
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1 text-sm font-semibold text-electric hover:underline"
        >
          View in audit trail
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}

export function CompliancePosture() {
  const activities = useActivities();
  const candidates = useCandidates();
  const outreach = useOutreach();
  const seats = useSeats();
  const suppression = useSuppression();

  const now = Date.now();

  /* ---- PII reveal audit --------------------------------------------------
     recordPiiReveal (store.ts) writes an activity of type "compliance" every
     time a recruiter reveals a candidate's contact details. */
  const piiReveals = React.useMemo(
    () => activities.filter((a) => a.type === "compliance"),
    [activities],
  );
  const lastReveal = React.useMemo(
    () => piiReveals.reduce<string | null>((latest, a) => (!latest || a.createdAt > latest ? a.createdAt : latest), null),
    [piiReveals],
  );

  /* ---- Suppression adherence ---------------------------------------------
     A "breach" is either (a) a candidate already flagged suppressed/
     do-not-contact who still has an outreach message sitting in a status
     that could reach them, or (b) any candidate whose email — or its
     domain — matches an active Fleet suppression entry while a message to
     them is still pending/queued. (b) is what actually catches entries
     added straight to the Fleet suppression list (e.g. an excluded
     competitor domain) that never touched the candidate's complianceFlags. */
  const activeSuppression = React.useMemo(
    () => suppression.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now),
    [suppression, now],
  );
  const flaggedCandidates = React.useMemo(
    () => candidates.filter((c) => c.complianceFlags.suppressed || c.complianceFlags.doNotContact),
    [candidates],
  );
  const suppressionBreaches = React.useMemo(() => {
    const flaggedBreaches = flaggedCandidates.filter((c) =>
      outreach.some((m) => m.candidateId === c.id && PENDING_SEND_STATUSES.has(m.status)),
    );
    const candidateById = new Map(candidates.map((c) => [c.id, c] as const));
    const listBreaches: Candidate[] = [];
    for (const m of outreach) {
      if (!PENDING_SEND_STATUSES.has(m.status)) continue;
      const candidate = candidateById.get(m.candidateId);
      if (!candidate) continue;
      const email = candidate.email.toLowerCase();
      const domain = email.split("@")[1] ?? "";
      const matchesSuppression = activeSuppression.some(
        (s) =>
          (s.type === "email" && s.value.toLowerCase() === email) ||
          (s.type === "domain" && domain !== "" && s.value.toLowerCase() === domain),
      );
      if (matchesSuppression) listBreaches.push(candidate);
    }
    const byId = new Map<string, Candidate>();
    for (const c of [...flaggedBreaches, ...listBreaches]) byId.set(c.id, c);
    return Array.from(byId.values());
  }, [flaggedCandidates, outreach, candidates, activeSuppression]);

  /* ---- Rate-limit adherence ----------------------------------------------
     Each seat enforces its own dailyLimit; this reads the live counters. */
  const seatsOverCap = React.useMemo(() => seats.filter((s) => s.sentToday > s.dailyLimit), [seats]);
  const seatsWithinCap = seats.length - seatsOverCap.length;

  /* ---- GDPR / data-rights honoring ---------------------------------------- */
  const gdprExports = React.useMemo(() => candidates.filter((c) => c.complianceFlags.gdprExportRequested).length, [candidates]);
  const anonymized = React.useMemo(() => candidates.filter((c) => c.complianceFlags.anonymized).length, [candidates]);
  const doNotContact = React.useMemo(() => candidates.filter((c) => c.complianceFlags.doNotContact).length, [candidates]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        tone={piiReveals.length > 0 ? "success" : "neutral"}
        stat={formatNumber(piiReveals.length)}
        statLabel="PII reveals logged"
        title="Every contact-detail view is audited"
        detail={
          lastReveal
            ? `Last reveal logged ${formatTimeAgo(lastReveal)}. Each reveal writes a compliance activity with the candidate and purpose.`
            : "No candidate contact details have been revealed yet in this workspace."
        }
      />
      <Tile
        icon={<Ban className="h-5 w-5" aria-hidden />}
        tone={suppressionBreaches.length > 0 ? "danger" : "success"}
        stat={formatNumber(suppressionBreaches.length)}
        statLabel="Suppression breaches detected"
        title="Suppressed candidates stay suppressed"
        detail={`${formatNumber(activeSuppression.length)} active suppression entr${activeSuppression.length === 1 ? "y" : "ies"} and ${formatNumber(flaggedCandidates.length)} flagged candidate${flaggedCandidates.length === 1 ? "" : "s"} checked by email and domain against every outreach message still pending or scheduled to them.`}
      />
      <Tile
        icon={<Gauge className="h-5 w-5" aria-hidden />}
        tone={seatsOverCap.length > 0 ? "danger" : "success"}
        stat={`${formatNumber(seatsWithinCap)}/${formatNumber(seats.length)}`}
        statLabel="Agent seats within daily cap"
        title="Send-rate limits are enforced per seat"
        detail={
          seatsOverCap.length > 0
            ? `${seatsOverCap.length} seat${seatsOverCap.length === 1 ? "" : "s"} sent above its configured dailyLimit. Review before the next send.`
            : "Every agent seat's sends today are at or under its configured daily cap."
        }
      />
      <Tile
        icon={<FileLock2 className="h-5 w-5" aria-hidden />}
        tone={gdprExports + anonymized + doNotContact > 0 ? "success" : "neutral"}
        stat={formatNumber(gdprExports)}
        statLabel="GDPR export requests"
        title="Data-subject rights are tracked"
        detail={`${formatNumber(anonymized)} candidate${anonymized === 1 ? "" : "s"} anonymized · ${formatNumber(doNotContact)} do-not-contact flag${doNotContact === 1 ? "" : "s"} honored workspace-wide.`}
      />
    </div>
  );
}
