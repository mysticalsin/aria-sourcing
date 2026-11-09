/* ============================================================================
   The agents runner's only way into the LinkedIn bridge (ADR 0002, POC).

   A campaign owner signed a standing approval for one campaign (an enabled
   `agent_campaign_autopilots` row with contact on) and a delegation with the
   `queue_linkedin` scope. Under both, and only then, the agent may queue an
   invitation or a message into that owner's own outbox. Their extension sends
   it from their browser, with the same pacing and caps as a click
   (policy.ts); nothing here raises them.

   Every function re-reads the authority it needs: the approval, the
   delegation, the candidate's compliance flags as the workspace state holds
   them. Nothing is trusted from the caller but ids.
   ========================================================================== */

import "server-only";
import {
  ACCOUNT_COLUMNS,
  OUTBOX_COLUMNS,
  candidateRecord,
  contactBlock,
  contactForCandidate,
  ensureContact,
  updateContact,
  type BridgeAccount,
  type ContactRow,
  type OutboxRow,
  type Svc,
} from "./server";
import { linkedInBridgeEnabled } from "./policy";
import { publicIdFromProfileUrl } from "../linkedin-profile-url";

const MAX_WAITING = 100;
const INVITATION_NOTE_MAX = 300;

export interface AgentApproval {
  workspaceId: string;
  campaignId: string;
  ownerId: string;
}

/** The standing approval and the delegation both still hold. */
export async function agentMayQueue(svc: Svc, approval: AgentApproval): Promise<boolean> {
  if (!linkedInBridgeEnabled()) return false;
  const [pilot, delegation] = await Promise.all([
    svc.from("agent_campaign_autopilots").select("enabled, contact_enabled, owner_id")
      .eq("workspace_id", approval.workspaceId).eq("campaign_id", approval.campaignId).maybeSingle(),
    svc.from("agent_delegations").select("scopes, revoked_at")
      .eq("workspace_id", approval.workspaceId).eq("user_id", approval.ownerId).maybeSingle(),
  ]);
  if (pilot.error || delegation.error || !pilot.data || !delegation.data) return false;
  return pilot.data.enabled === true
    && pilot.data.contact_enabled === true
    && pilot.data.owner_id === approval.ownerId
    && delegation.data.revoked_at === null
    && Array.isArray(delegation.data.scopes)
    && delegation.data.scopes.includes("queue_linkedin");
}

/** The owner's paired LinkedIn account, if any. */
export async function ownerAccount(svc: Svc, workspaceId: string, ownerId: string): Promise<BridgeAccount | null> {
  const { data, error } = await svc.from("linkedin_bridge_accounts").select(ACCOUNT_COLUMNS)
    .eq("workspace_id", workspaceId).eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error("linkedin_bridge_accounts read failed");
  return (data as BridgeAccount | null) ?? null;
}

export type AgentContact =
  | { ok: true; contact: ContactRow }
  | { ok: false; reason: string };

/**
 * Where the candidate stands with the owner on LinkedIn. A contact seen for
 * the first time gets a look-up request (one profile view, done by the
 * owner's extension on its next poll); the relationship is then "unknown"
 * until it answers.
 */
export async function agentContact(svc: Svc, account: BridgeAccount, candidateId: string): Promise<AgentContact> {
  const candidate = await candidateRecord(svc, account.workspace_id, candidateId);
  if (!candidate) return { ok: false, reason: "Candidate not found." };
  const blocked = contactBlock(candidate);
  if (blocked) return { ok: false, reason: blocked };
  const identity = publicIdFromProfileUrl(candidate.linkedinUrl);
  if (!identity) return { ok: false, reason: "No LinkedIn profile URL ARIA can read." };
  const known = await contactForCandidate(svc, account.id, candidate.id);
  const contact = await ensureContact(svc, account.id, candidate.id, identity);
  if (known && known.identity === identity && contact.relationship === "unknown" && !contact.lookup_requested) {
    await updateContact(svc, contact.id, { lookup_requested: true, lookup_error: null });
  }
  return { ok: true, contact };
}

export type AgentQueueResult =
  | { ok: true; item: OutboxRow; reused: boolean }
  | { ok: false; reason: string };

/**
 * Queue one invitation (non-connection) or message (1st degree) for the
 * owner's extension. Refused unless the approval holds, the candidate may be
 * contacted, and the relationship matches the kind. An identical write
 * already waiting or sent for this candidate is returned instead of a second
 * one (a crashed tick never sends twice).
 */
