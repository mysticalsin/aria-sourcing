// LinkedIn bridge, candidate side. The signed-in user's LinkedIn standing with
// sourced candidates.
//   GET   every candidate this user's LinkedIn follows: relationship,
//         invitation, conversation summary, write in progress
//   POST  { candidateId, action: "check" }          look the candidate up again
//         { candidateId, action: "invite", note? }  queue a connection invitation
//         (this click is the human approval; nothing automated calls it)
// The candidate and its LinkedIn URL are read from the workspace state on the
// server, never taken from the browser.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { readBridgePolicy, writeSlot } from "@/lib/linkedin-bridge/policy";
import { INVITATION_NOTE_LIMIT, publicIdFromProfileUrl } from "@/lib/linkedin-bridge/voyager";
import {
  CONTACT_COLUMNS,
  OUTBOX_COLUMNS,
  accountForUser,
  badRequest,
  candidateRecord,
  contactBlock,
  ensureContact,
  notFound,
  okJson,
  recentWrites,
  requireBridgeUser,
  serverError,
  unreadInAria,
  updateContact,
  type ContactRow,
  type OutboxRow,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

type ConversationSummary = {
  id: string;
  candidate_id: string;
  unread: boolean;
  seen_at: string | null;
  last_activity_at: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_message_preview: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return okJson({ paired: false, contacts: [] });
    const svc = auth.ctx.svc;
    const [contacts, conversations, writes] = await Promise.all([
      svc.from("linkedin_bridge_contacts").select(CONTACT_COLUMNS).eq("account_id", account.id).limit(5000),
      svc
        .from("linkedin_bridge_conversations")
        .select("id, candidate_id, unread, seen_at, last_activity_at, last_message_direction, last_message_preview")
        .eq("account_id", account.id)
        .not("candidate_id", "is", null)
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(5000),
      svc
        .from("linkedin_bridge_outbox")
        .select(OUTBOX_COLUMNS)
        .eq("account_id", account.id)
        .not("candidate_id", "is", null)
        .in("status", ["queued", "resolving", "sending", "failed", "unknown"])
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    if (contacts.error || conversations.error || writes.error) return serverError("LinkedIn state unavailable.");

    const latestConversation = new Map<string, ConversationSummary>();
    for (const c of (conversations.data as ConversationSummary[] | null) ?? []) {
      if (!latestConversation.has(c.candidate_id)) latestConversation.set(c.candidate_id, c);
    }
    const latestWrite = new Map<string, OutboxRow>();
    for (const w of (writes.data as OutboxRow[] | null) ?? []) {
      if (w.candidate_id && !latestWrite.has(w.candidate_id)) latestWrite.set(w.candidate_id, w);
    }
    const now = Date.now();
    const lastSeen = account.last_seen_at ? Date.parse(account.last_seen_at) : null;
    // When the next queued write may leave (pacing), so the page can say so.
    const queued = ((writes.data as OutboxRow[] | null) ?? []).filter((w) => w.status === "queued");
    const oldest = queued[queued.length - 1];
    let nextWriteAt: string | null = null;
    if (oldest) {
      const slot = writeSlot({ now, kind: oldest.kind, recent: await recentWrites(svc, account.id, new Date(now)), policy: readBridgePolicy() });
      if (!slot.allowed) nextWriteAt = new Date(slot.retryAt).toISOString();
    }
    return okJson({
      nextWriteAt,
      paired: true,
      account: {
        displayName: account.display_name,
        sessionPresent: account.session_present,
        online: lastSeen !== null && now - lastSeen < ONLINE_WINDOW_MS,
        lastError: account.last_error,
      },
      inviteNoteLimit: INVITATION_NOTE_LIMIT,
      contacts: ((contacts.data as ContactRow[] | null) ?? []).map((contact) => {
        const conversation = latestConversation.get(contact.candidate_id);
        const write = latestWrite.get(contact.candidate_id);
        return {
          candidateId: contact.candidate_id,
          relationship: contact.relationship,
          displayName: contact.display_name,
          headline: contact.headline,
          checking: contact.lookup_requested,
          checkedAt: contact.checked_at,
          lookupError: contact.lookup_error,
          invitedAt: contact.invited_at,
          acceptedAt: contact.accepted_at,
          conversation: conversation
            ? {
                id: conversation.id,
                unread: unreadInAria(conversation),
                lastActivityAt: conversation.last_activity_at,
                lastDirection: conversation.last_message_direction,
                preview: conversation.last_message_preview,
              }
            : null,
          pending: write
            ? { id: write.id, kind: write.kind, status: write.status, error: write.error, body: write.body, createdAt: write.created_at }
            : null,
        };
      }),
    });
  } catch {
    return serverError("LinkedIn state unavailable.");
  }
}

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), candidateId: z.string().min(1).max(100) }),
  z.object({
    action: z.literal("invite"),
    candidateId: z.string().min(1).max(100),
    note: z.string().max(INVITATION_NOTE_LIMIT).optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, ActionSchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;
  const body = validated.data;
  try {
    const { svc, workspaceId, userId } = auth.ctx;
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Connect your LinkedIn in Settings first.");
    const candidate = await candidateRecord(svc, workspaceId, body.candidateId);
    if (!candidate) return notFound("Candidate not found.");
    const identity = publicIdFromProfileUrl(candidate.linkedinUrl);
    if (!identity) return badRequest("This candidate has no LinkedIn profile URL ARIA can read.");
    const contact = await ensureContact(svc, account.id, candidate.id, identity);

    if (body.action === "check") {
      await updateContact(svc, contact.id, { lookup_requested: true, lookup_error: null });
      return okJson({ checking: true });
    }

    const blocked = contactBlock(candidate);
    if (blocked) return badRequest(blocked);
    if (contact.relationship === "connected") return badRequest("Already connected on LinkedIn: send a message instead.");
    if (contact.relationship === "pending") return badRequest("An invitation is already pending.");
    if (contact.relationship === "not_found") return badRequest("LinkedIn does not know this profile. Check the candidate's LinkedIn URL.");
    const { count, error: countError } = await svc
      .from("linkedin_bridge_outbox")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .eq("contact_id", contact.id)
      .eq("kind", "invitation")
      .in("status", ["queued", "resolving", "sending"]);
    if (countError) return serverError("Outbox unavailable.");
    if (count) return badRequest("An invitation to this candidate is already on its way.");

    const { data, error } = await svc
      .from("linkedin_bridge_outbox")
      .insert({
        account_id: account.id,
        created_by: userId,
        kind: "invitation",
        contact_id: contact.id,
        candidate_id: candidate.id,
        body: (body.note ?? "").trim(),
        recipient_member_id: contact.member_id,
        recipient_public_id: contact.member_id ? null : contact.identity,
        recipient_name: candidate.name.slice(0, 200),
      })
      .select(OUTBOX_COLUMNS)
      .single();
    if (error || !data) return serverError("Could not queue the invitation.");
    const policy = readBridgePolicy();
    return okJson({ item: data, dailyInviteCap: policy.dailyInviteCap });
  } catch {
    return serverError("LinkedIn action failed.");
  }
}
