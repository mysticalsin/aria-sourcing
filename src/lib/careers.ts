import { computeChatboxScore, deriveStarRating, DEFAULT_STAR_THRESHOLDS } from "./tania";
import type { ChatboxAnswerKind, ChatboxScreeningAnswer, ChatboxSubmission, ChatboxPath } from "./types";

/** The only job fields that may cross the anonymous careers boundary. */
export interface PublicCareerJob {
  id: string;
  title: string;
  department: string;
  seniority: string;
  employmentType: string;
  locationType: string;
  regions: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  industryExperience: string[];
  screeningQuestions: string[];
}

export interface PublicCareerAnswer {
  kind: ChatboxAnswerKind;
  answer?: string;
  stars?: number;
  question?: string;
}

/** Candidate-controlled input accepted by the public careers endpoint. */
export interface PublicCareerApplicationInput {
  path: ChatboxPath;
  campaignId: string | null;
  roleTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cvFileName?: string;
  detected: {
    location?: string;
    nationality?: string;
    phoneCountry?: string;
    skills?: string[];
  };
  answers: PublicCareerAnswer[];
  contactPref?: { time?: string; day?: string };
}

const ACTIVE_PUBLIC_STATUSES = new Set(["Sourcing", "Outreach", "Interviewing", "Closing"]);
const QUICK_MATCH_QUESTIONS = new Set([
  "Desired role",
  "Sector",
  "Preferred location",
  "Open to relocating",
  "Needs visa sponsorship",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_CAREER_SCREENING = [
  "Is the role's location workable for you: happy on-site, remote, or would you relocate?",
  "Would you need visa sponsorship to work in this role?",
  "How would you rate your experience in the core skills for this role?",
  "And your hands-on expertise with the main tools involved?",
  "Have you worked on projects directly relevant to this role?",
] as const;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const normalized = text(item, maxLength);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function publicScreeningQuestions(value: unknown): string[] {
  return textList(value, 5, 500);
}

/**
 * Select jobs that an operator deliberately made public. Draft, paused, filled,
 * or compliance-failed campaigns never leave the server.
 */
export function publicCareerJobsFromState(state: unknown): PublicCareerJob[] {
  const root = asRecord(state);
  const campaigns = root?.campaigns;
  if (!Array.isArray(campaigns)) return [];

  const jobs: PublicCareerJob[] = [];
  for (const raw of campaigns) {
    const campaign = asRecord(raw);
    const jobAnalysis = asRecord(campaign?.jobAnalysis);
    const jobAd = asRecord(campaign?.jobAd);
    const knightM = asRecord(jobAd?.knightM);
    if (
      !campaign ||
      !jobAnalysis ||
      !jobAd ||
      !knightM ||
      !ACTIVE_PUBLIC_STATUSES.has(String(campaign.status ?? "")) ||
      jobAd.status !== "published" ||
      knightM.passed !== true
    ) {
      continue;
    }

    const id = text(campaign.id, 120);
    const title = text(campaign.title, 160);
    const department = text(campaign.department, 160);
    if (!id || !title || !department) continue;

    jobs.push({
      id,
      title,
      department,
      seniority: text(jobAnalysis.seniority, 80) ?? "",
      employmentType: text(jobAnalysis.employmentType, 80) ?? "",
      locationType: text(jobAnalysis.locationType, 80) ?? "",
      regions: textList(jobAnalysis.regions, 12, 100),
      requiredSkills: textList(jobAnalysis.requiredSkills, 12, 100),
      niceToHaveSkills: textList(jobAnalysis.niceToHaveSkills, 12, 100),
      industryExperience: textList(jobAnalysis.industryExperience, 12, 100),
      screeningQuestions: publicScreeningQuestions(jobAd.screeningQuestions),
    });
    if (jobs.length >= 100) break;
  }
  return jobs;
}

function canonicalScreeningQuestions(job: PublicCareerJob | null): readonly string[] {
  return job && job.screeningQuestions.length > 0
    ? [...job.screeningQuestions, ...DEFAULT_CAREER_SCREENING].slice(0, 5)
    : DEFAULT_CAREER_SCREENING;
}

function normalizedPhone(value: string, phoneCountry?: string): string | null {
  let digits = value.replace(/\D/g, "");
  const countryDigits = (phoneCountry ?? "").replace(/\D/g, "");
  // The public form prefixes a national number with its selected country code.
  // Strip one optional national trunk zero so `+33 06…` becomes E.164 `+336…`.
  if (countryDigits && digits.startsWith(countryDigits)) {
    const national = digits.slice(countryDigits.length);
    if (national.length >= 7 && national.startsWith("0")) digits = `${countryDigits}${national.slice(1)}`;
  }
  return digits.length >= 6 && digits.length <= 16 ? `+${digits}` : null;
}

function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function normalizedDetected(value: PublicCareerApplicationInput["detected"]): ChatboxSubmission["detected"] {
  const skills = textList(value.skills, 5, 100);
  return {
    ...(text(value.location, 160) ? { location: text(value.location, 160)! } : {}),
    ...(text(value.nationality, 100) ? { nationality: text(value.nationality, 100)! } : {}),
    ...(text(value.phoneCountry, 16) ? { phoneCountry: text(value.phoneCountry, 16)! } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function answerFor(answers: PublicCareerAnswer[], kind: ChatboxAnswerKind): PublicCareerAnswer | undefined {
  return answers.find((answer) => answer.kind === kind);
}

function canonicalAnswers(input: PublicCareerApplicationInput, job: PublicCareerJob | null): ChatboxScreeningAnswer[] | null {
  const questions = canonicalScreeningQuestions(job);
  const answers: ChatboxScreeningAnswer[] = [];
  const mobility = answerFor(input.answers, "mobility");
  const visa = answerFor(input.answers, "visa");
  const keyExp = answerFor(input.answers, "keyexp");
  const toolExp = answerFor(input.answers, "toolexp");
  const project = answerFor(input.answers, "project");

  if (input.path === "A") {
    if (!mobility || !visa || !keyExp || !toolExp || !project) return null;
    const mobilityAnswer = mobility.answer;
    const visaAnswer = visa.answer;
    const projectAnswer = project.answer;
    if (
      (mobilityAnswer !== "Yes" && mobilityAnswer !== "No" && mobilityAnswer !== "Relocation required") ||
      (visaAnswer !== "Yes" && visaAnswer !== "No") ||
      (projectAnswer !== "Yes" && projectAnswer !== "No") ||
      !Number.isInteger(keyExp.stars) ||
      !Number.isInteger(toolExp.stars) ||
      keyExp.stars! < 1 ||
      keyExp.stars! > 5 ||
      toolExp.stars! < 1 ||
      toolExp.stars! > 5
    ) {
      return null;
    }
    answers.push(
      { question: questions[0]!, answer: mobilityAnswer, kind: "mobility" },
      { question: questions[1]!, answer: visaAnswer, kind: "visa" },
      { question: questions[2]!, answer: `${keyExp.stars}/5`, kind: "keyexp", stars: keyExp.stars },
      { question: questions[3]!, answer: `${toolExp.stars}/5`, kind: "toolexp", stars: toolExp.stars },
      { question: questions[4]!, answer: projectAnswer, kind: "project" },
    );
  }

  for (const raw of input.answers) {
    if (raw.kind !== "quickmatch") continue;
    const question = text(raw.question, 80);
    const answer = text(raw.answer, 160);
    if (question && answer && QUICK_MATCH_QUESTIONS.has(question)) {
      answers.push({ question, answer, kind: "quickmatch" });
    }
  }
  return answers;
}

function compactContactPref(value: PublicCareerApplicationInput["contactPref"]): ChatboxSubmission["contactPref"] | undefined {
  const time = text(value?.time, 40);
  const day = text(value?.day, 40);
  return time || day ? { ...(time ? { time } : {}), ...(day ? { day } : {}) } : undefined;
}

/**
 * Rebuild a durable submission from bounded public input. Client-supplied role
 * titles, scores, ratings, identifiers, and status are never trusted.
 */
export function buildPublicCareerSubmission(
  input: PublicCareerApplicationInput,
  jobs: PublicCareerJob[],
  createdAt = new Date().toISOString(),
): ChatboxSubmission | null {
  if (input.path !== "A" && input.path !== "B") return null;
  const job = input.campaignId ? jobs.find((candidate) => candidate.id === input.campaignId) ?? null : null;
  if (input.campaignId && !job) return null;
  // Path A is an application to an explicit public campaign, never an
  // arbitrary client-supplied role. Path B remains the talent-pool route and
  // may use a candidate-described role when no public campaign is selected.
  if (input.path === "A" && !job) return null;

  const firstName = text(input.firstName, 80);
  const lastName = text(input.lastName, 80);
  const email = normalizedEmail(input.email);
  const phone = normalizedPhone(input.phone, text(input.detected.phoneCountry, 16) ?? undefined);
  const roleTitle = job?.title ?? text(input.roleTitle, 160);
  const answers = canonicalAnswers(input, job);
  if (!firstName || !lastName || !email || !phone || !roleTitle || !answers) return null;

  const mobility = answerFor(input.answers, "mobility")?.answer;
  const visa = answerFor(input.answers, "visa")?.answer;
  const keyExpStars = answerFor(input.answers, "keyexp")?.stars;
  const toolStars = answerFor(input.answers, "toolexp")?.stars;
  const project = answerFor(input.answers, "project")?.answer;
  const score = computeChatboxScore({
    mobility: mobility === "Yes" || mobility === "No" || mobility === "Relocation required" ? mobility : undefined,
    needsVisa: visa === "Yes" ? true : visa === "No" ? false : undefined,
    keyExpStars,
    toolStars,
    projectYes: project === "Yes" ? true : project === "No" ? false : undefined,
    hasContactPref: Boolean(compactContactPref(input.contactPref)),
  });

  return {
    id: `cbx_${crypto.randomUUID()}`,
    path: input.path,
    campaignId: job?.id ?? null,
    roleTitle,
    firstName,
    lastName,
    email,
    phone,
    ...(text(input.cvFileName, 180) ? { cvFileName: text(input.cvFileName, 180)! } : {}),
    detected: normalizedDetected(input.detected),
    answers,
    score,
    starRating: deriveStarRating(score.total, DEFAULT_STAR_THRESHOLDS),
    ...(compactContactPref(input.contactPref) ? { contactPref: compactContactPref(input.contactPref) } : {}),
    status: "new",
    createdAt,
  };
}
