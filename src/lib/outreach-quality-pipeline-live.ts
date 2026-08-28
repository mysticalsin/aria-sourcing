import "server-only";

/**
 * Server-only live LLM peer critics for outreach quality.
 * Kept separate from the deterministic pipeline so client bundles never import
 * serverGenerateText / server-only modules.
 *
 * Three critic agents run as separate LLM calls (empathy, compliance,
 * human-likeness) — fail-closed when any required critic cannot run.
 */

import { HERMES_QUALITY_CRITICS } from "@/lib/agents/hermes-agent-registry";
import { serverGenerateText } from "@/lib/ai/server-generate";
import { parseCriticJson } from "@/lib/outreach-critic-json";
import {
  validateOutreachQuality,
  type OutreachQualityVerdict,
  type QualityStage,
  type StageResult,
} from "@/lib/outreach-quality-pipeline";

function mergeVerdict(
  base: OutreachQualityVerdict,
  llmStages: StageResult[],
): OutreachQualityVerdict {
  const stages = [...base.stages, ...llmStages];
  const aggregateScore = Math.round(stages.reduce((sum, s) => sum + s.score, 0) / stages.length);
  let status: OutreachQualityVerdict["status"] = base.status;
  const llmBlocked = llmStages.some((s) => !s.pass && s.score < 50);
  const llmNeedsReview = llmStages.some((s) => !s.pass || s.score < 70);
  if (llmBlocked || status === "blocked") status = "blocked";
  else if (llmNeedsReview || status === "needs_review") status = "needs_review";
  else if (aggregateScore < 75) status = "needs_review";
  return {
    ...base,
    stages,
    aggregateScore,
    status,
    // All three critic agents must succeed for autonomous llmCriticsUsed.
    llmCriticsUsed: llmStages.length === CRITICS.length,
  };
}

type CriticSpec = {
  key: string;
  stage: QualityStage;
  system: string;
};

const CRITICS: CriticSpec[] = HERMES_QUALITY_CRITICS.map((critic) => ({
  key: critic.id.replace(/^critic-/, ""),
  stage: critic.stage,
  system: critic.system,
}));

async function runOneCritic(
  critic: CriticSpec,
  input: { subject: string; body: string; channel: string },
  workspaceId?: string,
): Promise<StageResult | null> {
  const prompt = [
    `Channel: ${input.channel}`,
    `Subject: ${input.subject}`,
    "Body:",
    input.body.slice(0, 4_000),
  ].join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const live = await serverGenerateText({
      system: critic.system,
      prompt,
      maxTokens: 256,
      workspaceId,
    });
    if (!live.ok) continue;
    const row = parseCriticJson(live.text);
    if (!row) continue;
    const score = Math.max(0, Math.min(100, Number(row.score) || 0));
    const reasons = Array.isArray(row.reasons)
      ? row.reasons.map(String).filter(Boolean).slice(0, 8)
      : [];
    return {
      stage: critic.stage,
      pass: row.pass === true && score >= 60,
      score,
      reasons,
    };
  }
  return null;
}

/**
 * Deterministic pipeline + optional live LLM peer critics (three separate agents).
 * When no LLM key is configured, returns the deterministic verdict unchanged.
 */
export async function validateOutreachQualityLive(input: {
  subject: string;
  body: string;
  channel?: string;
  workspaceId?: string;
}): Promise<OutreachQualityVerdict> {
  const base = validateOutreachQuality(input);
  if (process.env.ARIA_QUALITY_LLM_CRITICS === "0") return base;

  try {
    const channel = input.channel ?? "Email";
    const payload = { subject: input.subject, body: input.body, channel };
    // Sequential peers: parallel bursts after draft generation starve the vault
    // Anthropic path (env Kimi 401 failover) and return critics_required.
    // serverGenerateText skips recently auth-dead env providers across peers.
    const llmStages: StageResult[] = [];
    for (const critic of CRITICS) {
      const result = await runOneCritic(critic, payload, input.workspaceId);
      if (result) llmStages.push(result);
    }
    // Fail closed: all three critic agents required for llmCriticsUsed / autonomous ready.
    // Partial or empty critic runs must not keep a deterministic "ready" while discarding
    // any negative peer signal (or silently implying full multi-agent validation).
    if (llmStages.length !== CRITICS.length) {
      const merged = mergeVerdict(base, llmStages);
      return {
        ...merged,
        status: merged.status === "blocked" ? "blocked" : "needs_review",
        llmCriticsUsed: false,
      };
    }
    return mergeVerdict(base, llmStages);
  } catch {
    // Critic infrastructure failed — never report ready as if peers ran.
    return {
      ...base,
      status: base.status === "blocked" ? "blocked" : "needs_review",
      llmCriticsUsed: false,
    };
  }
}
