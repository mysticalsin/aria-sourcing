/* ============================================================================
   Campaign autopilot (ADR 0002): the deterministic parts. No I/O, no React.

   - which candidates the agent may contact, and the best N of them;
   - the sourcing plan a nightly run uses (the reviewed strategy's queries);
   - the LinkedIn copy limits (an invitation note is 300 characters at most);
   - the outreach message the agent records in the workspace.

   Claude only writes the copy (src/lib/agents/server/draft.ts); who gets
   contacted is decided here, by the existing match score.
   ========================================================================== */

import type { Campaign, Candidate, OutreachMessage, SystemSettings, WorkspaceState } from "@/lib/types";
import type { GeneratedOutreach } from "@/lib/mock-ai";
import { newOutreachMessage } from "@/lib/mock-ai";
import { candidateDraftBlocker } from "@/lib/candidate-review";
import { isCandidateErasureTombstone } from "@/lib/candidate-privacy";
import { publicIdFromProfileUrl } from "@/lib/linkedin-profile-url";
import type { SourceChoice } from "@/lib/sourcing/unified-contract";

/** LinkedIn's limit for a connection-invitation note. */
export const INVITATION_NOTE_MAX = 300;

export interface AutopilotSettings {
  contactsPerRun: number;
  minScore: number;
  sourceLimit: number;
}

/** LinkedIn public ids the agent may contact, lower-cased. */
export type AgentAllowlist = ReadonlySet<string>;

/**
 * Parse AGENTS_LINKEDIN_ALLOWLIST: profile URLs or public ids, separated by
 * commas, spaces or new lines. Unset or blank means no restriction (null).
 * Set but with nothing valid in it means "nobody" (an empty set), so a typo
 * never opens the agent to every candidate.
 */
export function parseAgentAllowlist(raw: string | undefined): AgentAllowlist | null {
  if (raw === undefined || !raw.trim()) return null;
  const ids = raw
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((item) => publicIdFromProfileUrl(item.includes("linkedin.com") ? item : `https://www.linkedin.com/in/${item}`))
    .filter((id): id is string => Boolean(id))
    .map((id) => id.toLowerCase());
  return new Set(ids);
}

/** Why the agent must not contact this candidate, or null when it may.
 *  `allow`, when set, is the only profiles the agent may contact (a safety
 *  net for demos and tests: AGENTS_LINKEDIN_ALLOWLIST). */
export function agentContactBlocker(candidate: Candidate, campaign: Campaign | undefined, state: WorkspaceState, allow: AgentAllowlist | null = null): string | null {
  if (!campaign || candidate.campaignId !== campaign.id) return "Not in this campaign.";
  if (isCandidateErasureTombstone(candidate)) return "Erased.";
  const flags = candidate.complianceFlags;
  if (flags.anonymized || flags.doNotContact || flags.unsubscribed || flags.suppressed) return "Do not contact.";
  if (candidate.stage !== "Sourced") return "Already past Sourced.";
  if (candidate.outreachHistory.length > 0 || candidate.lastContactedAt) return "Already contacted.";
  if (state.outreach.some((m) => m.candidateId === candidate.id && m.status !== "Rejected")) return "Already has an outreach message.";
  const publicId = publicIdFromProfileUrl(candidate.linkedinUrl ?? "");
  if (!publicId) return "No LinkedIn profile URL.";
  if (allow && !allow.has(publicId.toLowerCase())) return "Outside the agent allowlist (AGENTS_LINKEDIN_ALLOWLIST).";
  return candidateDraftBlocker(candidate, campaign, "LinkedIn");
}

/**
 * The best eligible candidates of a campaign, highest match score first,
 * at or above the threshold, skipping the ones the agent already picked.
 */
export function pickTopCandidates(
  state: WorkspaceState,
  campaignId: string,
  options: { count: number; minScore: number; exclude?: ReadonlySet<string>; allow?: AgentAllowlist | null },
): Candidate[] {
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return [];
  return state.candidates
    .filter((c) => c.campaignId === campaignId && !options.exclude?.has(c.id))
    .filter((c) => c.matchScore >= options.minScore)
    .filter((c) => agentContactBlocker(c, campaign, state, options.allow ?? null) === null)
    .sort((a, b) => b.matchScore - a.matchScore || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, options.count));
}

/**
 * The sources of a nightly run, from the campaign's reviewed strategy (the
 * same defaults the campaign page offers). LinkedIn via web search needs the
 * workspace's Anthropic key; GitHub needs a strategy query.
 */
