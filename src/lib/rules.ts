import type {
  Campaign,
  Candidate,
  OutreachChannel,
  OutreachMessage,
  ReplyIntent,
  SystemSettings,
} from "./types";
import type { Tone } from "./utils";
import { recordedCandidateLawfulBasis } from "./candidate-lawful-basis";

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

/** One row of the "glass-box" guardrail checklist — a human-readable report
 *  of a single condition the approval gate evaluated. Purely a reporting
 *  layer: every row mirrors a condition that already feeds `blockers`/
 *  `warnings` below, in the same order, so the checklist can never show a
 *  state the real gate didn't compute. Adding a row never changes `allowed`. */
export interface ApprovalCheck {
  rule: string;
  status: "pass" | "warn" | "block";
  detail: string;
}

export interface ApprovalResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  /** True when the public showcase simulated the action without persistence. */
  dryRun?: boolean;
  /** Optional so any pre-existing hand-built `ApprovalResult` literal (e.g.
   *  the early-return "message not found" cases in store.ts) stays valid
   *  without modification — additive only, never required. */
  checks?: ApprovalCheck[];
}

export function checkOutreachApproval(ctx: ApprovalContext): ApprovalResult {
  const { candidate, message, settings } = ctx;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks: ApprovalCheck[] = [];

  // Rule 2 — score before contacting
  if (candidate.matchScore < settings.minScoreToContact) {
    const detail = `Match score ${candidate.matchScore} is below the ${settings.minScoreToContact} contact floor.`;
    blockers.push(detail);
    checks.push({ rule: "Match score", status: "block", detail });
  } else {
    checks.push({
      rule: "Match score",
      status: "pass",
      detail: `Match score ${candidate.matchScore} meets the ${settings.minScoreToContact} contact floor.`,
    });
  }

  // Rule 3 — personalize every message
  if (!message.personalizationEvidence || message.personalizationEvidence.length === 0) {
    const detail = "No personalization evidence attached to this message.";
    blockers.push(detail);
    checks.push({ rule: "Personalization", status: "block", detail });
  } else {
    checks.push({
      rule: "Personalization",
      status: "pass",
      detail: `${message.personalizationEvidence.length} personalization ${message.personalizationEvidence.length === 1 ? "point" : "points"} attached.`,
    });
  }

  if (!recordedCandidateLawfulBasis(candidate)) {
    const detail =
      candidate.provenance === "manual"
        ? "A manually entered candidate requires an operator-recorded lawful basis before outreach approval. Record consent or legitimate interest in the candidate consent passport."
        : "A provider-sourced candidate requires an operator-recorded lawful basis before outreach approval. Record consent or legitimate interest in the candidate consent passport.";
    blockers.push(detail);
    checks.push({ rule: "Lawful basis", status: "block", detail });
  } else {
    checks.push({
      rule: "Lawful basis",
      status: "pass",
      detail: "Operator-recorded lawful basis is present for this candidate.",
    });
  }

  // Rule 10 + compliance — respect candidate wishes
  if (candidate.complianceFlags.doNotContact) {
    const detail = "Candidate is on the do-not-contact list.";
    blockers.push(detail);
    checks.push({ rule: "Do-not-contact", status: "block", detail });
  } else {
    checks.push({ rule: "Do-not-contact", status: "pass", detail: "Not on the do-not-contact list." });
  }

  if (candidate.complianceFlags.unsubscribed) {
    const detail = "Candidate has unsubscribed.";
    blockers.push(detail);
    checks.push({ rule: "Unsubscribed", status: "block", detail });
  } else {
    checks.push({ rule: "Unsubscribed", status: "pass", detail: "Has not unsubscribed." });
  }

  if (candidate.complianceFlags.suppressed) {
    const detail = "Candidate contact is currently suppressed.";
    blockers.push(detail);
    checks.push({ rule: "Suppressed", status: "block", detail });
  } else {
    checks.push({ rule: "Suppressed", status: "pass", detail: "Contact is not suppressed." });
  }

  // LinkedIn assisted-manual: we cannot send automatically, but we can draft
  // the message and ask the operator to paste it on the candidate's profile.
  if (message.channel === "SMS") {
    const detail = "SMS delivery is disabled until recorded consent, opt-out, suppression, and durable dispatch controls are implemented.";
    blockers.push(detail);
    checks.push({ rule: "Channel policy", status: "block", detail });
  } else if (message.channel === "LinkedIn" && !candidate.linkedinUrl.trim()) {
    const detail = "LinkedIn profile URL is required to send a LinkedIn message.";
    blockers.push(detail);
    checks.push({ rule: "Contact info", status: "block", detail });
  } else if (message.channel === "Email" && !candidate.email.trim()) {
    // Mirror of the LinkedIn check above: an Email message needs somewhere to go.
    const detail = "Candidate has no email on file. An Email message requires one.";
    blockers.push(detail);
    checks.push({ rule: "Contact info", status: "block", detail });
  } else if (message.channel === "WhatsApp" && !(candidate.phone ?? "").trim()) {
    const detail = "Candidate has no phone number on file. A WhatsApp message requires one.";
    blockers.push(detail);
    checks.push({ rule: "Contact info", status: "block", detail });
  } else {
    checks.push({
      rule: "Contact info",
      status: "pass",
      detail:
        message.channel === "LinkedIn"
          ? "LinkedIn profile URL on file."
          : message.channel === "Email"
            ? "Email address on file."
            : message.channel === "WhatsApp"
              ? "WhatsApp phone number on file."
              : `${message.channel} channel: no contact-detail rule required.`,
    });
  }

  // Rule 4 — respect rate limits
  const limit = limitFor(message.channel, settings);
  const used = message.channel === "Email" ? ctx.emailsSentToday : ctx.linkedinSentToday;
  if (used >= limit) {
    const detail = `Daily ${message.channel} limit reached (${used}/${limit}).`;
    blockers.push(detail);
    checks.push({ rule: "Rate limit", status: "block", detail });
  } else if (used >= limit - 2) {
    const detail = `Approaching daily ${message.channel} limit (${used}/${limit}).`;
    warnings.push(detail);
    checks.push({ rule: "Rate limit", status: "warn", detail });
  } else {
    checks.push({
      rule: "Rate limit",
      status: "pass",
      detail: `${used}/${limit} ${message.channel} sends used today.`,
    });
  }

  // Candidate replied since this draft was written — the copy may no longer
  // make sense (e.g. a follow-up nudging someone who already answered). Block
  // approval and force a regenerate/reject rather than shipping stale copy.
  if (candidate.lastRepliedAt && new Date(candidate.lastRepliedAt) > new Date(message.createdAt)) {
    const detail = "Candidate has replied since this follow-up was drafted. Regenerate or reject.";
    blockers.push(detail);
    checks.push({ rule: "Draft freshness", status: "block", detail });
  } else {
    checks.push({
      rule: "Draft freshness",
      status: "pass",
      detail: candidate.lastRepliedAt ? "No reply since this draft was written." : "No prior reply on record.",
    });
  }

  // Rule 5 — dedupe: don't re-contact inside the window
  if (candidate.lastContactedAt && message.sequenceStep <= 1) {
    const days = daysSince(candidate.lastContactedAt);
    if (days < DEDUPE_WINDOW_DAYS) {
      const detail = `Contacted ${Math.round(days)}d ago, inside the ${DEDUPE_WINDOW_DAYS}d re-contact window.`;
      warnings.push(detail);
      checks.push({ rule: "Re-contact window", status: "warn", detail });
    } else {
      checks.push({
        rule: "Re-contact window",
        status: "pass",
        detail: `Contacted ${Math.round(days)}d ago, outside the ${DEDUPE_WINDOW_DAYS}d window.`,
      });
    }
  } else {
    checks.push({
      rule: "Re-contact window",
      status: "pass",
      detail: message.sequenceStep > 1 ? "Follow-up in an existing sequence." : "No prior contact on record.",
    });
  }

  return { allowed: blockers.length === 0, blockers, warnings, checks };
}

