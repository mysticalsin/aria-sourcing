import "server-only";

/**
 * Server-only live LLM peer critics for outreach quality.
 * Kept separate from the deterministic pipeline so client bundles never import
 * serverGenerateText / server-only modules.
 *
 * Three critic agents run as separate LLM calls (empathy, compliance,
 * human-likeness) — fail-closed when any required critic cannot run.
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
    // All three critic agents must succeed for autonomous llmCriticsUsed.
    llmCriticsUsed: llmStages.length === CRITICS.length,
  };
}

type CriticSpec = {
  key: string;
  stage: QualityStage;
  system: string;
};

const CRITICS: CriticSpec[] = [
  {
    key: "empathy",
    stage: "llm_empathy",
    system:
      "You are the empathy critic for recruiting outreach. Reply with JSON only: " +
      '{"pass":bool,"score":0-100,"reasons":string[]}. ' +
      "Flag generic openers, cold pitch tone, pressure language, and missing candidate-specific detail. No prose outside JSON.",
  },
  {
    key: "compliance",
    stage: "llm_compliance",
    system:
      "You are the compliance critic for recruiting outreach. Reply with JSON only: " +
      '{"pass":bool,"score":0-100,"reasons":string[]}. ' +
      "Flag salary disclosure, AI self-disclosure, discriminatory language, invented credentials, " +
      "and missing Mantu Group brand (body must name Mantu). No prose outside JSON.",
  },
  {
    key: "human_likeness",
    stage: "llm_human_likeness",
    system:
      "You are the human-likeness critic for recruiting outreach. Reply with JSON only: " +
      '{"pass":bool,"score":0-100,"reasons":string[]}. ' +
      "Flag robotic tone, template tells, status narration, and tool/JSON leakage. No prose outside JSON.",
  },
];

function parseCriticJson(text: string): { pass?: boolean; score?: number; reasons?: string[] } | null {
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { pass?: boolean; score?: number; reasons?: string[] };
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

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
  for (let attempt = 0; attempt < 2; attempt++) {
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
    const results = await Promise.all(
      CRITICS.map((critic) => runOneCritic(critic, payload, input.workspaceId)),
    );
    const llmStages = results.filter((s): s is StageResult => Boolean(s));
    // Fail closed for partial critic runs — autonomous drafts require all three.
    if (llmStages.length !== CRITICS.length) return base;
    return mergeVerdict(base, llmStages);
  } catch {
    return base;
  }
}
