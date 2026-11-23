/* ============================================================================
   Odoo operations ARIA needs, on top of the JSON-2 client. No database here:
   route handlers own authentication, tenancy and the link tables
   (src/lib/integrations/odoo/authority.ts).
   ========================================================================== */

import { OdooError, type OdooClient } from "./client";
import {
  JOB_FIELDS,
  ODOO_SOURCE_NAME,
  applicantValues,
  jobFromOdoo,
  many2one,
  safeHttpUrl,
  stageFromOdoo,
  validEmail,
  type ApplicationStatus,
  type HandoffCandidate,
  type OdooJob,
  type OdooStage,
} from "./mapping";

/** Oldest Odoo major version with the JSON-2 API. */
export const MIN_ODOO_MAJOR = 19;
const MAX_JOBS = 200;
const MAX_SYNC_IDS = 500;

type Row = Record<string, unknown>;

/** The fields this Odoo instance has on a model (names move between versions). */
export async function modelFields(client: OdooClient, model: string): Promise<Map<string, { type: string; required: boolean }>> {
  const raw = await client.call<Record<string, { type?: unknown; required?: unknown }>>(model, "fields_get", {
    attributes: ["type", "required"],
  });
  const fields = new Map<string, { type: string; required: boolean }>();
  for (const [name, meta] of Object.entries(raw ?? {})) {
    fields.set(name, { type: typeof meta?.type === "string" ? meta.type : "", required: meta?.required === true });
  }
  return fields;
}

function pick(available: Map<string, unknown>, wanted: readonly string[]): string[] {
  return wanted.filter((field) => available.has(field));
}

export interface OdooCheck {
  version: string;
  major: number;
  userName: string;
  recruitment: boolean;
  stages: OdooStage[];
}

/** Everything ARIA needs to trust a connection: a supported version, a valid
 *  key, and the Recruitment app installed. Throws OdooError otherwise. */
export async function checkOdoo(client: OdooClient): Promise<OdooCheck> {
  const { version, major } = await client.version();
  if (major < MIN_ODOO_MAJOR) {
    throw new OdooError(
      "invalid_config",
      `Odoo ${version} has no JSON-2 API. ARIA needs Odoo ${MIN_ODOO_MAJOR} or later.`,
    );
  }
  let context: Row;
  try {
    context = await client.call<Row>("res.users", "context_get");
  } catch (error) {
    if (error instanceof OdooError && error.code === "not_found") {
      throw new OdooError("not_found", "Odoo did not find this database. Check the database name.", error.status);
    }
    throw error;
  }
  const uid = typeof context?.uid === "number" ? context.uid : null;
  if (!uid) throw new OdooError("bad_response", "Odoo did not say which user the API key belongs to.");
  const users = await client.call<Row[]>("res.users", "read", { ids: [uid], fields: ["name"] });
  const userName = typeof users?.[0]?.name === "string" ? (users[0].name as string).slice(0, 200) : `user ${uid}`;
  const installed = await client.call<number>("ir.model", "search_count", { domain: [["model", "=", "hr.applicant"]] });
  const recruitment = installed > 0;
  const stages = recruitment ? await listStages(client) : [];
  return { version, major, userName, recruitment, stages };
}

export async function listStages(client: OdooClient): Promise<OdooStage[]> {
  const rows = await client.call<Row[]>("hr.recruitment.stage", "search_read", {
    domain: [],
    fields: ["name", "sequence", "hired_stage"],
    order: "sequence, id",
    limit: 100,
  });
  return (rows ?? []).map(stageFromOdoo).filter((stage): stage is OdooStage => stage !== null);
}

export interface OdooJobSummary {
  id: number;
  name: string;
  department: string;
  openings: number | null;
  applicationCount: number | null;
}

