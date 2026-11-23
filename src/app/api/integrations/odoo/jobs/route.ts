// Odoo job positions, read-only.
//   GET            open job positions (to import one as a campaign brief)
//   GET ?id=<n>    one job position with the intake brief built from it

import type { NextRequest } from "next/server";
import { jobToBrief, jobUrl } from "@/lib/integrations/odoo/mapping";
import { listOpenJobs, readJob } from "@/lib/integrations/odoo/service";
import { odooFailure, odooJson, requireOdooUser, resolveOdoo } from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "source" });
  if (!auth.ok) return auth.response;
  const rawId = req.nextUrl.searchParams.get("id");
  if (rawId !== null && !/^[1-9][0-9]{0,8}$/.test(rawId)) return odooJson(400, { ok: false, error: "Invalid job id." });
  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;
  try {
    if (rawId === null) {
      const jobs = await listOpenJobs(odoo.client);
      return odooJson(200, { ok: true, jobs: jobs.map((job) => ({ ...job, url: jobUrl(odoo.publicUrl, job.id) })) });
    }
    const job = await readJob(odoo.client, Number(rawId));
    if (!job) return odooJson(404, { ok: false, error: "This job position is not in Odoo (or is archived)." });
    return odooJson(200, { ok: true, job: { ...job, url: jobUrl(odoo.publicUrl, job.id) }, brief: jobToBrief(job) });
  } catch (error) {
    return odooFailure(error, "job read");
  }
}
