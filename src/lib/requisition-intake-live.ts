import "server-only";

/**
 * Live LLM parse for autonomous webhook/cron intake.
 * Kept server-only so client/test imports of requisition-intake stay clean.
 */

import { buildIntakeParsePrompt, parseHermesIntakeJson } from "@/lib/ai/intake";
import { serverGenerateText } from "@/lib/ai/server-generate";
import { parseInboundNeed } from "@/lib/requisition-intake";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import type { JobAnalysis } from "@/lib/types";

/** Autonomous loop parse: prefer configured server LLM, fall back to heuristic. */
export async function parseInboundNeedLive(
  emailText: string,
  opts?: { workspaceId?: string },
) {
  const fallback = parseInboundNeed(emailText);
  const prompt = buildIntakeParsePrompt(emailText);
  const live = await serverGenerateText({
    system:
      "You extract structured hiring needs from email. Reply with JSON only matching the requested schema. Never invent salaries, companies, or skills absent from the brief.",
    prompt,
    maxTokens: 2048,
    workspaceId: opts?.workspaceId,
  });
  if (!live.ok) return { ...fallback, modelUsed: false, modelReason: live.reason };

  const fields = parseHermesIntakeJson(live.text);
  if (!fields) return { ...fallback, modelUsed: false, modelReason: "invalid_model_json" };

  const job = fallback.jobAnalysis;
  const merged: JobAnalysis = {
    ...job,
    title: fields.title ?? job.title,
    department: fields.department ?? job.department,
    seniority: fields.seniority ?? job.seniority,
    employmentType: fields.employmentType ?? job.employmentType,
    locationType: fields.locationType ?? job.locationType,
    regions: fields.regions?.length ? fields.regions : job.regions,
    timezone: fields.timezone ?? job.timezone,
    salaryMin: fields.salaryMin !== undefined ? fields.salaryMin : job.salaryMin,
    salaryMax: fields.salaryMax !== undefined ? fields.salaryMax : job.salaryMax,
    currency: fields.currency ?? job.currency,
    equity: fields.equity ?? job.equity,
    requiredSkills: fields.requiredSkills?.length ? fields.requiredSkills : job.requiredSkills,
    niceToHaveSkills: fields.niceToHaveSkills ?? job.niceToHaveSkills,
    minYearsExperience:
      fields.minYearsExperience !== undefined ? fields.minYearsExperience : job.minYearsExperience,
    maxYearsExperience:
      fields.maxYearsExperience !== undefined ? fields.maxYearsExperience : job.maxYearsExperience,
    education: fields.education ?? job.education,
    industryExperience: fields.industryExperience ?? job.industryExperience,
    companyStageTarget: fields.companyStageTarget?.length
      ? fields.companyStageTarget
      : job.companyStageTarget,
    teamSize: fields.teamSize ?? job.teamSize,
    reportingTo: fields.reportingTo ?? job.reportingTo,
    missionDescription: fields.missionDescription ?? job.missionDescription,
    linkedinBoolean: fields.linkedinBoolean ?? job.linkedinBoolean,
  };
  const readiness = evaluateNeedReadiness(merged);
  return {
    ...fallback,
    jobAnalysis: merged,
    ready: readiness.ready,
    warnings: readiness.issues,
    confidence: readiness.ready ? 0.92 : 0.6,
    modelUsed: true,
    modelProvider: live.provider,
  };
}
