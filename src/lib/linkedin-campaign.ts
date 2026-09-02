/* ============================================================================
   LINKEDIN CAMPAIGN LAUNCH — pure decisions behind "Launch outreach"
   (docs/outreach/ARIA-LINKEDIN-CONNECT.md, sections 2.3, 3.2 and S3).

   The launch tap is the human gate for a list of people. What the operator
   saw in the sheet is exactly what gets approved: one approval row per shown
   draft, hashed the same way the 0054 trigger and claim re-check at dispatch.
   Nothing here talks to a database; the route and the sheet call these.
   ========================================================================== */

import { approvalHash, approvalScopeHash } from "@/lib/outreach-content";
import { normalizeLinkedInProfileUrl } from "@/lib/linkedin-loop";

export type LinkedInGrantScope = "replies" | "campaign";

/**
 * Mirror of SHORTLIST_FLOOR and SHORTLIST_CAP in src/lib/sourcing/engine.ts
 * (that module pulls the PDF pipeline, which the sheet must not bundle). The
 * launch test asserts the two pairs stay equal.
 */
export const LAUNCH_SCORE_FLOOR = 60;
export const LAUNCH_PEOPLE_CAP = 20;

/**
 * One tap approves up to two drafts per person (S6): the connection note and
 * the first message. The 0060 launch RPC refuses more.
 */
export const LAUNCH_DRAFTS_CAP = LAUNCH_PEOPLE_CAP * 2;

/** A first-touch draft exactly as the sheet shows it. */
export interface LaunchDraft {
  messageId: string;
  candidateId: string;
  /** Canonical LinkedIn profile URL of the person. */
  profileUrl: string;
  subject: string;
  body: string;
}

/** A connection note exactly as the sheet shows it (S6). No subject: the 0059 claim hashes the note alone. */
export interface LaunchConnectDraft {
  messageId: string;
  candidateId: string;
  profileUrl: string;
  note: string;
}

/** A connection note is approved like a first touch, with an empty subject. */
export function connectDraftAsLaunchDraft(draft: LaunchConnectDraft): LaunchDraft {
  return { messageId: draft.messageId, candidateId: draft.candidateId, profileUrl: draft.profileUrl, subject: "", body: draft.note };
}

/** What the launch RPC receives per draft: the two hashes 0054 re-checks. */
export interface LaunchDraftApproval {
  message_id: string;
  body_hash: string;
  scope_hash: string;
}

/** A person eligible for the launch sheet. */
export interface LaunchPerson {
  candidateId: string;
  name: string;
  headline: string;
  matchScore: number;
  profileUrl: string;
}

export interface LaunchCandidateLike {
  id: string;
  name: string;
  currentTitle?: string;
  currentCompany?: string;
  matchScore: number;
  linkedinUrl?: string;
}

/**
 * The people a launch may cover: score at the shortlist floor or above, a real
 * LinkedIn profile, highest score first, capped at the shortlist size. The
 * server re-checks suppression and the 90-day contact window at claim time.
 */
export function shortlistForLaunch(candidates: LaunchCandidateLike[]): LaunchPerson[] {
  return candidates
    .filter((c) => Number.isFinite(c.matchScore) && c.matchScore >= LAUNCH_SCORE_FLOOR)
    .map((c) => ({
      candidateId: c.id,
      name: c.name,
      headline: [c.currentTitle, c.currentCompany].filter((s) => typeof s === "string" && s.trim()).join(" at "),
      matchScore: c.matchScore,
      profileUrl: normalizeLinkedInProfileUrl(c.linkedinUrl ?? ""),
    }))
    .filter((p) => p.profileUrl !== "")
    .sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name))
    .slice(0, LAUNCH_PEOPLE_CAP);
}

/**
 * Hash a shown draft into the approval the launch writes. Returns null when
 * the draft cannot be bound to a person and a profile, so it is never sent.
 */
export function launchDraftApproval(draft: LaunchDraft): LaunchDraftApproval | null {
  const messageId = draft.messageId.trim();
  if (!messageId || messageId.length > 120) return null;
  const profileUrl = normalizeLinkedInProfileUrl(draft.profileUrl);
  if (!profileUrl) return null;
  const scopeHash = approvalScopeHash({ candidateId: draft.candidateId, channel: "LinkedIn", recipient: profileUrl });
  if (!scopeHash) return null;
  return { message_id: messageId, body_hash: approvalHash(draft.subject, draft.body), scope_hash: scopeHash };
}

/** Every shown draft, hashed. A draft that cannot be bound drops the whole launch (fail closed). */
export function launchDraftApprovals(drafts: LaunchDraft[]): LaunchDraftApproval[] | null {
  const out: LaunchDraftApproval[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const approval = launchDraftApproval(draft);
    if (!approval || seen.has(approval.message_id)) return null;
    seen.add(approval.message_id);
    out.push(approval);
  }
  return out;
}

/** An approval row as the launch route reads it back. */
export interface LaunchApprovalRow {
  messageId: string;
  bodyHash: string;
  scopeHash: string;
  revokedAt: string | null;
}

export type DraftLaunchState = "launched" | "changed" | "not-launched";

/**
 * Whether a draft on screen is covered by a live launch approval. "changed"
 * means the operator edited the draft after the tap: the old approval no
 * longer matches, the row is not dispatchable, and the next "Add to launch"
 * tap re-approves the new copy.
 */
export function draftLaunchState(draft: LaunchDraft, approvals: LaunchApprovalRow[]): DraftLaunchState {
  const row = approvals.find((a) => a.messageId === draft.messageId && a.revokedAt === null);
  if (!row) return "not-launched";
  const current = launchDraftApproval(draft);
  if (!current) return "changed";
  return current.body_hash === row.bodyHash && current.scope_hash === row.scopeHash ? "launched" : "changed";
}

/** Original Aria copy for the sheet. No em dashes, no vendor, never AI. */
export const LAUNCH_COPY = {
  title: "Launch outreach",
  description:
    "One tap sends the connection requests and messages below from your LinkedIn account, two to ten minutes apart, inside the daily limits and outside quiet hours. People you are not connected to get the connection note first and the message once they accept. Replies are answered until a meeting is booked.",
  launch: "Launch outreach",
  addToLaunch: "Add to launch",
  launched: "Launched",
  changed: "Changed since launch",
  notLaunched: "Not launched yet",
  noDraft: "No message drafted yet",
  nobody: "No one on the shortlist has a LinkedIn profile and a score of 60 or more yet.",
  noSeat: "Connect LinkedIn in Fleet before launching. Nothing sends without a connected account.",
  waitingForLimit: "Waiting for tomorrow's limit",
} as const;
