/* ============================================================================
   "Run Aria" mission for one campaign: source a batch, then draft first-touch
   outreach for the best new candidates, each draft as its own agent.

   Model use per agent (resolved server-side per task):
   - sourcing: the in-process sourcing agent (Sonnet tool loop when a workspace
     key is set, deterministic GitHub search otherwise);
   - drafting: Sonnet through the outreach task, one agent per candidate, a
     few at a time. A template draft stands in when the model is unavailable.
   Every draft lands in the human approval queue; nothing is sent.
   ========================================================================== */

import type { Candidate, OutreachMessage } from "@/lib/types";
import { isAgentTimeout, type AgentDefinition, type MissionPlan } from "./mission";

export interface CampaignMissionDeps {
  sourceBatch: () => Promise<{ ok: true; accepted: Candidate[] } | { ok: false; error: string }>;
  /** Model-first draft; null when the candidate can no longer be drafted. */
  draftLive: (candidateId: string) => Promise<OutreachMessage | null>;
  /** Deterministic template draft, used when draftLive throws unexpectedly. */
  draftTemplate: (candidateId: string) => OutreachMessage | null;
}

export interface DraftedPair {
  candidate: Candidate;
  message: OutreachMessage;
}

/** Drafts per run. Each one is a model call, so the cap is a cost control. */
export const MAX_MISSION_DRAFTS = 6;

export class DraftUnavailableError extends Error {}

export function campaignLaunchPlan(
  campaignId: string,
  deps: CampaignMissionDeps,
  options: { maxDrafts?: number } = {},
): MissionPlan {
  const maxDrafts = Math.max(0, Math.min(options.maxDrafts ?? MAX_MISSION_DRAFTS, MAX_MISSION_DRAFTS));

  const sourcingAgent: AgentDefinition<void, Candidate[]> = {
    id: "sourcing",
    label: "Sourcing agent",
    tier: "sonnet",
    async run() {
      const result = await deps.sourceBatch();
      if (!result.ok) throw new Error(result.error);
      return result.accepted;
    },
  };

  const draftAgent: AgentDefinition<Candidate, DraftedPair> = {
    id: "outreach-drafter",
    label: "Outreach drafter",
    tier: "sonnet",
    async run(candidate) {
      const message = await deps.draftLive(candidate.id);
      if (!message) throw new DraftUnavailableError(`No draft for ${candidate.name}.`);
      return { candidate, message };
    },
    async fallback(candidate, _ctx, error) {
      // A candidate that cannot be drafted at all (blocked, suppressed, no
      // email) stays skipped. A timed-out live draft may still commit, so a
      // template here could duplicate it. Model outages never reach this
      // point: draftLive already returns its own template draft for those.
      if (error instanceof DraftUnavailableError || isAgentTimeout(error)) throw error;
      const message = deps.draftTemplate(candidate.id);
      if (!message) throw new DraftUnavailableError(`No draft for ${candidate.name}.`);
      return { candidate, message };
    },
  };

  return {
    id: `launch-${campaignId}`,
    label: "Source and draft",
    steps: [
      { id: "source", agent: sourcingAgent },
      {
        id: "drafts",
        agent: draftAgent,
        dependsOn: ["source"],
        fanOut: (results) =>
          [...((results.source as Candidate[] | undefined) ?? [])]
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, maxDrafts),
        tolerateItemFailure: true,
      },
    ],
  };
}