export async function agentQueue(
  svc: Svc,
  approval: AgentApproval,
  input: { candidateId: string; kind: "message" | "invitation"; body: string },
): Promise<AgentQueueResult> {
  if (!(await agentMayQueue(svc, approval))) return { ok: false, reason: "The campaign's autopilot or the owner's delegation is off." };
  const account = await ownerAccount(svc, approval.workspaceId, approval.ownerId);
  if (!account) return { ok: false, reason: "The campaign owner has no LinkedIn connected in ARIA." };
  const candidate = await candidateRecord(svc, approval.workspaceId, input.candidateId);
  if (!candidate) return { ok: false, reason: "Candidate not found." };
  const blocked = contactBlock(candidate);
  if (blocked) return { ok: false, reason: blocked };
  const identity = publicIdFromProfileUrl(candidate.linkedinUrl);
  if (!identity) return { ok: false, reason: "No LinkedIn profile URL ARIA can read." };
  const contact = await contactForCandidate(svc, account.id, candidate.id);
  if (!contact || contact.identity !== identity) return { ok: false, reason: "LinkedIn look-up not done for this profile." };

  const body = input.body.trim();
  if (input.kind === "invitation") {
    if (contact.relationship !== "none") return { ok: false, reason: `Cannot invite: relationship is ${contact.relationship}.` };
    if (body.length > INVITATION_NOTE_MAX) return { ok: false, reason: "Invitation note longer than 300 characters." };
  } else {
    if (contact.relationship !== "connected") return { ok: false, reason: `Cannot message: relationship is ${contact.relationship}.` };
    if (!body) return { ok: false, reason: "Empty message." };
  }

  const existing = await svc.from("linkedin_bridge_outbox").select(OUTBOX_COLUMNS)
    .eq("account_id", account.id).eq("candidate_id", candidate.id).eq("kind", input.kind)
    .in("status", ["queued", "resolving", "sending", "sent", "unknown"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) return { ok: false, reason: "Outbox unavailable." };
  if (existing.data) return { ok: true, item: existing.data as OutboxRow, reused: true };

  const waiting = await svc.from("linkedin_bridge_outbox").select("id", { count: "exact", head: true })
    .eq("account_id", account.id).in("status", ["queued", "resolving", "sending"]);
  if (waiting.error) return { ok: false, reason: "Outbox unavailable." };
  if ((waiting.count ?? 0) >= MAX_WAITING) return { ok: false, reason: `${MAX_WAITING} writes are already waiting.` };

  const row: Record<string, unknown> = {
    account_id: account.id,
    created_by: approval.ownerId,
    kind: input.kind,
    contact_id: contact.id,
    candidate_id: candidate.id,
    body,
    recipient_name: candidate.name.slice(0, 200),
    recipient_member_id: contact.member_id,
    recipient_public_id: contact.member_id ? null : contact.identity,
  };
  if (input.kind === "message") {
    const conversation = await svc.from("linkedin_bridge_conversations").select("id, conversation_urn")
      .eq("account_id", account.id).eq("candidate_id", candidate.id)
      .order("last_activity_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (conversation.error) return { ok: false, reason: "Conversation unavailable." };
    if (conversation.data) {
      row.conversation_id = conversation.data.id;
      row.conversation_urn = conversation.data.conversation_urn;
      row.recipient_member_id = null;
      row.recipient_public_id = null;
    }
  }
  const { data, error } = await svc.from("linkedin_bridge_outbox").insert(row).select(OUTBOX_COLUMNS).single();
  if (error || !data) {
    console.error("[agents] outbox insert failed", error?.code, error?.message);
    return { ok: false, reason: "Could not queue on LinkedIn." };
  }
  return { ok: true, item: data as OutboxRow, reused: false };
}

/** An outbox row of the owner's account, to follow what became of a queued write. */
export async function agentOutboxItem(svc: Svc, workspaceId: string, ownerId: string, outboxId: string): Promise<OutboxRow | null> {
  const account = await ownerAccount(svc, workspaceId, ownerId);
  if (!account) return null;
  const { data, error } = await svc.from("linkedin_bridge_outbox").select(OUTBOX_COLUMNS)
    .eq("account_id", account.id).eq("id", outboxId).maybeSingle();
  if (error) throw new Error("linkedin_bridge_outbox read failed");
  return (data as OutboxRow | null) ?? null;
}
