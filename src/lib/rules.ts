import type {
  Campaign,
  Candidate,
  OutreachChannel,
  OutreachMessage,
  ReplyIntent,
  SystemSettings,
} from "./types";
import type { Tone } from "./utils";

/* ============================================================================
   Business rules — the guardrails Aria enforces before acting.
   ========================================================================== */

export const MIN_SCORE_FLOOR = 70;
export const DEDUPE_WINDOW_DAYS = 90;

/* ---- Rule 2 + 3 + 4: outreach approval gate ------------------------------ */

export interface ApprovalContext {
  candidate: Candidate;
  message: OutreachMessage;
  settings: SystemSettings;
  emailsSentToday: number;
  linkedinSentToday: number;
}

export interface ApprovalResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export function checkOutreachApproval(ctx: ApprovalContext): ApprovalResult {
  const { candidate, message, settings } = ctx;
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Rule 2 — score before contacting
  if (candidate.matchScore < settings.minScoreToContact) {
    blockers.push(
      `Match score ${candidate.matchScore} is below the ${settings.minScoreToContact} contact floor.`,
    );
  }

  // Rule 3 — personalize every message
  if (!message.personalizationEvidence || message.personalizationEvidence.length === 0) {
    blockers.push("No personalization evidence attached to this message.");
  }

  // Rule 10 + compliance — respect candidate wishes
  if (candidate.complianceFlags.doNotContact) blockers.push("Candidate is on the do-not-contact list.");
  if (candidate.complianceFlags.unsubscribed) blockers.push("Candidate has unsubscribed.");
  if (candidate.complianceFlags.suppressed) blockers.push("Candidate contact is currently suppressed.");

  // LinkedIn assisted-manual: we cannot send automatically, but we can draft
  // the message and ask the operator to paste it on the candidate's profile.
  if (message.channel === "LinkedIn" && !candidate.linkedinUrl.trim()) {
    blockers.push("LinkedIn profile URL is required to send a LinkedIn message.");
  }

  // Mirror of the LinkedIn check above: an Email message needs somewhere to go.
  if (message.channel === "Email" && !candidate.email.trim()) {
    blockers.push("Candidate has no email on file — required to send an Email message.");
  }

  // Rule 4 — respect rate limits
  const limit = limitFor(message.channel, settings);
  const used = message.channel === "Email" ? ctx.emailsSentToday : ctx.linkedinSentToday;
  if (used >= limit) {
    blockers.push(`Daily ${message.channel} limit reached (${used}/${limit}).`);
  } else if (used >= limit - 2) {
    warnings.push(`Approaching daily ${message.channel} limit (${used}/${limit}).`);
  }

  // Candidate replied since this draft was written — the copy may no longer
  // make sense (e.g. a follow-up nudging someone who already answered). Block
  // approval and force a regenerate/reject rather than shipping stale copy.
  if (candidate.lastRepliedAt && new Date(candidate.lastRepliedAt) > new Date(message.createdAt)) {
    blockers.push("Candidate has replied since this follow-up was drafted — regenerate or reject.");
  }

  // Rule 5 — dedupe: don't re-contact inside the window
  if (candidate.lastContactedAt && message.sequenceStep <= 1) {
    const days = daysSince(candidate.lastContactedAt);
    if (days < DEDUPE_WINDOW_DAYS) {
      warnings.push(`Contacted ${Math.round(days)}d ago, inside the ${DEDUPE_WINDOW_DAYS}d re-contact window.`);
    }
  }

  return { allowed: blockers.length === 0, blockers, warnings };
}

export function limitFor(channel: OutreachChannel, settings: SystemSettings): number {
  return channel === "Email" ? settings.rateLimits.emailsPerDay : settings.rateLimits.linkedinPerDay;
}

/* ---- Rule 5: dedupe sourcing -------------------------------------------- */

export interface DedupeResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
}

