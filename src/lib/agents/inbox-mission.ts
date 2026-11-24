/* ============================================================================
   "Triage inbox" mission: pull new mail, classify each reply, and queue a
   response draft for every reply that calls for one.

   Model use:
   - classification: Haiku through the classify task, one agent per message,
     a few at a time. The same call returns intent, confidence, a suggested
     action and a short response draft (rule-based classifier as fallback);
   - response drafts: reuse the draft the classifier wrote at ingestion. A
     waiting reply with no draft gets one from the same Haiku classify call
     (prepareResponse), behind the same disclosure and injection checks.
   Nothing is sent, and consequential reply actions (stage moves, suppression
   on a negative reply) stay a recruiter's click on the reply card.
   ========================================================================== */

import type { ClassifiedReply, OutreachMessage, ReplyIntent } from "@/lib/types";
import type { InboundMessage } from "@/lib/email-sync";
import type { AgentDefinition, MissionPlan } from "./mission";

/** Intents that deserve a response. Negative replies are do-not-contact,
 *  out-of-office and plain refusals need none. */
export const RESPONSE_INTENTS: readonly ReplyIntent[] = ["INTERESTED", "QUALIFIED_INTEREST", "REFERRAL", "UNCLEAR"];

/** Response drafts per run: each lands in a human approval queue. */
export const MAX_RESPONSE_DRAFTS = 20;

export function needsResponse(
  reply: ClassifiedReply,
  outreach: readonly OutreachMessage[],
  /** True when a missing draft can be written (prepareResponse is available). */
  canPrepare = false,
): boolean {
  return (
    !reply.handled &&
    Boolean(reply.candidateId) &&
    (canPrepare || reply.draftResponse.trim().length > 0) &&
    RESPONSE_INTENTS.includes(reply.intent) &&
    !outreach.some((m) => m.inReplyTo === reply.id && m.status !== "Rejected")
  );
}

export interface InboxFetchResult {
  messages: InboundMessage[];
  /** Messages the server could not read. */
  skipped: number;
  /** Set when no mailbox was read, e.g. the public demo's dry run. */
  note?: string;
}

export interface InboxMissionDeps {
  fetchInbox: () => Promise<InboxFetchResult>;
  classify: (message: InboundMessage) => Promise<ClassifiedReply>;
  /** Replies already waiting for a response when the mission starts. */
  pending: ClassifiedReply[];
  /** Outreach at mission start, to skip replies that already have a draft. */
  outreach: readonly OutreachMessage[];
  /** Absent when the caller may not draft outreach: triage then stops at
   *  classification. */
  draftResponse?: (replyId: string) => OutreachMessage | null;
  /** Writes a missing draftResponse; null when no safe draft exists. */
  prepareResponse?: (replyId: string) => Promise<ClassifiedReply | null>;
}

export function inboxTriagePlan(deps: InboxMissionDeps): MissionPlan {
  const fetchAgent: AgentDefinition<void, InboxFetchResult> = {
    id: "mailbox-sync",
    label: "Mailbox sync",
    tier: "none",
    run: () => deps.fetchInbox(),
    // An unreachable mailbox must not block the replies already waiting.
    fallback: async (_input, _ctx, error) => ({
      messages: [],
      skipped: 0,
      note: `Mailbox not synced: ${error instanceof Error ? error.message : String(error)}`,
    }),
  };

  const classifyAgent: AgentDefinition<InboundMessage, ClassifiedReply> = {
    id: "reply-classifier",
    label: "Reply classifier",
    tier: "haiku",
    run: (message) => deps.classify(message),
  };

  const steps: MissionPlan["steps"] = [
    { id: "fetch", agent: fetchAgent },
    {
      id: "classify",
      agent: classifyAgent,
      dependsOn: ["fetch"],
      fanOut: (results) => (results.fetch as InboxFetchResult | undefined)?.messages ?? [],
      tolerateItemFailure: true,
    },
  ];

  const { draftResponse, prepareResponse } = deps;
  if (draftResponse) {
    const responseAgent: AgentDefinition<ClassifiedReply, OutreachMessage> = {
      id: "reply-responder",
      label: "Reply responder",
      tier: prepareResponse ? "haiku" : "none",
      async run(reply) {
        if (!reply.draftResponse.trim()) {
          const prepared = prepareResponse ? await prepareResponse(reply.id) : null;
          if (!prepared) throw new Error("No safe draft: left for a recruiter.");
        }
        const message = draftResponse(reply.id);
        if (!message) throw new Error("Reply can no longer be answered.");
        return message;
      },
    };
    steps.push({
      id: "respond",
      agent: responseAgent,
      dependsOn: ["classify"],
      fanOut: (results) => {
        const fresh = (results.classify as ClassifiedReply[] | undefined) ?? [];
        const seen = new Set<string>();
        return [...fresh, ...deps.pending]
          .filter((reply) => needsResponse(reply, deps.outreach, Boolean(prepareResponse)))
          .filter((reply) => (seen.has(reply.id) ? false : (seen.add(reply.id), true)))
          .slice(0, MAX_RESPONSE_DRAFTS);
      },
      tolerateItemFailure: true,
    });
  }

  return { id: "inbox-triage", label: "Triage inbox", steps };
}
