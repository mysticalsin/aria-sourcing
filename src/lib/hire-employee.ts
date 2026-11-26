import { CANDIDATE_STAGES, type CandidateStage } from "./types";

/**
 * Create the Odoo hr.employee row for an applicant who has just been hired.
 * Callers pass a client. A missing client means Odoo is not configured, and
 * nothing is called. Tests use the in-memory fake and never open a socket.
 */

/** The hired stage this branch already names, taken from the stage list. */
export function namedHiredStage(): CandidateStage | null {
  return CANDIDATE_STAGES.find((stage) => stage === "Hired") ?? null;
}

/**
 * Stage writer entry. Creates an employee only when the new stage is the
 * hired stage and a client was injected. Any other stage, or no client,
 * leaves the client untouched.
 */
export async function createEmployeeForStage(
  stage: CandidateStage,
  applicant: { applicantId: string; name: string },
  client: OdooEmployeeClient | null,
): Promise<{ employeeId: number | null }> {
  const hiredStage = namedHiredStage();
  if (!hiredStage || stage !== hiredStage || client == null) return { employeeId: null };
  const result = await createEmployeeWhenHired(client, {
    applicantId: applicant.applicantId,
    name: applicant.name,
    hired: true,
  });
  if (!result.ok) return { employeeId: null };
  return { employeeId: result.employee.id };
}

export interface HiredApplicant {
  applicantId: string;
  name: string;
  hired: boolean;
}

export interface OdooEmployeeRecord {
  model: "hr.employee";
  id: number;
  name: string;
  applicantId: string;
}

export interface OdooEmployeeClient {
  findByApplicant(applicantId: string): Promise<OdooEmployeeRecord | null>;
  create(input: { name: string; applicantId: string }): Promise<OdooEmployeeRecord>;
}

export type HireEmployeeResult =
  | { ok: true; created: boolean; employee: OdooEmployeeRecord }
  | { ok: false; error: string };

function employeeId(record: OdooEmployeeRecord | null | undefined): number | null {
  if (!record || record.model !== "hr.employee") return null;
  if (!Number.isSafeInteger(record.id) || record.id <= 0) return null;
  return record.id;
}

/**
 * One employee per hired applicant. A person who is not hired is refused
 * before the client is called. A second hire returns the row already stored.
 */
export async function createEmployeeWhenHired(
  client: OdooEmployeeClient,
  applicant: HiredApplicant,
): Promise<HireEmployeeResult> {
  const applicantId = applicant.applicantId.trim();
  const name = applicant.name.trim();
  if (!applicantId) return { ok: false, error: "applicant id is required" };
  if (!name) return { ok: false, error: "employee name is required" };
  if (!applicant.hired) return { ok: false, error: "applicant is not hired" };

  let existing: OdooEmployeeRecord | null;
  try {
    existing = await client.findByApplicant(applicantId);
  } catch {
    return { ok: false, error: "odoo employee lookup failed" };
  }
  const existingId = employeeId(existing);
  if (existing && existingId == null) return { ok: false, error: "odoo employee lookup returned no record" };
  if (existing && existing.applicantId !== applicantId) {
    return { ok: false, error: "odoo employee is not linked to the applicant" };
  }
  if (existing && existingId != null) return { ok: true, created: false, employee: existing };

  let created: OdooEmployeeRecord;
  try {
    created = await client.create({ name, applicantId });
  } catch {
    return { ok: false, error: "odoo employee create failed" };
  }
  if (employeeId(created) == null) return { ok: false, error: "odoo employee create returned no record" };
  if (created.applicantId !== applicantId) {
    return { ok: false, error: "odoo employee is not linked to the applicant" };
  }
  return { ok: true, created: true, employee: created };
}

/** In-memory hr.employee table. No network. */
export class FakeOdooEmployeeClient implements OdooEmployeeClient {
  readonly employees: OdooEmployeeRecord[] = [];
  createCount = 0;
  findCount = 0;
  private nextId = 1;

  async findByApplicant(applicantId: string): Promise<OdooEmployeeRecord | null> {
    this.findCount += 1;
    return this.employees.find((row) => row.applicantId === applicantId) ?? null;
  }

  async create(input: { name: string; applicantId: string }): Promise<OdooEmployeeRecord> {
    this.createCount += 1;
    const row: OdooEmployeeRecord = {
      model: "hr.employee",
      id: this.nextId,
      name: input.name,
      applicantId: input.applicantId,
    };
    this.nextId += 1;
    this.employees.push(row);
    return row;
  }
}

/**
 * One hr.employee table for the candidate drawer and the bulk hire control.
 * A second hire of the same applicant finds the row already stored. No network.
 */
export const inMemoryEmployeeClient = new FakeOdooEmployeeClient();
