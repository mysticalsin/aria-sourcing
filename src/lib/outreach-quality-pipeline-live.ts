import "server-only";

/**
 * Server-only live LLM peer critics for outreach quality.
 * Kept separate from the deterministic pipeline so client bundles never import
 * serverGenerateText / server-only modules.
 */

import { serverGenerateText } from "@/lib/ai/server-generate";
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
    llmCriticsUsed: llmStages.length > 0,
  };
}

/**
 * Deterministic pipeline + optional live LLM peer critics (three agents).
 * When no LLM key is configured, returns the deterministic verdict unchanged.
 */
export async function validateOutreachQualityLive(input: {
  subject: string;
  body: string;
  channel?: string;
}): Promise<OutreachQualityVerdict> {
  const base = validateOutreachQuality(input);
  if (process.env.ARIA_QUALITY_LLM_CRITICS === "0") return base;

  try {
    const channel = input.channel ?? "Email";
    const system =
      "You are three recruiting outreach quality critics. Reply with JSON only: " +
      '{"empathy":{"pass":bool,"score":0-100,"reasons":string[]},' +
      '"compliance":{"pass":bool,"score":0-100,"reasons":string[]},' +
      '"human_likeness":{"pass":bool,"score":0-100,"reasons":string[]}}. ' +
      "Flag salary disclosure, AI self-disclosure, generic openers, pressure language, and robotic tone. " +
      "No prose outside JSON.";
    const prompt = [
      `Channel: ${channel}`,
      `Subject: ${input.subject}`,
      "Body:",
      input.body.slice(0, 4_000),
    ].join("\n");
    const live = await serverGenerateText({ system, prompt, maxTokens: 512 });
    if (!live.ok) return base;

    const jsonMatch = /\{[\s\S]*\}/.exec(live.text);
    if (!jsonMatch) return base;
    const parsed = JSON.parse(jsonMatch[0]) as Record<
      string,
      { pass?: boolean; score?: number; reasons?: string[] }
    >;
    const toStage = (key: string, stage: QualityStage): StageResult | null => {
      const row = parsed[key];
      if (!row || typeof row !== "object") return null;
      const score = Math.max(0, Math.min(100, Number(row.score) || 0));
      const reasons = Array.isArray(row.reasons)
        ? row.reasons.map(String).filter(Boolean).slice(0, 8)
        : [];
      return {
        stage,
        pass: row.pass === true && score >= 60,
        score,
        reasons,
      };
    };
    const llmStages = [
      toStage("empathy", "llm_empathy"),
      toStage("compliance", "llm_compliance"),
      toStage("human_likeness", "llm_human_likeness"),
    ].filter((s): s is StageResult => Boolean(s));
    if (llmStages.length === 0) return base;
    return mergeVerdict(base, llmStages);
  } catch {
    return base;
  }
}
