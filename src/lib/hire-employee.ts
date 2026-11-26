/**
 * Create the Odoo hr.employee row for an applicant who has just been hired.
 * A stage change on its own does not do this. Callers pass a client; tests use
 * the in-memory fake and never open a socket.
 */

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
