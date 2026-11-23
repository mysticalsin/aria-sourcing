// Candidates handed off to Odoo Recruitment.
//   POST { candidateId }    hand the candidate off: create the applicant on the
//                           campaign's Odoo job (or link the one Odoo already
//                           has for this person) and post ARIA's evidence as an
//                           internal note. A recruiter's click; idempotent.
//   GET  ?campaignId=<id>   the Odoo state of every handed-off candidate (of
//                           one campaign), with the ARIA stage it implies.
// The candidate is read from the server's copy of the workspace state, never
// taken from the browser.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  applicantUrl,
  ariaStageForApplicant,
  handoffBlock,
  handoffNoteHtml,
} from "@/lib/integrations/odoo/mapping";
import { createOrFindApplicant, listStages, postApplicantNote, readApplicantStates } from "@/lib/integrations/odoo/service";
import {
  STALE_CLAIM_MS,
  applicantLinkFor,
  candidateForHandoff,
  claimApplicantLink,
  completeApplicantLink,
  forgetDeletedApplicantLink,
  jobLinkFor,
  listApplicantLinks,
  odooFailure,
  odooJson,
  reclaimStaleApplicantLink,
  recordApplicantSync,
  releaseApplicantLink,
  requireOdooUser,
  resolveOdoo,
  type ApplicantLinkRow,
} from "@/lib/integrations/odoo/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const HandoffSchema = z.object({ candidateId: Id }).strict();

function linkedAnswer(row: ApplicantLinkRow, publicUrl: string) {
  return odooJson(200, {
    ok: true,
    status: "already_in_odoo",
    applicant: {
      id: row.applicant_id,
      url: row.applicant_id ? applicantUrl(publicUrl, row.applicant_id) : null,
      stage: row.odoo_stage,
      status: row.odoo_status,
    },
  });
}

const IN_FLIGHT = { ok: false, error: "This candidate is already being sent to Odoo. Refresh in a moment.", code: "in_flight" };

