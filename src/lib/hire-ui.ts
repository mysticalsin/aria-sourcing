import { redactEmail, redactSecrets } from "@/lib/log-redact";

/** Visible copy for a hire that reached the ERP. */
export const ODOO_SYNCED_LABEL = "Odoo synced";
export const SMART_SYNCED_LABEL = "SMART synced";
/** Visible copy when neither Odoo nor SMART is configured. */
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

export type HireUiOutcome =
  | { ok: true; outcome: "synced"; erp: "odoo" | "smart"; label: string; linkedIn: true }
  | { ok: true; outcome: "skipped"; erp: "skipped"; label: string; linkedIn: true }
  | { ok: false; outcome: "error"; label: string };

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
  const record = body as { erp?: unknown; linkedIn?: unknown };
  if (record.linkedIn !== true) {
    return { ok: false, outcome: "error", label: "LinkedIn sourcing did not complete." };
  }
  if (record.erp === "odoo") {
    return { ok: true, outcome: "synced", erp: "odoo", label: ODOO_SYNCED_LABEL, linkedIn: true };
  }
  if (record.erp === "smart") {
    return { ok: true, outcome: "synced", erp: "smart", label: SMART_SYNCED_LABEL, linkedIn: true };
  }
  if (record.erp === "skipped") {
    return { ok: true, outcome: "skipped", erp: "skipped", label: ERP_SKIPPED_LABEL, linkedIn: true };
  }
  return { ok: false, outcome: "error", label: HIRE_ERROR_FALLBACK };
}

/** Local checklist advances only after the hire route accepts the applicant, including an ERP skip. */
export function localHireCompletes(outcome: HireUiOutcome): outcome is Extract<HireUiOutcome, { ok: true }> {
  return outcome.ok === true && outcome.linkedIn === true;
}

export function hireStatusText(outcome: HireUiOutcome): string {
  if (outcome.ok && outcome.outcome === "skipped") {
    return `${outcome.label}. ${LINKEDIN_COMPLETED_LABEL}`;
  }
  return outcome.label;
}

/**
 * Ask the server to record the hire. The browser never talks to Odoo, SMART,
 * or LinkedIn; it only reads the route's synced, skipped, or error result.
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
