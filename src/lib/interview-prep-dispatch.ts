import {
  candidateConfirmationEmail,
  interviewerPrepEmail,
} from "@/lib/mock-ai";
import { mantuEmailHtmlWrapper } from "@/lib/mantu-brand";
import { parsePrepEmailTemplate } from "@/lib/interview-prep-trigger";
import { validateOutreachQuality } from "@/lib/outreach-quality-pipeline";
import type { Booking, Campaign, Candidate, OutreachMessage } from "@/lib/types";
import { stableOutreachMessageId } from "@/lib/utils";

function applyDeterministicQuality(
  subject: string,
  body: string,
): {
  subject: string;
  body: string;
  qualityStatus: OutreachMessage["qualityStatus"];
  qualityScore: number;
  qualityCriticsUsed: boolean;
  qualityReasons: string[];
} {
  const verdict = validateOutreachQuality({ subject, body, channel: "Email" });
  return {
    subject: verdict.text.subject,
    body: verdict.text.body,
    qualityStatus: verdict.status,
    qualityScore: verdict.aggregateScore,
    qualityCriticsUsed: false,
    qualityReasons: verdict.stages.flatMap((s) => s.reasons).filter(Boolean).slice(0, 12),
  };
}

/**
 * Build interviewer prep + candidate confirmation drafts for the approval queue.
 * Deterministic quality is applied immediately; the cron route upgrades with
 * live LLM critics when available. Autopilot send requires live critics green.
 */
export function buildInterviewPrepOutreach(input: {
  booking: Booking;
  candidate: Candidate;
  campaign: Campaign;
  /** When set, message ids are retry-stable across interview_prep_send jobs. */
  workspaceId?: string;
}): OutreachMessage[] {
  const prepParsed = parsePrepEmailTemplate(
    interviewerPrepEmail(input.booking, input.candidate),
  );
  const confirmParsed = parsePrepEmailTemplate(
    candidateConfirmationEmail(input.booking),
  );
  const now = new Date().toISOString();
  const interviewerEmail = input.booking.interviewerEmail?.trim() || undefined;
  const workspaceId = input.workspaceId?.trim() || "local";

  const prepQuality = applyDeterministicQuality(prepParsed.subject, prepParsed.body);
  const confirmQuality = applyDeterministicQuality(confirmParsed.subject, confirmParsed.body);

  const interviewerPrep: OutreachMessage = {
    id: stableOutreachMessageId({
      workspaceId,
      campaignId: input.campaign.id,
      candidateId: input.candidate.id,
      channel: "Email",
      sequenceStep: 1,
      trigger: `interview_prep:interviewer:${input.booking.id}`,
    }),
    candidateId: input.candidate.id,
    campaignId: input.campaign.id,
    channel: "Email",
    subject: prepQuality.subject,
    body: prepQuality.body,
    tone: "Casual Professional",
    personalizationEvidence: ["interview_prep:interviewer"],
    status: "Needs Approval",
    sequenceStep: 0,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: now,
    htmlBody: mantuEmailHtmlWrapper(prepQuality.body),
    recipientOverride: interviewerEmail,
    prepPurpose: "interviewer",
    qualityStatus: prepQuality.qualityStatus,
    qualityScore: prepQuality.qualityScore,
    qualityCriticsUsed: prepQuality.qualityCriticsUsed,
    qualityReasons:
      prepQuality.qualityReasons.length > 0
        ? prepQuality.qualityReasons
        : ["template-bound interview prep — live quality critics required before autopilot send"],
  };

  const candidateConfirm: OutreachMessage = {
    id: stableOutreachMessageId({
      workspaceId,
      campaignId: input.campaign.id,
      candidateId: input.candidate.id,
      channel: "Email",
      sequenceStep: 1,
      trigger: `interview_prep:candidate_confirmation:${input.booking.id}`,
    }),
    candidateId: input.candidate.id,
    campaignId: input.campaign.id,
    channel: "Email",
    subject: confirmQuality.subject,
    body: confirmQuality.body,
    tone: "Casual Professional",
    personalizationEvidence: ["interview_prep:candidate_confirmation"],
    status: "Needs Approval",
    sequenceStep: 0,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: now,
    htmlBody: mantuEmailHtmlWrapper(confirmQuality.body),
    prepPurpose: "candidate_confirmation",
    qualityStatus: confirmQuality.qualityStatus,
    qualityScore: confirmQuality.qualityScore,
    qualityCriticsUsed: confirmQuality.qualityCriticsUsed,
    qualityReasons:
      confirmQuality.qualityReasons.length > 0
        ? confirmQuality.qualityReasons
        : [
            "template-bound interview confirmation — live quality critics required before autopilot send",
          ],
  };

  return [interviewerPrep, candidateConfirm];
}
