import { createHash } from "node:crypto";

import { buildSourcingStrategy, parseEmailAndJD } from "@/lib/mock-ai";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/scoring";
import type { Campaign, JobAnalysis } from "@/lib/types";

export function buildInboundEmailText(input: {
  from?: string;
  subject?: string;
  body: string;
}): string {
  const parts: string[] = [];
  if (input.from?.trim()) parts.push(`From: ${input.from.trim()}`);
  if (input.subject?.trim()) parts.push(`Subject: ${input.subject.trim()}`);
  parts.push(input.body ?? "");
  return parts.join("\n");
}

export function parseInboundNeed(emailText: string) {
  const parsed = parseEmailAndJD({ email: emailText });
  const readiness = evaluateNeedReadiness(parsed.jobAnalysis);
  return {
    parsed,
    ready: readiness.ready,
    warnings: readiness.issues,
    confidence: readiness.ready ? 0.85 : 0.55,
    jobAnalysis: parsed.jobAnalysis,
    sender: parsed.sender,
  };
}

export function deterministicCampaignId(requisitionId: string): string {
  const hash = createHash("sha256").update(requisitionId).digest("hex").slice(0, 8);
  return `camp-req-${hash}`;
}

function emptyMetrics(): Campaign["metrics"] {
  return {
    sourced: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    booked: 0,
    interviewed: 0,
    offer: 0,
    hired: 0,
    notInterested: 0,
    replyRate: 0,
    avgMatchScore: 0,
    timeToFirstInterviewHours: null,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  };
}

export function buildCampaignFromNeed(
  job: JobAnalysis,
  campaignId: string,
  hiringManager: string,
  hiringManagerEmail: string,
): Campaign {
  const now = new Date().toISOString();
  return {
    id: campaignId,
    title: job.title,
    department: job.department,
    urgency: job.urgency,
    status: "Sourcing",
    hiringManager,
    hiringManagerEmail,
    createdAt: now,
    targetStartDate: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    jobAnalysis: job,
    sourcingStrategy: buildSourcingStrategy(job),
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    metrics: emptyMetrics(),
    skillUpdates: [],
    activities: [
      {
        id: `act-${campaignId}`,
        type: "campaign",
        title: "Campaign created from inbound need",
        notes: `${job.title} — parsed from webhook, ready for sourcing.`,
        outcome: "Ready",
        campaignId,
        linkedEntityType: "campaign",
        linkedEntityId: campaignId,
        createdAt: now,
      },
    ],
  };
}