export async function POST(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "source", mutation: true });
  if (!auth.ok) return auth.response;
  const body = await validateBody(req, HandoffSchema, { maxBytes: 1_000 });
  if (!body.ok) return body.response;
  const { svc, workspaceId } = auth.ctx;
  const candidateId = body.data.candidateId;

  let odoo;
  let record;
  let jobLink;
  let existing;
  try {
    odoo = await resolveOdoo(auth.ctx);
    if (!odoo.ok) return odoo.response;
    record = await candidateForHandoff(svc, workspaceId, candidateId);
    if (!record) return odooJson(404, { ok: false, error: "Candidate not found." });
    jobLink = await jobLinkFor(svc, workspaceId, record.candidate.campaignId);
    existing = await applicantLinkFor(svc, workspaceId, candidateId);
  } catch {
    return odooJson(503, { ok: false, error: "The hand-off could not be prepared." });
  }
  const { candidate, campaignTitle } = record;

  if (existing?.state === "linked" && existing.applicant_id) {
    // Already handed off, unless Odoo deleted that applicant since: then the
    // link is forgotten and the candidate can be handed off again.
    let deleted = false;
    try {
      const [state] = await readApplicantStates(odoo.client, [existing.applicant_id], []);
      deleted = state?.status === "deleted";
    } catch {
      // Odoo unreachable: answer from what ARIA knows.
    }
    if (!deleted) return linkedAnswer(existing, odoo.publicUrl);
    try {
      await forgetDeletedApplicantLink(svc, workspaceId, candidateId, existing.applicant_id);
    } catch {
      return odooJson(503, { ok: false, error: "The hand-off could not be prepared." });
    }
    existing = null;
  }
  const block = handoffBlock(candidate);
  if (block) return odooJson(409, { ok: false, error: block, code: "blocked" });
  if (!jobLink) {
    return odooJson(409, {
      ok: false,
      error: "Link this campaign to an Odoo job position first (campaign page > Odoo).",
      code: "no_job",
    });
  }

  // Claim the hand-off so a double click or two tabs cannot create two applicants.
  try {
    if (existing) {
      const stale = Date.now() - Date.parse(existing.claimed_at) > STALE_CLAIM_MS;
      const target = { campaignId: candidate.campaignId, jobId: jobLink.job_id };
      if (!stale || !(await reclaimStaleApplicantLink(svc, auth.ctx, existing, target))) return odooJson(409, IN_FLIGHT);
    } else if (!(await claimApplicantLink(svc, auth.ctx, { candidateId, campaignId: candidate.campaignId, jobId: jobLink.job_id }))) {
      const now = await applicantLinkFor(svc, workspaceId, candidateId);
      if (now?.state === "linked") return linkedAnswer(now, odoo.publicUrl);
      return odooJson(409, IN_FLIGHT);
    }
  } catch {
    return odooJson(503, { ok: false, error: "The hand-off could not be claimed." });
  }

  // From here this request owns the claim. A stale claim is retaken here too:
  // createOrFindApplicant looks the person up in Odoo first, so an applicant a
  // dead request already created is linked, not duplicated.
  let applicantId: number;
  let created: boolean;
  try {
    ({ applicantId, created } = await createOrFindApplicant(odoo.client, candidate, jobLink.job_id));
  } catch (error) {
    await releaseApplicantLink(svc, workspaceId, candidateId).catch(() => undefined);
    return odooFailure(error, "hand-off");
  }

  let noteWarning: string | null = null;
  try {
    const sentAt = new Date().toISOString();
    const intro = created ? "" : "<p><i>ARIA found this application already in Odoo and linked it.</i></p>";
    await postApplicantNote(odoo.client, applicantId, intro + handoffNoteHtml(candidate, { campaignTitle, sentBy: auth.ctx.userEmail || "an ARIA user", sentAt }));
  } catch {
    noteWarning = "The applicant is in Odoo, but ARIA's note could not be posted on it.";
  }

  let stage: string | null = null;
  let status: string | null = null;
  try {
    const [state] = await readApplicantStates(odoo.client, [applicantId], await listStages(odoo.client));
    stage = state?.stage?.name ?? null;
    status = state?.status ?? null;
  } catch {
    // The link matters more than the stage label; the next sync fills it in.
  }

  try {
    await completeApplicantLink(svc, workspaceId, candidateId, { applicantId, stage, status: status === "deleted" ? null : status });
  } catch {
    return odooJson(500, {
      ok: false,
      error: `Applicant #${applicantId} was created in Odoo but ARIA could not record the link. Retry: ARIA will find it instead of creating a second one.`,
    });
  }

  return odooJson(200, {
    ok: true,
    status: created ? "created" : "linked_existing",
    applicant: { id: applicantId, url: applicantUrl(odoo.publicUrl, applicantId), stage, status },
    ...(noteWarning ? { warning: noteWarning } : {}),
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireOdooUser(req, { permission: "view" });
  if (!auth.ok) return auth.response;
  const rawCampaign = req.nextUrl.searchParams.get("campaignId");
  if (rawCampaign !== null && !Id.safeParse(rawCampaign).success) return odooJson(400, { ok: false, error: "Invalid campaign id." });
  const { svc, workspaceId } = auth.ctx;

  let links;
  try {
    links = (await listApplicantLinks(svc, workspaceId, rawCampaign ?? undefined)).filter(
      (row): row is ApplicantLinkRow & { applicant_id: number } => row.state === "linked" && row.applicant_id !== null,
    );
  } catch {
    return odooJson(503, { ok: false, error: "Odoo links could not be read." });
  }
  if (links.length === 0) return odooJson(200, { ok: true, applicants: [] });

  let odoo;
  try {
    odoo = await resolveOdoo(auth.ctx);
  } catch {
    return odooJson(503, { ok: false, error: "The Odoo connection could not be read." });
  }
  if (!odoo.ok) return odoo.response;
  try {
    const stages = await listStages(odoo.client);
    const states = new Map(
      (await readApplicantStates(odoo.client, links.map((row) => row.applicant_id), stages)).map((state) => [state.applicantId, state]),
    );
    const applicants = [];
    for (const row of links) {
      const state = states.get(row.applicant_id);
      if (!state) continue;
      const stageName = state.stage?.name ?? null;
      if (stageName !== row.odoo_stage || state.status !== row.odoo_status) {
        await recordApplicantSync(svc, workspaceId, row.candidate_id, { stage: stageName, status: state.status }).catch(() => undefined);
      }
      applicants.push({
        candidateId: row.candidate_id,
        campaignId: row.campaign_id,
        applicantId: row.applicant_id,
        url: applicantUrl(odoo.publicUrl, row.applicant_id),
        stage: stageName,
        status: state.status,
        refuseReason: state.refuseReason || null,
        ariaStage: ariaStageForApplicant(state, stages, odoo.stageMap),
      });
    }
    return odooJson(200, { ok: true, applicants });
  } catch (error) {
    return odooFailure(error, "sync");
  }
}
