import { randomBytes } from "crypto";
import { deriveStarRating } from "@/lib/tania";
import { getHubRole } from "./catalog";
import type {
  HubApplyAnswer,
  HubApplyInput,
  HubCompatibilityReport,
  HubCriterionScore,
  HubLocale,
  HubNextStepInput,
  HubRole,
} from "./types";

function pctForAnswer(role: HubRole, answer: HubApplyAnswer): number {
  const question = role.questions.find((q) => q.id === answer.questionId);
  if (!question) return 0;
  if (question.kind === "stars") {
    const stars = answer.stars ?? Number(answer.value);
    if (!Number.isFinite(stars)) return 0;
    return Math.max(0, Math.min(1, stars / 5));
  }
  const v = answer.value.trim().toLowerCase();
  switch (question.criterionId) {
    case "location":
      if (v === "yes") return 1;
      if (v === "relocate") return 0.65;
      return 0.15;
    case "visa":
      return v === "no" || v === "false" ? 1 : 0.35;
    case "experience":
      if (v === "6+") return 1;
      if (v === "3-5") return 0.75;
      if (v === "0-2") return 0.35;
      return 0.2;
    case "language":
      if (v === "c1") return 1;
      if (v === "b2") return 0.85;
      if (v === "b1") return 0.55;
      return 0.25;
    case "availability":
      if (v === "immediate") return 1;
      if (v === "1m") return 0.85;
      if (v === "3m") return 0.55;
      return 0.25;
    default:
      return 0.5;
  }
}

function detailFor(locale: HubLocale, criterionId: string, pct: number): string {
  const band = pct >= 0.85 ? "strong" : pct >= 0.6 ? "good" : pct >= 0.35 ? "partial" : "weak";
  const copy: Record<string, Record<HubLocale, string>> = {
    strong: {
      fr: "Alignement fort avec le critère.",
      en: "Strong alignment with this criterion.",
      es: "Alineación fuerte con el criterio.",
    },
    good: {
      fr: "Bon alignement, à confirmer en entretien.",
      en: "Good alignment — confirm in interview.",
      es: "Buena alineación — confirmar en entrevista.",
    },
    partial: {
      fr: "Alignement partiel — point de vigilance.",
      en: "Partial fit — watchpoint for recruiters.",
      es: "Encaje parcial — punto de atención.",
    },
    weak: {
      fr: "Faible alignement sur ce critère.",
      en: "Weak alignment on this criterion.",
      es: "Alineación débil en este criterio.",
    },
  };
  return copy[band]![locale];
}

function recommendationFromTotal(total: number): HubCompatibilityReport["recommendation"] {
  if (total >= 85) return "strong_yes";
  if (total >= 70) return "yes";
  if (total >= 55) return "maybe";
  return "no";
}

export function scoreHubApplication(
  slug: string,
  input: HubApplyInput,
  createdAt = new Date().toISOString(),
): HubCompatibilityReport | null {
  const role = getHubRole(slug);
  if (!role) return null;
  if (!input.firstName.trim() || !input.lastName.trim() || !input.email.trim()) return null;
  if (input.answers.length < role.questions.length) return null;

  const byId = new Map(input.answers.map((a) => [a.questionId, a]));
  for (const q of role.questions) {
    if (!byId.has(q.id)) return null;
  }

  const criteria: HubCriterionScore[] = role.criteria.map((criterion) => {
    const related = role.questions.filter((q) => q.criterionId === criterion.id);
    const pcts = related.map((q) => pctForAnswer(role, byId.get(q.id)!));
    const pct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const score = Math.round(criterion.weight * pct);
    return {
      id: criterion.id,
      label: criterion.label[input.locale],
      weight: criterion.weight,
      score,
      pct,
      detail: detailFor(input.locale, criterion.id, pct),
    };
  });

  const total = Math.min(100, criteria.reduce((sum, c) => sum + c.score, 0));
  const starRating = deriveStarRating(total);
  const recommendation = recommendationFromTotal(total);
  const nextStepUnlocked = recommendation === "strong_yes" || recommendation === "yes" || recommendation === "maybe";

  return {
    reportId: `hub_${randomBytes(8).toString("hex")}`,
    slug: role.slug,
    roleTitle: role.title[input.locale],
    candidateName: `${input.firstName.trim()} ${input.lastName.trim()}`,
    email: input.email.trim().toLowerCase(),
    locale: input.locale,
    total,
    recommendation,
    starRating,
    criteria,
    nextStepUnlocked,
    nextStepStatus: "none",
    createdAt,
    screeningMode: "async_text",
  };
}

export function applyNextStepToReport(
  report: HubCompatibilityReport,
  input: HubNextStepInput,
  requestedAt = new Date().toISOString(),
): HubCompatibilityReport | null {
  if (!report.nextStepUnlocked) return null;
  const day = input.day.trim();
  const time = input.time.trim();
  if (!day || !time || day.length > 40 || time.length > 40) return null;
  return {
    ...report,
    nextStepStatus: "requested",
    nextStep: {
      day,
      time,
      note: input.note?.trim().slice(0, 280) || undefined,
      requestedAt,
    },
  };
}

export function publicHubProjection(role: HubRole, locale: HubLocale) {
  return {
    slug: role.slug,
    title: role.title[locale],
    department: role.department,
    seniority: role.seniority,
    employmentType: role.employmentType,
    locationType: role.locationType,
    regions: role.regions,
    requiredSkills: role.requiredSkills,
    niceToHaveSkills: role.niceToHaveSkills,
    summary: role.summary[locale],
    linkedInSearchHint: role.linkedInSearchHint,
    criteria: role.criteria.map((c) => ({
      id: c.id,
      label: c.label[locale],
      weight: c.weight,
    })),
    questions: role.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      criterionId: q.criterionId,
      prompt: q.prompt[locale],
      choices: q.choices?.map((c) => ({ value: c.value, label: c.label[locale] })),
    })),
    screeningMode: "async_text" as const,
    callingExcluded: true,
  };
}