export function limitFor(channel: OutreachChannel, settings: SystemSettings): number {
  return channel === "Email" ? settings.rateLimits.emailsPerDay : settings.rateLimits.linkedinPerDay;
}

/* ---- Rule 5: dedupe sourcing -------------------------------------------- */

export interface DedupeResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
}

export type CandidateDedupeIdentity = Pick<
  Candidate,
  "email" | "linkedinUrl" | "githubUrl" | "sourceUrl" | "lastContactedAt"
> &
  Partial<
    Pick<
      Candidate,
      "complianceFlags" | "stage" | "recontactAt" | "name" | "currentCompany" | "externalIds" | "sourceExternalId"
    >
  >;

/** Normalize LinkedIn profile URLs so www / trailing slash / query don't fork identity. */
export function normalizeLinkedInIdentity(url: string): string {
  const raw = (url ?? "").trim().toLowerCase();
  if (!raw) return "";
  const m = raw.match(/linkedin\.com\/in\/([a-z0-9_-]+)/i);
  if (m?.[1]) return `li:${m[1]}`;
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split("?")[0]!;
}

/** Normalize GitHub profile URLs / handles. */
export function normalizeGithubIdentity(url: string): string {
  const raw = (url ?? "").trim().toLowerCase();
  if (!raw) return "";
  const m = raw.match(/github\.com\/([a-z0-9_-]+)/i);
  if (m?.[1]) return `gh:${m[1]}`;
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split("?")[0]!;
}

