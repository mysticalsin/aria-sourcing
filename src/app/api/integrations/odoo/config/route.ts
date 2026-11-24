// Odoo connection of the workspace (Settings > Odoo).
//   GET     any member: is Odoo connected, to what (never the API key)
//   PUT     admin: { baseUrl, publicUrl?, database, apiKey?, stageMap? }
//           tests the connection against Odoo first; saves only if it works.
//           apiKey may be omitted to keep the stored one.
//   DELETE  admin: disconnect and forget every campaign/applicant link (and
//           remove the live-update rule ARIA created in Odoo, if any).

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { encryptSecret, encryptionRequiredButMissing, decryptSecret } from "@/lib/crypto-secrets";
import { createOdooClient, normalizeOdooBaseUrl, odooHttpAllowed, validOdooDatabase } from "@/lib/integrations/odoo/client";
import { StageMapSchema } from "@/lib/integrations/odoo/mapping";
import { checkOdoo, removeStageWebhook } from "@/lib/integrations/odoo/service";
import {
  clearLinks,
  odooFailure,
  odooJson,
  publicConnection,
  readConnection,
  requireOdooUser,
  resolveOdoo,
} from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConfigSchema = z
  .object({
    baseUrl: z.string().trim().min(1).max(300),
    publicUrl: z.string().trim().max(300).optional(),
    database: z.string().trim().min(1).max(63),
    apiKey: z.string().trim().max(200).optional(),
    stageMap: StageMapSchema.optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "view" });
  if (!auth.ok) return auth.response;
  try {
    const row = await readConnection(auth.ctx.svc, auth.ctx.workspaceId);
    return odooJson(200, { ok: true, connection: publicConnection(row), httpAllowed: odooHttpAllowed() });
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, ConfigSchema, { maxBytes: 16_000 });
  if (!body.ok) return body.response;
  const { svc, workspaceId, userId } = auth.ctx;

  const allowHttp = odooHttpAllowed();
  const base = normalizeOdooBaseUrl(body.data.baseUrl, { allowHttp });
  if (!base.ok) return odooJson(400, { ok: false, error: base.error });
  let publicUrl: string | null = null;
  if (body.data.publicUrl) {
    const normalized = normalizeOdooBaseUrl(body.data.publicUrl, { allowHttp: true });
    if (!normalized.ok) return odooJson(400, { ok: false, error: `Public address: ${normalized.error}` });
    publicUrl = normalized.url === base.url ? null : normalized.url;
  }
  if (!validOdooDatabase(body.data.database)) {
    return odooJson(400, { ok: false, error: "The Odoo database name may contain letters, digits, '_', '.' and '-' only." });
  }

  let existing;
  try {
    existing = await readConnection(svc, workspaceId);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  const sameInstance = existing !== null && existing.base_url === base.url && existing.database_name === body.data.database;
  const newKey = body.data.apiKey?.trim() ?? "";
  // The stored key only ever goes back to the instance it was entered for.
  const apiKey = newKey || (sameInstance ? decryptSecret(existing!.api_key_secret) : "");
  if (!apiKey) {
    return odooJson(400, {
      ok: false,
      error: existing && !sameInstance ? "Enter the API key of this Odoo (the address or database changed)." : "Enter the Odoo API key.",
    });
  }
  if (newKey && encryptionRequiredButMissing()) {
    return odooJson(503, { ok: false, error: "Server encryption key is not configured." });
  }

  let check;
  try {
    const client = createOdooClient({ baseUrl: base.url, database: body.data.database, apiKey });
    check = await checkOdoo(client);
  } catch (error) {
    return odooFailure(error, "connection test");
  }
  if (!check.recruitment) {
    return odooJson(400, { ok: false, error: "The Recruitment app is not installed in this Odoo database. Install it, then try again." });
  }

  try {
    if (existing && !sameInstance) await clearLinks(svc, workspaceId);
    const now = new Date().toISOString();
    const { error } = await svc.from("odoo_connections").upsert(
      {
        workspace_id: workspaceId,
        base_url: base.url,
        public_url: publicUrl,
        database_name: body.data.database,
        api_key_secret: newKey ? encryptSecret(newKey) : existing!.api_key_secret,
        api_key_last4: newKey ? newKey.slice(-4) : existing!.api_key_last4,
        odoo_version: check.version,
        odoo_user_name: check.userName,
        stage_map: body.data.stageMap ?? (sameInstance ? existing!.stage_map : {}),
        config_revision: existing ? existing.config_revision + 1 : 1,
        updated_by: userId,
        updated_at: now,
        last_checked_at: now,
        last_error: null,
        // Live updates belong to the old instance's automation rule.
        ...(existing && !sameInstance
          ? { webhook_token_hash: null, webhook_url_base: null, webhook_automation_id: null, webhook_created_at: null, last_webhook_at: null }
          : {}),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error("odoo_connections upsert failed");
    const row = await readConnection(svc, workspaceId);
    return odooJson(200, { ok: true, connection: publicConnection(row), stages: check.stages, linksCleared: Boolean(existing && !sameInstance) });
  } catch {
    return odooJson(500, { ok: false, error: "The Odoo connection could not be saved." });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "manage_settings", mutation: true });
  if (!auth.ok) return auth.response;
  const { svc, workspaceId } = auth.ctx;
  try {
    // Best effort: remove the automation rule ARIA created in Odoo.
    const odoo = await resolveOdoo(auth.ctx).catch(() => null);
    if (odoo?.ok && odoo.connection.webhook_automation_id) {
      await removeStageWebhook(odoo.client, odoo.connection.webhook_automation_id);
    }
    await clearLinks(svc, workspaceId);
    const { error } = await svc.from("odoo_connections").delete().eq("workspace_id", workspaceId);
    if (error) throw new Error("odoo_connections delete failed");
    return odooJson(200, { ok: true, connection: publicConnection(null) });
  } catch {
    return odooJson(500, { ok: false, error: "Odoo could not be disconnected." });
  }
}