export function dedupeCandidates(
  incoming: Candidate[],
  existing: Candidate[],
  opts: { excludedCompanies: string[]; currentCompany?: string },
): DedupeResult {
  const accepted: Candidate[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const seenEmail = new Set(existing.map((c) => c.email.toLowerCase()));
  const seenLinkedin = new Set(existing.map((c) => c.linkedinUrl.toLowerCase()).filter(Boolean));
  const seenGithub = new Set(existing.map((c) => c.githubUrl.toLowerCase()).filter(Boolean));
  const seenSourceUrl = new Set(existing.map((c) => (c.sourceUrl ?? "").toLowerCase()).filter(Boolean));
  const excluded = new Set(opts.excludedCompanies.map((c) => c.toLowerCase()));

  for (const cand of incoming) {
    const email = cand.email.toLowerCase();
    const li = cand.linkedinUrl.toLowerCase();
    const gh = cand.githubUrl.toLowerCase();
    const su = (cand.sourceUrl ?? "").toLowerCase();
    const company = cand.currentCompany.toLowerCase();

    // Only treat a non-blank email as a dedupe key. Real sourced profiles (e.g.
    // GitHub) often have no public email; those are deduped by linkedin/github/
    // source URL below, not collapsed together as "same blank email".
    if (email && seenEmail.has(email)) {
      skipped.push({ name: cand.name, reason: "Duplicate email" });
      continue;
    }
    if (li && seenLinkedin.has(li)) {
      skipped.push({ name: cand.name, reason: "Duplicate LinkedIn" });
      continue;
    }
    if (gh && seenGithub.has(gh)) {
      skipped.push({ name: cand.name, reason: "Duplicate GitHub" });
      continue;
    }
    if (su && seenSourceUrl.has(su)) {
      skipped.push({ name: cand.name, reason: "Duplicate source profile" });
      continue;
    }
    if (excluded.has(company)) {
      skipped.push({ name: cand.name, reason: `Excluded company (${cand.currentCompany})` });
      continue;
    }
    if (opts.currentCompany && company === opts.currentCompany.toLowerCase()) {
      skipped.push({ name: cand.name, reason: "Current/hiring company" });
      continue;
    }
    if (cand.lastContactedAt && daysSince(cand.lastContactedAt) < DEDUPE_WINDOW_DAYS) {
      skipped.push({ name: cand.name, reason: `Contacted < ${DEDUPE_WINDOW_DAYS}d ago` });
      continue;
    }

    accepted.push(cand);
    if (email) seenEmail.add(email);
    if (li) seenLinkedin.add(li);
    if (gh) seenGithub.add(gh);
    if (su) seenSourceUrl.add(su);
  }

  return { accepted, skipped };
}

/* ---- Rule 8: SLA for interested replies --------------------------------- */

const HOT_INTENTS: ReplyIntent[] = ["INTERESTED", "QUALIFIED_INTEREST"];

export function slaDueFor(
  intent: ReplyIntent,
  receivedAtIso: string,
  slaMinutes: number,
): string | null {
  if (!HOT_INTENTS.includes(intent)) return null;
  return new Date(new Date(receivedAtIso).getTime() + slaMinutes * 60000).toISOString();
}

/* ---- Campaign health + next action -------------------------------------- */

export interface CampaignHealth {
  tone: Tone;
  label: string;
  detail: string;
}

export function campaignHealth(c: Campaign): CampaignHealth {
  const m = c.metrics;
  if (c.status === "Paused")
    return { tone: "warning", label: "Paused", detail: "Resume to continue sourcing and outreach." };
  if (c.status === "Filled") return { tone: "success", label: "Filled", detail: "Role closed." };
  if (m.sourced === 0)
    return { tone: "neutral", label: "Awaiting sourcing", detail: "No candidates sourced yet." };
  if (m.contacted > 0 && m.replied / Math.max(1, m.contacted) < 0.08)
    return { tone: "warning", label: "Low reply rate", detail: "Reply rate under 8%. Refresh the messaging." };
  if (m.interested > 0 && m.booked === 0)
    return { tone: "tangerine", label: "Bookings pending", detail: "Interested candidates awaiting booking." };
  if (m.booked > 0) return { tone: "success", label: "On track", detail: "Pipeline converting to interviews." };
  return { tone: "electric", label: "Active", detail: "Sourcing and outreach in motion." };
}

export function nextActionForCampaign(c: Campaign): string {
  const m = c.metrics;
  if (c.status === "Paused") return "Resume campaign to continue";
  if (m.sourced === 0) return "Source first batch";
  if (m.sourced > m.contacted) return `Review ${m.sourced - m.contacted} drafts`;
  if (m.replied > m.interested + m.notInterested) return "Classify new replies";
  if (m.interested > m.booked) return `Book ${m.interested - m.booked} interested`;
  if (m.booked > 0 && m.interviewed < m.booked) return "Collect interview feedback";
  return "Generate weekly report";
}

/* ---- Small date helper --------------------------------------------------- */

export function daysSince(iso: string, now: number = Date.now()): number {
  return (now - new Date(iso).getTime()) / 86_400_000;
}
