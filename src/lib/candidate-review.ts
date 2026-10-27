import type { Campaign, Candidate, OutreachChannel, SystemSettings } from "./types";
import { isCandidateErasureTombstone } from "./candidate-privacy";
import { recordedCandidateLawfulBasis } from "./candidate-lawful-basis";
import { evaluateNeedReadiness } from "./needs/readiness";
import { campaignAllowsLiveSourcing } from "./sourcing/campaign-lifecycle";

export type CandidateReviewStep = "blocked" | "brief" | "fit" | "contact" | "permission" | "draft";

/** A next action for review, never an authorization to send a message. */
export function candidateReview(candidate: Candidate, campaign: Campaign | undefined, settings: Pick<SystemSettings, "minScoreToContact">) {
  const observed = new Set(candidate.techStack.map((s) => s.trim().toLowerCase()));
  // Match the scoring engine's exact, case-insensitive skill comparison.
  const required = campaign?.jobAnalysis.requiredSkills ?? [];
  const missingSkills = required.filter((s) => !observed.has(s.trim().toLowerCase()));
  const observedSkills = required.filter((s) => observed.has(s.trim().toLowerCase()));
  const step = (key: CandidateReviewStep, label: string, detail: string) => ({ key, label, detail, observedSkills, missingSkills });
  if (isCandidateErasureTombstone(candidate) || candidate.complianceFlags.doNotContact || candidate.complianceFlags.suppressed || candidate.complianceFlags.unsubscribed || candidate.stage === "Suppressed") {
    return step("blocked", "Contact blocked", "This profile is excluded. Do not enrich or prepare new outreach.");
  }
  if (candidate.stage === "Rejected" || candidate.stage === "Hired" || candidate.vivier) {
    return step("blocked", "Outside active shortlist", "Review the candidate's existing disposition before preparing new outreach.");
  }
  if (!campaign || !campaignAllowsLiveSourcing(campaign.status) || !evaluateNeedReadiness(campaign.jobAnalysis).ready) {
    return step("brief", "Review campaign", "Complete an active campaign brief before qualifying this profile.");
  }
  if (!Number.isFinite(candidate.matchScore) || candidate.matchScore < settings.minScoreToContact || missingSkills.length > 0 || (candidate.yearsExperience == null && (campaign.jobAnalysis.minYearsExperience != null || campaign.jobAnalysis.maxYearsExperience != null))) {
    return step("fit", "Verify fit", "Review the source evidence and missing requirements. Enrichment may add evidence; a score alone is not a hiring decision.");
  }
  if (!candidate.email.trim()) {
    return step("contact", "Find email contact", candidate.linkedinUrl.trim()
      ? "No email on file. Review contact discovery, or prepare an assisted LinkedIn draft for human review."
      : "No email on file. Verify public contact details; the current enrichment provider needs a LinkedIn profile URL.");
  }
  if (!recordedCandidateLawfulBasis(candidate)) {
    return step("permission", "Record contact basis", "Record the applicable consent or legitimate-interest decision in the consent passport before approval.");
  }
  return step("draft", "Review outreach draft", "Review fit and prepare a draft. Approval of the exact message and delivery checks are still required.");
}

export function candidateEnrichmentBlocker(candidate: Candidate, campaign: Campaign | undefined): string | null {
  if (isCandidateErasureTombstone(candidate) || candidate.complianceFlags.doNotContact || candidate.complianceFlags.suppressed || candidate.complianceFlags.unsubscribed || ["Rejected", "Suppressed", "Hired"].includes(candidate.stage)) {
    return "This candidate is excluded from enrichment.";
  }
  if (candidate.provenance === "synthetic") return "Synthetic profiles cannot use paid enrichment.";
  if (!campaign || !campaignAllowsLiveSourcing(campaign.status) || !evaluateNeedReadiness(campaign.jobAnalysis).ready) {
    return "Review an active campaign brief before enrichment.";
  }
  return null;
}

export function candidateDraftBlocker(candidate: Candidate, campaign: Campaign | undefined, channel: OutreachChannel): string | null {
  const review = candidateReview(candidate, campaign, { minScoreToContact: 0 });
  if (review.key === "blocked" || review.key === "brief") return review.detail;
  if (channel === "Email" && !candidate.email.trim()) return "Find a verified email before drafting email outreach.";
  if (channel === "LinkedIn" && !candidate.linkedinUrl.trim()) return "A LinkedIn profile is required for assisted LinkedIn drafting.";
  return null;
}
