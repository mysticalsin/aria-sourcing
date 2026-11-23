// Which ARIA campaign feeds which Odoo job position.
//   GET     every link of the workspace
//   POST    { campaignId, jobId }  link (or re-link) a campaign to an open job
//   DELETE  { campaignId }         unlink (applicants already in Odoo stay there)

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { jobUrl } from "@/lib/integrations/odoo/mapping";
import { readJob } from "@/lib/integrations/odoo/service";
import {
  deleteJobLink,
  listJobLinks,
  odooFailure,
  odooJson,
  publicConnection,
  readConnection,
  requireOdooUser,
  resolveOdoo,
  upsertJobLink,
} from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CampaignId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const LinkSchema = z.object({ campaignId: CampaignId, jobId: z.number().int().positive().max(999_999_999) }).strict();
const UnlinkSchema = z.object({ campaignId: CampaignId }).strict();

export async function GET(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "view" });
  if (!auth.ok) return auth.response;
  try {
    const [connection, links] = await Promise.all([
      readConnection(auth.ctx.svc, auth.ctx.workspaceId),
      listJobLinks(auth.ctx.svc, auth.ctx.workspaceId),
    ]);
    const pub = publicConnection(connection);
    return odooJson(200, {
      ok: true,
      connected: pub.configured,
      links: links.map((link) => ({
        campaignId: link.campaign_id,
        jobId: link.job_id,
        jobName: link.job_name,
        linkedAt: link.linked_at,
        url: pub.configured ? jobUrl(pub.publicUrl, link.job_id) : null,
      })),
    });
  } catch {
    return odooJson(503, { ok: false, error: "Odoo links could not be read." });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "source", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, LinkSchema, { maxBytes: 2_000 });
  if (!body.ok) return body.response;
  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;
  let job;
  try {
    job = await readJob(odoo.client, body.data.jobId);
  } catch (error) {
    return odooFailure(error, "job read");
  }
  if (!job) return odooJson(404, { ok: false, error: "This job position is not in Odoo (or is archived)." });
  try {
    await upsertJobLink(auth.ctx.svc, auth.ctx, body.data.campaignId, job.id, job.name);
    return odooJson(200, {
      ok: true,
      link: { campaignId: body.data.campaignId, jobId: job.id, jobName: job.name, url: jobUrl(odoo.publicUrl, job.id) },
    });
  } catch {
    return odooJson(500, { ok: false, error: "The link could not be saved." });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "source", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, UnlinkSchema, { maxBytes: 1_000 });
  if (!body.ok) return body.response;
  try {
    await deleteJobLink(auth.ctx.svc, auth.ctx.workspaceId, body.data.campaignId);
    return odooJson(200, { ok: true });
  } catch {
    return odooJson(500, { ok: false, error: "The link could not be removed." });
  }
}
