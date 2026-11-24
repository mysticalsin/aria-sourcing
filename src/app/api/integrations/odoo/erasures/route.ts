// Odoo side of candidate erasures (Settings > Odoo, admin).
//   GET                    every Odoo erasure receipt of the workspace
//   POST { candidateId }   retry a pending or failed one
// Erasures start from the ARIA candidate erasure (/api/admin/candidates/erasure).

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { listOdooErasures, odooErasureFor, odooJson, requireOdooUser } from "@/lib/integrations/odoo/authority";
import { eraseFromOdoo } from "@/lib/integrations/odoo/erasure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RetrySchema = z.object({ candidateId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/) }).strict();

function view(row: { candidate_id: string; applicant_id: number; status: string; detail: string | null; attempts: number; updated_at: string; completed_at: string | null }) {
  return {
    candidateId: row.candidate_id,
    applicantId: row.applicant_id,
    status: row.status,
    detail: row.detail,
    attempts: row.attempts,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings" });
  if (!auth.ok) return auth.response;
  try {
    return odooJson(200, { ok: true, erasures: (await listOdooErasures(auth.ctx.svc, auth.ctx.workspaceId)).map(view) });
  } catch {
    return odooJson(503, { ok: false, error: "Odoo erasures could not be read." });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, RetrySchema, { maxBytes: 1_000 });
  if (!body.ok) return body.response;
  try {
    const existing = await odooErasureFor(auth.ctx.svc, auth.ctx.workspaceId, body.data.candidateId);
    if (!existing) return odooJson(404, { ok: false, error: "No Odoo erasure for this candidate." });
    if (existing.status === "deleted" || existing.status === "kept_hired") return odooJson(200, { ok: true, erasure: view(existing) });
    await eraseFromOdoo(auth.ctx.svc, auth.ctx.workspaceId, body.data.candidateId, existing.request_id);
    const row = await odooErasureFor(auth.ctx.svc, auth.ctx.workspaceId, body.data.candidateId);
    return odooJson(200, { ok: true, erasure: row ? view(row) : null });
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo erasure could not be retried." });
  }
}
