/* ============================================================================
   Live updates from Odoo. Odoo's "send webhook notification" action cannot
   sign its calls, so the URL carries a random token (only its SHA-256 is
   stored). A call is only a ping naming an applicant: ARIA reads that
   applicant back from Odoo with its own key, so a forged or replayed call can
   at most make ARIA re-read the truth.
   ========================================================================== */

import { createHash, randomBytes } from "node:crypto";
import {
  applicantLinkByApplicant,
  clientForConnection,
  touchWebhook,
  type ConnectionRow,
  type Svc,
} from "./authority";
import { applyApplicantUpdates, readLinkedApplicants } from "./sync";
import type { StageSyncChange } from "./mapping";
import { AUTOMATION_NAME } from "./service";

export const WEBHOOK_PATH = "/api/webhooks/odoo/";

/** What IT does in Odoo when ARIA may not create the rule itself. */
export const MANUAL_PUSH_STEPS = [
  "In Odoo, install the Automation Rules app (Apps > Automation Rules) if it is not installed.",
  "Turn on developer mode, then Settings > Technical > Automation Rules > New.",
  `Name "${AUTOMATION_NAME}", model Applicant, trigger "On create and edit", trigger fields: Stage, Active, Refuse Reason.`,
  "Apply on: Source = ARIA.",
  "Action: Send Webhook Notification, URL = the address below. No fields are needed.",
  "Save. Moving an ARIA applicant to another stage now updates ARIA within seconds.",
];
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateWebhookToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashWebhookToken(token) };
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validWebhookToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function webhookUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${WEBHOOK_PATH}${token}`;
}

/** The applicant id an Odoo webhook call names, or null. */
export function applicantIdFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record._model !== "hr.applicant") return null;
  const id = record._id;
  return typeof id === "number" && Number.isInteger(id) && id > 0 && id < 2 ** 31 ? id : null;
}

export type WebhookOutcome =
  | { kind: "ignored"; reason: "not_linked" | "credential_unavailable" }
  | { kind: "synced"; changes: StageSyncChange[] };

/** Handle one Odoo ping for `connection`'s workspace. */
export async function processOdooWebhook(svc: Svc, connection: ConnectionRow, applicantId: number): Promise<WebhookOutcome> {
  const workspaceId = connection.workspace_id;
  await touchWebhook(svc, workspaceId);
  const link = await applicantLinkByApplicant(svc, workspaceId, applicantId);
  if (!link || link.applicant_id === null) return { kind: "ignored", reason: "not_linked" };
  const resolved = clientForConnection(connection);
  if (!resolved.ok) return { kind: "ignored", reason: "credential_unavailable" };
  const applicants = await readLinkedApplicants(svc, workspaceId, resolved, [{ ...link, applicant_id: link.applicant_id }]);
  return { kind: "synced", changes: await applyApplicantUpdates(svc, workspaceId, applicants) };
}
