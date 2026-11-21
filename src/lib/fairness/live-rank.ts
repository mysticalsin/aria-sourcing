// Stub. The red commit returns a pass and forwards every feature.
// The live gate replaces this.

export type FairnessVerdict = "Insufficient" | "Pass" | "Warn" | "Fail";

export interface ProxyDelta {
  feature: "location" | "yearsExperience";
  delta: number;
}

export interface LiveRankingAudit {
  verdict: FairnessVerdict;
  autoReject: false;
  humanDecisionRequired: true;
  scrubbedScore: number;
  proxies: ProxyDelta[];
  detail: string;
}

export interface PromptAudit {
  prompt: string;
  verdict: FairnessVerdict;
  proxies: Array<"location" | "yearsExperience">;
}

export function scrubRankingFeatures(features: Record<string, unknown>): Record<string, unknown> {
  return { ...features };
}

export function auditLiveScore(
  features: Record<string, unknown>,
  score: (features: Record<string, unknown>) => number,
): LiveRankingAudit {
  return {
    verdict: "Pass",
    autoReject: false,
    humanDecisionRequired: true,
    scrubbedScore: score(features),
    proxies: [],
    detail: "not implemented",
  };
}

export function auditLivePrompt(prompt: string): PromptAudit {
  return { prompt, verdict: "Pass", proxies: [] };
}
