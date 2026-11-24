// Live updates from Odoo (Settings > Odoo, admin).
//   POST   { ariaUrl }  new webhook token; ARIA creates the Odoo automation
//                       rule when its Odoo user may (Odoo admin + Automation
//                       Rules app), else returns the steps to do it by hand.
//                       The webhook URL is shown once.
//   DELETE              turn live updates off (and remove the rule ARIA made).
// The campaign sync on page open keeps working either way.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { normalizeOdooBaseUrl, odooHttpAllowed } from "@/lib/integrations/odoo/client";
import { ensureStageWebhook, removeStageWebhook } from "@/lib/integrations/odoo/service";
import { MANUAL_PUSH_STEPS, generateWebhookToken, webhookUrl } from "@/lib/integrations/odoo/webhook";
import { odooFailure, odooJson, publicConnection, readConnection, requireOdooUser, resolveOdoo, saveWebhook } from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PushSchema = z.object({ ariaUrl: z.string().trim().min(1).max(300) }).strict();
export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, PushSchema, { maxBytes: 2_000 });
  if (!body.ok) return body.response;
  const base = normalizeOdooBaseUrl(body.data.ariaUrl, { allowHttp: odooHttpAllowed() });
  if (!base.ok) return odooJson(400, { ok: false, error: `ARIA address: ${base.error.replace(/Odoo/g, "ARIA")}` });

  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;

  const { token, hash } = generateWebhookToken();
  const url = webhookUrl(base.url, token);
  let setup;
  try {
    setup = await ensureStageWebhook(odoo.client, url, odoo.connection.webhook_automation_id);
  } catch (error) {
    return odooFailure(error, "live update set-up");
  }
  try {
    await saveWebhook(auth.ctx.svc, auth.ctx.workspaceId, {
      tokenHash: hash,
      urlBase: base.url,
      automationId: setup.automated ? setup.automationId : null,
    });
    const row = await readConnection(auth.ctx.svc, auth.ctx.workspaceId);
    return odooJson(200, {
      ok: true,
      url,
      automated: setup.automated,
      ...(setup.automated ? {} : { reason: setup.reason, steps: MANUAL_PUSH_STEPS }),
      connection: publicConnection(row),
    });
  } catch {
    return odooJson(500, { ok: false, error: "Live updates could not be saved." });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  let removedInOdoo = false;
  try {
    const odoo = await resolveOdoo(auth.ctx);
    if (odoo.ok && odoo.connection.webhook_automation_id) {
      removedInOdoo = await removeStageWebhook(odoo.client, odoo.connection.webhook_automation_id);
    }
    await saveWebhook(auth.ctx.svc, auth.ctx.workspaceId, null);
    const row = await readConnection(auth.ctx.svc, auth.ctx.workspaceId);
    return odooJson(200, { ok: true, removedInOdoo, connection: publicConnection(row) });
  } catch {
    return odooJson(500, { ok: false, error: "Live updates could not be turned off." });
  }
}