/** Open job positions (active), most recently changed first. */
export async function listOpenJobs(client: OdooClient): Promise<OdooJobSummary[]> {
  const fields = await modelFields(client, "hr.job");
  const rows = await client.call<Row[]>("hr.job", "search_read", {
    domain: [["active", "=", true]],
    fields: pick(fields, ["name", "department_id", "no_of_recruitment", "application_count"]),
    order: "write_date desc, id desc",
    limit: MAX_JOBS,
  });
  return (rows ?? [])
    .map((row) => {
      const id = typeof row.id === "number" ? row.id : 0;
      const name = typeof row.name === "string" ? row.name.slice(0, 300) : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        department: many2one(row.department_id)?.name ?? "",
        openings: typeof row.no_of_recruitment === "number" ? row.no_of_recruitment : null,
        applicationCount: typeof row.application_count === "number" ? row.application_count : null,
      };
    })
    .filter((job): job is OdooJobSummary => job !== null);
}

/** One job position with what the intake needs (skills, recruiter email). */
export async function readJob(client: OdooClient, jobId: number): Promise<OdooJob | null> {
  const fields = await modelFields(client, "hr.job");
  const rows = await client.call<Row[]>("hr.job", "search_read", {
    domain: [["id", "=", jobId]],
    fields: pick(fields, JOB_FIELDS),
    limit: 1,
  });
  const row = rows?.[0];
  if (!row) return null;
  let skillNames: string[] = [];
  const skillIds = Array.isArray(row.skill_ids) ? row.skill_ids.filter((id): id is number => typeof id === "number").slice(0, 40) : [];
  if (skillIds.length > 0) {
    const skills = await client.call<Row[]>("hr.skill", "read", { ids: skillIds, fields: ["name"] });
    skillNames = (skills ?? []).map((skill) => (typeof skill.name === "string" ? skill.name : "")).filter(Boolean);
  }
  let recruiterEmail = "";
  const recruiter = many2one(row.recruiter_id);
  if (recruiter) {
    // hr.employee (Odoo 20) carries work_email; a res.users recruiter (older) has none to read here.
    const employees = await client
      .call<Row[]>("hr.employee", "read", { ids: [recruiter.id], fields: ["work_email"] })
      .catch(() => [] as Row[]);
    recruiterEmail = validEmail(employees?.[0]?.work_email) ?? "";
  }
  return jobFromOdoo(row, { skillNames, recruiterEmail });
}

/** The "ARIA" UTM source, created on first use. */
export async function ensureAriaSource(client: OdooClient): Promise<number> {
  const found = await client.call<number[]>("utm.source", "search", {
    domain: [["name", "=", ODOO_SOURCE_NAME]],
    limit: 1,
  });
  if (Array.isArray(found) && typeof found[0] === "number") return found[0];
  const created = await client.call<number[]>("utm.source", "create", { vals_list: [{ name: ODOO_SOURCE_NAME }] });
  if (!Array.isArray(created) || typeof created[0] !== "number") throw new OdooError("bad_response", "Odoo did not return the new source.");
  return created[0];
}

/** Odoo's "=ilike" is a SQL ILIKE pattern: "_" and "%" are wildcards, so an
 *  email like jean_dupont@x would also match jeanXdupont@x. Escape them. */
export function ilikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** An application for this person on this job that already exists in Odoo
 *  (archived ones included), matched on email (case-insensitive, literal),
 *  then LinkedIn URL. */
export async function findExistingApplicant(
  client: OdooClient,
  candidate: HandoffCandidate,
  jobId: number,
): Promise<number | null> {
  const email = validEmail(candidate.email);
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  const probes: unknown[][] = [];
  if (email) probes.push([["job_id", "=", jobId], ["email_from", "=ilike", ilikeLiteral(email)]]);
  if (linkedin) probes.push([["job_id", "=", jobId], ["linkedin_profile", "=", linkedin]]);
  for (const domain of probes) {
    const ids = await client.call<number[]>("hr.applicant", "search", {
      domain,
      limit: 1,
      order: "id desc",
      context: { active_test: false },
    });
    if (Array.isArray(ids) && typeof ids[0] === "number") return ids[0];
  }
  return null;
}

