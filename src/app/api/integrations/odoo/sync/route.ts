// POST { campaignId? }: read the Odoo state of the handed-off candidates (of
// one campaign) and apply it to the workspace on the server, once (same path
// as the Odoo webhook). Answers with Odoo's state, what moved, and the
// server's stage of each candidate, so a stale browser knows to reload.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { listApplicantLinks, odooFailure, odooJson, requireOdooUser, resolveOdoo, type ApplicantLinkRow } from "@/lib/integrations/odoo/authority";
import { applyApplicantUpdates, readLinkedApplicants, workspaceStages } from "@/lib/integrations/odoo/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SyncSchema = z.object({ campaignId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/).optional() }).strict();

export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "source", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, SyncSchema, { maxBytes: 1_000 });
  if (!body.ok) return body.response;
  const { svc, workspaceId } = auth.ctx;

  let links;
  try {
    links = (await listApplicantLinks(svc, workspaceId, body.data.campaignId)).filter(
      (row): row is ApplicantLinkRow & { applicant_id: number } => row.state === "linked" && row.applicant_id !== null,
    );
  } catch {
    return odooJson(503, { ok: false, error: "Odoo links could not be read." });
  }
  if (links.length === 0) return odooJson(200, { ok: true, applicants: [], changes: [], workspaceStages: {} });

  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;
  let applicants;
  try {
    applicants = await readLinkedApplicants(svc, workspaceId, odoo, links);
  } catch (error) {
    return odooFailure(error, "sync");
  }
  try {
    const changes = await applyApplicantUpdates(svc, workspaceId, applicants);
    const stages = await workspaceStages(svc, workspaceId, applicants.map((a) => a.candidateId));
    return odooJson(200, { ok: true, applicants, changes, workspaceStages: stages });
  } catch {
    return odooJson(503, { ok: false, error: "Odoo's stages could not be saved in the workspace. Try again." });
  }
}
