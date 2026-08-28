import {
  candidateConfirmationEmail,
  interviewerPrepEmail,
} from "@/lib/mock-ai";
import { mantuEmailHtmlWrapper } from "@/lib/mantu-brand";
import { parsePrepEmailTemplate } from "@/lib/interview-prep-trigger";
import type { Booking, Campaign, Candidate, OutreachMessage } from "@/lib/types";
import { genId } from "@/lib/utils";

export function buildInterviewPrepOutreach(input: {
  booking: Booking;
  candidate: Candidate;
  campaign: Campaign;
}): OutreachMessage[] {
  const prepParsed = parsePrepEmailTemplate(
    interviewerPrepEmail(input.booking, input.candidate),
  );
  const confirmParsed = parsePrepEmailTemplate(
    candidateConfirmationEmail(input.booking),
  );
  const now = new Date().toISOString();
  const interviewerEmail = input.booking.interviewerEmail?.trim() || undefined;

  const interviewerPrep: OutreachMessage = {
    id: genId("msg"),
    candidateId: input.candidate.id,
    campaignId: input.campaign.id,
    channel: "Email",
    subject: prepParsed.subject,
    body: prepParsed.body,
    tone: "Casual Professional",
    personalizationEvidence: ["interview_prep:interviewer"],
    status: "Needs Approval",
    sequenceStep: 0,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: now,
    htmlBody: mantuEmailHtmlWrapper(prepParsed.body),
    recipientOverride: interviewerEmail,
    prepPurpose: "interviewer",
    qualityStatus: "needs_review",
    qualityScore: 70,
    qualityCriticsUsed: false,
    qualityReasons: [
      "template-bound interview prep — awaiting human approval and live quality critics before send",
    ],
  };

  const candidateConfirm: OutreachMessage = {
    id: genId("msg"),
    candidateId: input.candidate.id,
    campaignId: input.campaign.id,
    channel: "Email",
    subject: confirmParsed.subject,
    body: confirmParsed.body,
    tone: "Casual Professional",
    personalizationEvidence: ["interview_prep:candidate_confirmation"],
    status: "Needs Approval",
    sequenceStep: 0,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: now,
    htmlBody: mantuEmailHtmlWrapper(confirmParsed.body),
    prepPurpose: "candidate_confirmation",
    qualityStatus: "needs_review",
    qualityScore: 70,
    qualityCriticsUsed: false,
    qualityReasons: [
      "template-bound interview confirmation — awaiting human approval and live quality critics before send",
    ],
  };

  return [interviewerPrep, candidateConfirm];
}
