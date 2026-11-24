/* ============================================================================
   Odoo operations ARIA needs, on top of the JSON-2 client. No database here:
   route handlers own authentication, tenancy and the link tables
   (src/lib/integrations/odoo/authority.ts).
   ========================================================================== */

import { OdooError, isOdooError, type OdooClient } from "./client";
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
    if (isOdooError(error) && error.code === "not_found") {
      throw new OdooError("not_found", "Odoo did not find this database. Check the database name.", error.status);
    }
    throw error;
  }
  const uid = typeof context?.uid === "number" ? context.uid : null;
  if (!uid) throw new OdooError("bad_response", "Odoo did not say which user the API key belongs to.");
  const users = await client.call<Row[]>("res.users", "read", { ids: [uid], fields: ["name"] });
  const userName = typeof users?.[0]?.name === "string" ? (users[0].name as string).slice(0, 200) : `user ${uid}`;
  // Reading the stages proves both that Recruitment is installed (404 when
  // the model does not exist) and that this user may read it (403). A
  // non-admin user cannot read ir.model, so it is not used here.
  let stages: OdooStage[] = [];
  let recruitment = true;
  try {
    stages = await listStages(client);
  } catch (error) {
    if (isOdooError(error) && error.code === "not_found") recruitment = false;
    else if (isOdooError(error) && error.code === "forbidden") {
      throw new OdooError("forbidden", `The Odoo user ${userName} cannot read Recruitment. Give it Recruitment access "Officer".`, error.status, error.odooName);
    } else throw error;
  }
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

/* ---- Erasure ---------------------------------------------------------------- */

export interface ApplicantErasure {
  outcome: "deleted" | "kept_hired" | "already_gone";
  contact: "deleted" | "kept" | "none";
  /** An entry was written in Odoo's own GDPR log (privacy.log). */
  logged: boolean;
  detail: string;
}

/** "Jane Doe" -> "J*** D***", "jane@x.com" -> "j***@x.com": what Odoo's own
 *  privacy log keeps about an erased person. */
export function maskForPrivacyLog(name: string, email: string): { name: string; email: string } {
  const maskedName = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}***`)
    .join(" ")
    .slice(0, 120);
  const at = email.indexOf("@");
  const maskedEmail = at > 0 ? `${email[0]}***${email.slice(at)}`.slice(0, 200) : "";
  return { name: maskedName || "***", email: maskedEmail || "***" };
}

function odooTime(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Erase the applicant ARIA created in Odoo, for an ARIA candidate erasure.
 * - Hired: kept. The application and the employee record follow HR retention
 *   rules ARIA does not know; HR decides in Odoo.
 * - Otherwise the applicant is deleted (Odoo deletes its notes and
 *   attachments with it). Its contact (res.partner) is deleted only when Odoo
 *   created it for this application (same author, same minute) and nothing
 *   else uses it; a contact that existed before is someone else's record.
 * - An entry is written in Odoo's privacy log when the user may do so.
 */
export async function eraseApplicant(client: OdooClient, applicantId: number, reference: string): Promise<ApplicantErasure> {
  const fields = await modelFields(client, "hr.applicant");
  const rows = await client.call<Row[]>("hr.applicant", "search_read", {
    domain: [["id", "=", applicantId]],
    fields: pick(fields, ["application_status", "partner_id", "employee_id", "emp_id", "partner_name", "email_from", "create_date", "create_uid"]),
    context: { active_test: false },
    limit: 1,
  });
  const row = rows?.[0];
  if (!row) return { outcome: "already_gone", contact: "none", logged: false, detail: "The applicant was already deleted in Odoo." };
  if (row.application_status === "hired" || many2one(row.employee_id) || many2one(row.emp_id)) {
    return {
      outcome: "kept_hired",
      contact: "none",
      logged: false,
      detail: "Hired in Odoo: the application and the employee record follow HR retention. HR erases them in Odoo if it applies.",
    };
  }

  const partner = many2one(row.partner_id);
  await client.call("hr.applicant", "unlink", { ids: [applicantId] });
  let contact: ApplicantErasure["contact"] = "none";
  let contactNote = "";
  if (partner) {
    contact = "kept";
    try {
      const [info] = await client.call<Row[]>("res.partner", "search_read", {
        domain: [["id", "=", partner.id]],
        fields: ["create_date", "create_uid", "user_ids"],
        context: { active_test: false },
        limit: 1,
      });
      const others = await client.call<number>("hr.applicant", "search_count", {
        domain: [["partner_id", "=", partner.id]],
        context: { active_test: false },
      });
      const createdWith =
        info &&
        many2one(info.create_uid)?.id === many2one(row.create_uid)?.id &&
        Math.abs((odooTime(info.create_date) ?? 0) - (odooTime(row.create_date) ?? Number.NaN)) <= 120_000;
      const users = Array.isArray(info?.user_ids) ? info.user_ids.length : 0;
      if (!info) contactNote = " Its contact was already gone.";
      else if (!createdWith) contactNote = " Its contact existed before the application and was kept.";
      else if (others > 0 || users > 0) contactNote = " Its contact is used elsewhere in Odoo and was kept.";
      else {
        await client.call("res.partner", "unlink", { ids: [partner.id] });
        contact = "deleted";
        contactNote = " Its contact, created for this application, was deleted too.";
      }
    } catch (error) {
      contactNote = ` Its contact was kept (${isOdooError(error) ? error.message : "Odoo refused"}).`;
    }
  }

  let logged = false;
  try {
    const masked = maskForPrivacyLog(typeof row.partner_name === "string" ? row.partner_name : "", typeof row.email_from === "string" ? row.email_from : "");
    await client.call("privacy.log", "create", {
      vals_list: [
        {
          anonymized_name: masked.name,
          anonymized_email: masked.email,
          execution_details: `Deleted hr.applicant #${applicantId}${contact === "deleted" ? ` and res.partner #${partner!.id}` : ""}.`,
          records_description: `Recruitment applicant created by ARIA (${reference}).`,
          additional_note: "Erasure requested in ARIA.",
        },
      ],
    });
    logged = true;
  } catch {
    // Writing Odoo's privacy log needs extra rights; ARIA keeps its own receipt.
  }
  return { outcome: "deleted", contact, logged, detail: `Applicant deleted in Odoo with its notes and attachments.${contactNote}` };
}

