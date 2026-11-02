/* ============================================================================
   "Draft all due" mission: one follow-up drafting agent per candidate whose
   silence gap has elapsed, a few at a time.

   Each agent calls draftFollowUpFor, which tries the outreach task (Sonnet)
   and keeps a template draft when the model is unavailable, so the agent
   itself needs no fallback. A run drafts at most MAX_FOLLOW_UPS_PER_RUN,
   best matches first: each draft is a model call and lands in a human
   approval queue, so a 40-item backlog is worked through in reviewable runs.
   Nothing is sent.
   ========================================================================== */

import type { FollowUpDueItem } from "@/lib/recommendations";
import type { OutreachMessage } from "@/lib/types";
import type { AgentDefinition, MissionPlan } from "./mission";

export const MAX_FOLLOW_UPS_PER_RUN = 20;

export function followUpPlan(
  due: readonly FollowUpDueItem[],
  draftFollowUp: (candidateId: string) => Promise<OutreachMessage | null>,
  options: { max?: number } = {},
): MissionPlan {
  const max = Math.max(0, Math.min(options.max ?? MAX_FOLLOW_UPS_PER_RUN, MAX_FOLLOW_UPS_PER_RUN));
  const agent: AgentDefinition<FollowUpDueItem, OutreachMessage> = {
    id: "follow-up-drafter",
    label: "Follow-up drafter",
    tier: "sonnet",
    async run(item) {
      const message = await draftFollowUp(item.candidateId);
      // Null means the candidate moved on since the list was computed.
      if (!message) throw new Error("No longer due.");
      return message;
    },
  };
  return {
    id: "follow-ups",
    label: "Draft due follow-ups",
    steps: [
      {
        id: "follow-ups",
        agent,
        fanOut: () => [...due].sort((a, b) => b.matchScore - a.matchScore).slice(0, max),
        tolerateItemFailure: true,
      },
    ],
  };
}
