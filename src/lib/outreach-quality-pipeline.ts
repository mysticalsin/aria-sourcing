/**
 * Multi-agent outreach quality validation — deterministic critics before human approval.
 * Live LLM peer critics live in `outreach-quality-pipeline-live.ts` (server-only).
 *
 * Stages (mirrors a LangGraph fan-out):
 *   1. Empathy critic — warmth, personalization, human voice
 *   2. Compliance critic — policy, salary, injection
 *   3. Human-likeness gate — gateOutbound hard blocks
 */

import { gateOutbound, type GateVerdict } from "./gate";
import { checkLinkedInPolicy } from "./linkedin-policy";
import { validateCandidateBoundText } from "./agent-disclosure-policy";

export type QualityStage = "empathy" | "compliance" | "human_likeness" | "llm_empathy" | "llm_compliance" | "llm_human_likeness";

export type StageResult = {
  stage: QualityStage;
  pass: boolean;
  score: number;
  reasons: string[];
};

export type OutreachQualityVerdict = {
  status: "ready" | "needs_review" | "blocked";
  stages: StageResult[];
  text: { subject: string; body: string };
  aggregateScore: number;
  /** True when live LLM critics contributed stages. */
  llmCriticsUsed?: boolean;
};

const GENERIC_OPENERS: RegExp[] = [
  /\bi hope this (?:email |message )?finds you well\b/i,
  /\bi came across your profile\b/i,
  /\bi am reaching out to you today\b/i,
  /\bdear hiring manager\b/i,
  /\bto whom it may concern\b/i,
  /\bexciting opportunity\b/i,
  /\bperfect fit for our team\b/i,
  /\bwe are looking for someone like you\b/i,
];

const PRESSURE_LANGUAGE: RegExp[] = [
  /\bact now\b/i,
  /\blimited time\b/i,
  /\bdon't miss\b/i,
  /\bunique opportunity you can't\b/i,
  /\bimmediate start required\b/i,
  /\bonly \d+ slots?\b/i,
];

const ROBOTIC_MARKERS: RegExp[] = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bi'?m (?:an )?(?:ai|bot|virtual assistant)\b/i,
  /\bautomated message\b/i,
  /\bgenerated (?:by|using) ai\b/i,
];

function empathyCritic(subject: string, body: string): StageResult {
  const reasons: string[] = [];
  const combined = `${subject}\n${body}`;
  let score = 100;

  for (const pattern of GENERIC_OPENERS) {
    if (pattern.test(combined)) {
      reasons.push("generic-opener");
      score -= 15;
    }
  }
  for (const pattern of PRESSURE_LANGUAGE) {
    if (pattern.test(combined)) {
      reasons.push("pressure-language");
      score -= 20;
    }
  }
  for (const pattern of ROBOTIC_MARKERS) {
    if (pattern.test(combined)) {
      reasons.push("robotic-marker");
      score -= 30;
    }
  }

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 25) {
    reasons.push("too-short");
    score -= 10;
  }
  if (wordCount > 200) {
    reasons.push("too-long");
    score -= 10;
  }

  // Personalization signal: at least one proper noun or "your" + concrete noun
  const hasPersonalization =
    /\byour (?:work|project|repo|contribution|experience|background|profile)\b/i.test(body) ||
    /\b(?:I noticed|I saw|your recent)\b/i.test(body);
  if (!hasPersonalization) {
    reasons.push("missing-personalization");
    score -= 20;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    stage: "empathy",
    pass: score >= 60 && !reasons.includes("robotic-marker"),
    score,
    reasons,
  };
}

function complianceCritic(subject: string, body: string, channel: string): StageResult {
  const reasons: string[] = [];
  let score = 100;
  const combined = `${subject}\n${body}`;

  const linkedInPolicy = checkLinkedInPolicy(combined);
  if (!linkedInPolicy.ok) {
    reasons.push("linkedin-policy");
    score = 0;
  }

  const disclosure = validateCandidateBoundText(body);
  if (!disclosure.safe) {
    reasons.push("disclosure-boundary");
    score -= 40;
  }

  if (/\b(?:£|\$|€)\s?\d{2,}|\b\d{2,}k\b|\bsalary (?:is|of|around)\b/i.test(combined)) {
    reasons.push("salary-disclosure");
    score -= 50;
  }

  if (channel === "LinkedIn" && body.length > 600) {
    reasons.push("linkedin-too-long");
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    stage: "compliance",
    pass: score >= 70 && reasons.length === 0,
    score,
    reasons,
  };
}

function humanLikenessGate(body: string): { stage: StageResult; gate: GateVerdict } {
  const gate = gateOutbound(body);
  const reasons = gate.pass ? [] : [...gate.reasons];
  const score = gate.pass ? 100 : Math.max(0, 100 - reasons.length * 25);
  return {
    gate,
    stage: {
      stage: "human_likeness",
      pass: gate.pass,
      score,
      reasons,
    },
  };
}

/** Run the full multi-agent quality pipeline on an outreach draft. */
export function validateOutreachQuality(input: {
  subject: string;
  body: string;
  channel?: string;
}): OutreachQualityVerdict {
  const channel = input.channel ?? "Email";
  const empathy = empathyCritic(input.subject, input.body);
  const compliance = complianceCritic(input.subject, input.body, channel);
  const { stage: humanLikeness, gate } = humanLikenessGate(input.body);

  const stages = [empathy, compliance, humanLikeness];
  const aggregateScore = Math.round(stages.reduce((sum, s) => sum + s.score, 0) / stages.length);

  let status: OutreachQualityVerdict["status"] = "ready";
  if (!humanLikeness.pass || compliance.score < 50) {
    status = "blocked";
  } else if (!empathy.pass || !compliance.pass || aggregateScore < 75) {
    status = "needs_review";
  }

  const finalBody = gate.pass ? gate.text : input.body;

  return {
    status,
    stages,
    text: { subject: input.subject, body: finalBody },
    aggregateScore,
    llmCriticsUsed: false,
  };
}

export type OutreachQualityGateResult = {
  verdict: OutreachQualityVerdict;
  blockers: string[];
  warnings: string[];
};

/** Re-run the quality pipeline for server-side approve/send enforcement. */
export function outreachQualityGate(input: {
  subject: string;
  body: string;
  channel?: string;
}): OutreachQualityGateResult {
  const verdict = validateOutreachQuality(input);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (verdict.status === "blocked") {
    const reasons = verdict.stages.flatMap((stage) => stage.reasons).filter(Boolean);
    blockers.push(
      reasons.length > 0
        ? `Quality pipeline blocked (${reasons.join(", ")}).`
        : "Quality pipeline blocked this draft.",
    );
  } else if (verdict.status === "needs_review") {
    warnings.push(`Quality needs review (${verdict.aggregateScore}/100).`);
  }
  return { verdict, blockers, warnings };
}