/* ---- Live updates (Odoo automation rule -> ARIA webhook) ------------------- */

export const AUTOMATION_NAME = "ARIA: applicant changed";

export type WebhookSetup =
  | { automated: true; automationId: number }
  | { automated: false; reason: string };

/**
 * Create (or point at a new URL) the Odoo automation rule that calls ARIA when
 * an applicant from source "ARIA" changes stage, is archived or refused.
 * Needs Odoo's Automation Rules app and an Odoo admin key; otherwise the
 * caller shows the manual steps (docs/odoo.md).
 */
export async function ensureStageWebhook(client: OdooClient, url: string, existingId: number | null): Promise<WebhookSetup> {
  try {
    if (existingId) {
      const [rule] = await client.call<Row[]>("base.automation", "search_read", {
        domain: [["id", "=", existingId]],
        fields: ["action_server_ids"],
        context: { active_test: false },
        limit: 1,
      });
      const actions = Array.isArray(rule?.action_server_ids) ? (rule.action_server_ids as number[]) : [];
      if (rule && actions.length > 0) {
        await client.call("ir.actions.server", "write", { ids: actions, vals: { webhook_url: url } });
        await client.call("base.automation", "write", { ids: [existingId], vals: { active: true } });
        return { automated: true, automationId: existingId };
      }
    }
    const [modelId] = await client.call<number[]>("ir.model", "search", { domain: [["model", "=", "hr.applicant"]], limit: 1 });
    if (!modelId) return { automated: false, reason: "Recruitment is not installed in this Odoo." };
    const triggerFields = await client.call<number[]>("ir.model.fields", "search", {
      domain: [["model", "=", "hr.applicant"], ["name", "in", ["stage_id", "active", "refuse_reason_id"]]],
    });
    const created = await client.call<number[]>("base.automation", "create", {
      vals_list: [
        {
          name: AUTOMATION_NAME,
          model_id: modelId,
          trigger: "on_create_or_write",
          trigger_field_ids: [[6, 0, triggerFields]],
          filter_domain: "[('source_id.name', '=', 'ARIA')]",
          action_server_ids: [[0, 0, { name: "Notify ARIA", state: "webhook", model_id: modelId, webhook_url: url }]],
        },
      ],
    });
    if (!Array.isArray(created) || typeof created[0] !== "number") return { automated: false, reason: "Odoo did not return the automation rule." };
    return { automated: true, automationId: created[0] };
  } catch (error) {
    if (isOdooError(error) && error.code === "not_found") {
      return { automated: false, reason: "Odoo's Automation Rules app is not installed." };
    }
    if (isOdooError(error) && error.code === "forbidden") {
      return { automated: false, reason: "The Odoo user ARIA connects with may not create automation rules (Odoo admin only)." };
    }
    throw error;
  }
}

/** Remove the automation rule ARIA created. Best effort: false when Odoo refused. */
export async function removeStageWebhook(client: OdooClient, automationId: number): Promise<boolean> {
  try {
    await client.call("base.automation", "unlink", { ids: [automationId] });
    return true;
  } catch {
    return false;
  }
}