/** Cross-provider name+company fingerprint when URL/email are absent. */
export function identityNameCompanyKey(name: string, company: string): string {
  const n = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const c = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length < 3 || !c || c.length < 2) return "";
  return `nc:${n}|${c}`;
}

/** Collect opaque external ids (Apify / Sillage / Apollo / …) for cross-provider dedupe. */
function externalIdKeys(
  c: Pick<Candidate, "externalIds" | "sourceExternalId" | "sourcePlatform"> | CandidateDedupeIdentity,
): string[] {
  const keys: string[] = [];
  const ids = "externalIds" in c ? c.externalIds : undefined;
  if (ids) {
    for (const [platform, id] of Object.entries(ids)) {
      if (id && String(id).trim()) keys.push(`ext:${platform}:${String(id).trim().toLowerCase()}`);
    }
  }
  const legacy = "sourceExternalId" in c ? c.sourceExternalId : undefined;
  if (legacy && String(legacy).trim()) keys.push(`ext:legacy:${String(legacy).trim().toLowerCase()}`);
  return keys;
}

/** Pool identity blocked from re-source / first-touch re-contact. */
function identityBlocksResourcing(c: CandidateDedupeIdentity): boolean {
  if (c.complianceFlags?.doNotContact || c.complianceFlags?.suppressed || c.complianceFlags?.unsubscribed) {
    return true;
  }
  if (c.stage === "Not Interested") return true;
  if (c.recontactAt) {
    const until = new Date(c.recontactAt).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  if (c.lastContactedAt && daysSince(c.lastContactedAt) < DEDUPE_WINDOW_DAYS) return true;
  return false;
}

export function dedupeCandidates(
  incoming: Candidate[],
  existing: CandidateDedupeIdentity[],
  opts: { excludedCompanies: string[]; currentCompany?: string },
): DedupeResult {
  const accepted: Candidate[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const seenEmail = new Set(existing.map((c) => c.email.toLowerCase()).filter(Boolean));
  const seenLinkedin = new Set(
    existing.map((c) => normalizeLinkedInIdentity(c.linkedinUrl)).filter(Boolean),
  );
  const seenGithub = new Set(
    existing.map((c) => normalizeGithubIdentity(c.githubUrl)).filter(Boolean),
  );
  const seenSourceUrl = new Set(existing.map((c) => (c.sourceUrl ?? "").toLowerCase()).filter(Boolean));
  const seenExternal = new Set(existing.flatMap((c) => externalIdKeys(c)));
  const seenNameCompany = new Set(
    existing
      .map((c) => identityNameCompanyKey(c.name ?? "", c.currentCompany ?? ""))
      .filter(Boolean),
  );
  const excluded = new Set(opts.excludedCompanies.map((c) => c.toLowerCase()));

  const contactedByEmail = new Map(
    existing
      .filter((c) => c.email && identityBlocksResourcing(c))
      .map((c) => [c.email.toLowerCase(), c] as const),
  );
  const contactedByLinkedin = new Map(
    existing
      .filter((c) => normalizeLinkedInIdentity(c.linkedinUrl) && identityBlocksResourcing(c))
      .map((c) => [normalizeLinkedInIdentity(c.linkedinUrl), c] as const),
  );
  const contactedByGithub = new Map(
    existing
      .filter((c) => normalizeGithubIdentity(c.githubUrl) && identityBlocksResourcing(c))
      .map((c) => [normalizeGithubIdentity(c.githubUrl), c] as const),
  );
  const contactedByExternal = new Map<string, CandidateDedupeIdentity>();
  for (const c of existing) {
    if (!identityBlocksResourcing(c)) continue;
    for (const key of externalIdKeys(c)) contactedByExternal.set(key, c);
  }
  const contactedByNameCompany = new Map(
    existing
      .filter((c) => identityNameCompanyKey(c.name ?? "", c.currentCompany ?? "") && identityBlocksResourcing(c))
      .map((c) => [identityNameCompanyKey(c.name ?? "", c.currentCompany ?? ""), c] as const),
  );

  for (const cand of incoming) {
    const email = cand.email.toLowerCase();
    const li = normalizeLinkedInIdentity(cand.linkedinUrl);
    const gh = normalizeGithubIdentity(cand.githubUrl);
    const su = (cand.sourceUrl ?? "").toLowerCase();
    const company = cand.currentCompany.toLowerCase();
    const nc = identityNameCompanyKey(cand.name, cand.currentCompany);
    const extKeys = externalIdKeys(cand);

    // Only treat a non-blank email as a dedupe key. Real sourced profiles (e.g.
    // GitHub) often have no public email; those are deduped by linkedin/github/
    // source URL / external id / name+company below.
    if (email && contactedByEmail.has(email)) {
      skipped.push({ name: cand.name, reason: "Already contacted (do not re-source)" });
      continue;
    }
    if (li && contactedByLinkedin.has(li)) {
      skipped.push({ name: cand.name, reason: "Already contacted (do not re-source)" });
      continue;
    }
    if (gh && contactedByGithub.has(gh)) {
      skipped.push({ name: cand.name, reason: "Already contacted (do not re-source)" });
      continue;
    }
    if (extKeys.some((k) => contactedByExternal.has(k))) {
      skipped.push({ name: cand.name, reason: "Already contacted (do not re-source)" });
      continue;
    }
    if (nc && contactedByNameCompany.has(nc)) {
      skipped.push({ name: cand.name, reason: "Already contacted (do not re-source)" });
      continue;
    }
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
    if (extKeys.some((k) => seenExternal.has(k))) {
      skipped.push({ name: cand.name, reason: "Duplicate cross-provider identity" });
      continue;
    }
    if (nc && seenNameCompany.has(nc)) {
      skipped.push({ name: cand.name, reason: "Duplicate name+company identity" });
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
    if (identityBlocksResourcing(cand)) {
      skipped.push({ name: cand.name, reason: "Do not re-contact" });
      continue;
    }

    accepted.push(cand);
    if (email) seenEmail.add(email);
    if (li) seenLinkedin.add(li);
    if (gh) seenGithub.add(gh);
    if (su) seenSourceUrl.add(su);
    if (nc) seenNameCompany.add(nc);
    for (const k of extKeys) seenExternal.add(k);
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