export interface CreatedApplicant {
  applicantId: number;
  created: boolean;
}

/** Create the application (or reuse the one Odoo already has for this person
 *  and job). The caller holds the hand-off claim, so this runs once at a time. */
export async function createOrFindApplicant(
  client: OdooClient,
  candidate: HandoffCandidate,
  jobId: number,
): Promise<CreatedApplicant> {
  const existing = await findExistingApplicant(client, candidate, jobId);
  if (existing) return { applicantId: existing, created: false };
  const fields = await modelFields(client, "hr.applicant");
  const required = [...fields].filter(([, meta]) => meta.required).map(([name]) => name);
  if (fields.has("candidate_id") && required.includes("candidate_id")) {
    throw new OdooError("invalid_config", "This Odoo version (separate candidate records) is not supported. Use Odoo 19 or later.");
  }
  const sourceId = fields.has("source_id") ? await ensureAriaSource(client) : null;
  const values = applicantValues(candidate, { jobId, sourceId }, new Set(fields.keys()));
  const created = await client.call<number[]>("hr.applicant", "create", { vals_list: [values] });
  if (!Array.isArray(created) || typeof created[0] !== "number") throw new OdooError("bad_response", "Odoo did not return the new applicant.");
  return { applicantId: created[0], created: true };
}

/** Post an internal note (not an email) on the applicant's chatter. */
export async function postApplicantNote(client: OdooClient, applicantId: number, html: string): Promise<void> {
  await client.call("hr.applicant", "message_post", {
    ids: [applicantId],
    body: html,
    body_is_html: true,
    message_type: "comment",
    subtype_xmlid: "mail.mt_note",
  });
}

export interface ApplicantState {
  applicantId: number;
  jobId: number | null;
  status: ApplicationStatus;
  stage: OdooStage | null;
  refuseReason: string;
}

/** Current Odoo state of the given applicants. An id Odoo no longer has comes
 *  back as status "deleted". */
export async function readApplicantStates(
  client: OdooClient,
  applicantIds: readonly number[],
  stages: readonly OdooStage[],
): Promise<ApplicantState[]> {
  const ids = [...new Set(applicantIds)].filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_SYNC_IDS);
  if (ids.length === 0) return [];
  const fields = await modelFields(client, "hr.applicant");
  const rows = await client.call<Row[]>("hr.applicant", "search_read", {
    domain: [["id", "in", ids]],
    fields: pick(fields, ["stage_id", "job_id", "application_status", "refuse_reason_id", "active"]),
    context: { active_test: false },
    limit: ids.length,
  });
  const byStage = new Map(stages.map((stage) => [stage.id, stage]));
  const found = new Map<number, ApplicantState>();
  for (const row of rows ?? []) {
    const id = typeof row.id === "number" ? row.id : 0;
    if (!id) continue;
    const stageRef = many2one(row.stage_id);
    const rawStatus = typeof row.application_status === "string" ? row.application_status : "";
    const status: ApplicationStatus =
      rawStatus === "hired" || rawStatus === "refused" || rawStatus === "archived" || rawStatus === "ongoing"
        ? rawStatus
        : row.active === false
          ? "archived"
          : "ongoing";
    found.set(id, {
      applicantId: id,
      jobId: many2one(row.job_id)?.id ?? null,
      status,
      stage: stageRef ? (byStage.get(stageRef.id) ?? { id: stageRef.id, name: stageRef.name, sequence: 0, hiredStage: false }) : null,
      refuseReason: many2one(row.refuse_reason_id)?.name ?? "",
    });
  }
  return ids.map(
    (id) => found.get(id) ?? { applicantId: id, jobId: null, status: "deleted" as const, stage: null, refuseReason: "" },
  );
}
