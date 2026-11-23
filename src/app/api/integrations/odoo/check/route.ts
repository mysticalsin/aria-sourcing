// POST admin: test the stored Odoo connection now and list Odoo's recruitment
// stages with the ARIA stage each one maps to (Settings > Odoo).

import type { NextRequest } from "next/server";
import { defaultStageTarget, stageTarget } from "@/lib/integrations/odoo/mapping";
import { checkOdoo } from "@/lib/integrations/odoo/service";
import { isOdooError } from "@/lib/integrations/odoo/client";
import { odooFailure, odooJson, recordConnectionCheck, requireOdooUser, resolveOdoo } from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;
  try {
    const check = await checkOdoo(odoo.client);
    await recordConnectionCheck(auth.ctx.svc, auth.ctx.workspaceId, check.recruitment ? null : "Recruitment app not installed.");
    return odooJson(200, {
      ok: true,
      version: check.version,
      userName: check.userName,
      recruitment: check.recruitment,
      stages: check.stages.map((stage) => ({
        ...stage,
        target: stageTarget(stage, check.stages, odoo.stageMap),
        defaultTarget: defaultStageTarget(stage, check.stages),
      })),
    });
  } catch (error) {
    await recordConnectionCheck(auth.ctx.svc, auth.ctx.workspaceId, isOdooError(error) ? error.message : "Connection test failed.").catch(() => undefined);
    return odooFailure(error, "connection test");
  }
}
