import { redactEmail, redactSecrets } from "@/lib/log-redact";
import { vacancyClosedFromSteps, type HireStepFact, type HireTrail } from "@/lib/hire-trail";

/** Visible copy for a hire that reached a connector. */
export const ODOO_SYNCED_LABEL = "Odoo synced";
export const SMART_SYNCED_LABEL = "SMART synced";
export const API_SYNCED_LABEL = "API synced";
export const MCP_SYNCED_LABEL = "MCP synced";
/** Visible copy when no hire connector is configured. */
export const ERP_SKIPPED_LABEL = "ERP skipped (no connector configured)";
/** LinkedIn sourcing still finishes on the skipped-ERP path. */
export const LINKEDIN_COMPLETED_LABEL = "LinkedIn sourcing completed.";

const HIRE_ERROR_FALLBACK = "Hire request failed.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,80}$/;

export type HireRequest = {
  idempotencyKey: string;
  job: { name: string; department?: string };
  applicant: { name: string; email?: string };
  stage: "Hired";
};

type HireFacts = {
  steps: HireStepFact[];
  vacancyClosed: boolean;
  /** Filled by the drawer from the operator and the response. The route does not add it. */
  trail?: HireTrail;
};

export type HireUiOutcome =
  | ({ ok: true; outcome: "synced"; erp: "odoo" | "smart" | "api" | "mcp"; label: string; linkedIn: true } & HireFacts)
  | ({ ok: true; outcome: "skipped"; erp: "skipped"; label: string; linkedIn: true } & HireFacts)
  | { ok: false; outcome: "error"; label: string };

function readHireSteps(body: object): HireStepFact[] {
  const steps = (body as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const facts: HireStepFact[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const record = step as {
      action?: unknown;
      ok?: unknown;
      id?: unknown;
      model?: unknown;
      skipped?: unknown;
      vacancyClosed?: unknown;
    };
    if (typeof record.action !== "string" || !record.action) continue;
    facts.push({
      action: record.action,
      ok: record.ok === true,
      id: typeof record.id === "string" && record.id ? record.id : undefined,
      model: typeof record.model === "string" ? record.model : undefined,
      skipped: record.skipped === true ? true : undefined,
      vacancyClosed: record.vacancyClosed === true ? true : undefined,
    });
  }
  return facts;
}

export function hireIdempotencyKey(candidateId: string): string {
  const cleaned = candidateId
    .replace(/[^A-Za-z0-9._:-]/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 74);
  const key = `hire.${cleaned || "candidate"}`.slice(0, 80);
  return IDEMPOTENCY_KEY.test(key) ? key : "hire.candidate";
}

/** Body for POST /api/hire. Email is omitted unless it is a plain address. */
export function buildHireRequest(input: {
  candidateId: string;
  candidateName: string;
  email?: string;
  jobName: string;
  department?: string;
}): HireRequest {
  const email = input.email?.trim() ?? "";
  const department = input.department?.trim() ?? "";
  const jobName = input.jobName.trim().slice(0, 200) || "Open role";
  const applicantName = input.candidateName.trim().slice(0, 200) || "Candidate";
  return {
    idempotencyKey: hireIdempotencyKey(input.candidateId),
    job: department ? { name: jobName, department: department.slice(0, 120) } : { name: jobName },
    applicant: EMAIL.test(email) && email.length <= 200 ? { name: applicantName, email } : { name: applicantName },
    stage: "Hired",
  };
}

/** Scrub credentials and emails out of text the recruiter will see. */
export function scrubHireError(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) return HIRE_ERROR_FALLBACK;
  const scrubbed = redactSecrets(redactEmail(message)).replace(/\s+/g, " ").trim().slice(0, 200);
  return scrubbed || HIRE_ERROR_FALLBACK;
}

export function interpretHireBody(body: unknown): HireUiOutcome {
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    return { ok: false, outcome: "error", label: scrubHireError(error) };
  }
  const record = body as { erp?: unknown; linkedIn?: unknown; vacancyClosed?: unknown };
  if (record.linkedIn !== true) {
    return { ok: false, outcome: "error", label: "LinkedIn sourcing did not complete." };
  }
  const steps = readHireSteps(record);
  const vacancyClosed = vacancyClosedFromSteps(steps, record.vacancyClosed === true);
  if (record.erp === "odoo") {
    return { ok: true, outcome: "synced", erp: "odoo", label: ODOO_SYNCED_LABEL, linkedIn: true, steps, vacancyClosed };
  }
  if (record.erp === "smart") {
    return { ok: true, outcome: "synced", erp: "smart", label: SMART_SYNCED_LABEL, linkedIn: true, steps, vacancyClosed };
  }
  if (record.erp === "api") {
    return { ok: true, outcome: "synced", erp: "api", label: API_SYNCED_LABEL, linkedIn: true, steps, vacancyClosed };
  }
  if (record.erp === "mcp") {
    return { ok: true, outcome: "synced", erp: "mcp", label: MCP_SYNCED_LABEL, linkedIn: true, steps, vacancyClosed };
  }
  if (record.erp === "skipped") {
    return { ok: true, outcome: "skipped", erp: "skipped", label: ERP_SKIPPED_LABEL, linkedIn: true, steps, vacancyClosed };
  }
  return { ok: false, outcome: "error", label: HIRE_ERROR_FALLBACK };
}

/** Local checklist advances only after the hire route accepts the applicant, including an ERP skip. */
export function localHireCompletes(outcome: HireUiOutcome): outcome is Extract<HireUiOutcome, { ok: true }> {
  return outcome.ok === true && outcome.linkedIn === true;
}

/** One hire fills that vacancy and leaves every other vacancy unchanged. */
export function closeMatchingVacancy<T extends { id: string; status: string }>(
  vacancies: readonly T[],
  hiredVacancyId: string | null,
): T[] {
  if (!hiredVacancyId) return vacancies.map((vacancy) => ({ ...vacancy }));
  return vacancies.map((vacancy) =>
    vacancy.id === hiredVacancyId ? { ...vacancy, status: "Filled" } : { ...vacancy },
  );
}

export function hireStatusText(outcome: HireUiOutcome): string {
  if (outcome.ok && outcome.outcome === "skipped") {
    return `${outcome.label}. ${LINKEDIN_COMPLETED_LABEL}`;
  }
  return outcome.label;
}

/**
 * Ask the server to record the hire. The browser never talks to Odoo, SMART,
 * a generic API, MCP, or LinkedIn; it only reads the route's synced, skipped, or error result.
 */
export async function postCandidateHire(
  request: HireRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<HireUiOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/hire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    return {
      ok: false,
      outcome: "error",
      label: scrubHireError(err instanceof Error ? err.message : undefined),
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, outcome: "error", label: HIRE_ERROR_FALLBACK };
  }
  const outcome = interpretHireBody(body);
  if (!response.ok && outcome.ok) {
    return { ok: false, outcome: "error", label: HIRE_ERROR_FALLBACK };
  }
  return outcome;
}