export function autopilotSourcePlan(campaign: Campaign, options: { webSearch: boolean; limit: number }): SourceChoice[] {
  const plan: SourceChoice[] = [];
  const limit = Math.min(20, Math.max(1, Math.round(options.limit)));
  const linkedin = (campaign.sourcingStrategy.linkedinBoolean ?? "").trim();
  const web = linkedin && linkedin.length <= 256 ? linkedin : campaign.jobAnalysis.title.trim().slice(0, 256);
  if (options.webSearch && web) plan.push({ source: "WebSearch", query: web, limit });
  const github = (campaign.sourcingStrategy.githubQueries[0]?.query ?? "").trim().slice(0, 256);
  if (github) plan.push({ source: "GitHub", query: github, limit });
  return plan;
}

/** The exact text a QC evaluation reads. */
export interface OutreachQcDraft {
  channel: string;
  subject: string;
  body: string;
  language?: string;
}

/** A verdict the send boundary can accept. capsOk is the channel-cap re-check. */
export interface OutreachQcVerdict {
  status: "PASS" | "FAIL";
  score: number;
  qcVersion: string;
  draftHash: string;
  capsOk: boolean;
}

export interface AutomaticSendGate {
  killed: boolean | null;
  sentToday: number | null;
  dailyCap: number;
  verdict: OutreachQcVerdict | null;
}

/**
 * Whether an automatic send may be queued. Unknown kill-switch state, an
 * unreadable send count, a missing cap, a missing verdict, or a verdict that
 * is not a PASS bound to a draft all refuse the send.
 */
export function admitAutomaticSend(gate: AutomaticSendGate): { ok: true } | { ok: false; reason: string } {
  if (gate.killed === null) return { ok: false, reason: "Outreach kill switch is unavailable." };
  if (gate.killed) return { ok: false, reason: "Outreach kill switch is on." };
  if (gate.sentToday === null || !Number.isInteger(gate.sentToday) || gate.sentToday < 0) {
    return { ok: false, reason: "Workspace send count is unavailable." };
  }
  if (!Number.isInteger(gate.dailyCap) || gate.dailyCap < 1) {
    return { ok: false, reason: "Workspace daily cap is unavailable." };
  }
  if (gate.sentToday >= gate.dailyCap) return { ok: false, reason: "Workspace daily cap is reached." };
  const verdict = gate.verdict;
  if (!verdict || verdict.status !== "PASS" || verdict.draftHash.trim() === "" || verdict.capsOk !== true) {
    return { ok: false, reason: "QC did not pass." };
  }
  return { ok: true };
}

/** Instruction added to the outreach prompt for each LinkedIn kind. */
export function linkedInCopyRule(kind: "message" | "invitation"): string {
  return kind === "invitation"
    ? `This is a LinkedIn connection-invitation note: at most 280 characters in total, no subject needed (write 'Subject: LinkedIn' anyway), no links, one short sentence on why you reach out and a soft ask to connect.`
    : "This is a LinkedIn direct message to a 1st-degree connection: no links, under 90 words.";
}

/**
 * Fit text into an invitation note: whole sentences first, then whole words,
 * never more than INVITATION_NOTE_MAX characters.
 */
export function fitInvitationNote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= INVITATION_NOTE_MAX) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    const next = `${out} ${sentence.trim()}`.trim();
    if (next.length > INVITATION_NOTE_MAX) break;
    out = next;
  }
  if (out.length >= 80) return out;
  const words = clean.split(" ");
  out = "";
  for (const word of words) {
    if (`${out} ${word}`.trim().length > INVITATION_NOTE_MAX - 1) break;
    out = `${out} ${word}`.trim();
  }
  return `${out}…`;
}

/**
 * The outreach message the agent records: LinkedIn, already approved by the
 * campaign owner's standing approval, waiting for the bridge to send it
 * ("Pending Manual Send" until the extension reports it sent).
 */
export function agentOutreachMessage(input: {
  candidate: Candidate;
  campaign: Campaign;
  settings: SystemSettings;
  gen: GeneratedOutreach;
  draftedBy: "ai" | "template";
  ownerName: string;
  id?: string;
}): OutreachMessage {
  const base = newOutreachMessage(input.candidate, input.campaign, { ...input.gen, channel: "LinkedIn" }, "Casual Professional", input.settings, 1);
  return {
    ...base,
    ...(input.id ? { id: input.id } : {}),
    status: "Pending Manual Send",
    approvedBy: `ARIA agent for ${input.ownerName}`.slice(0, 120),
    draftedBy: input.draftedBy,
  };
}
