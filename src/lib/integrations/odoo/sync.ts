/* ============================================================================
   The server is the only place where Odoo's outcome lands in the workspace:
   the campaign sync, the Odoo webhook and the GDPR erasure all go through
   here, so a change is applied once (one note, one activity), whoever saw it
   first. (The GDPR erasure of the Odoo applicant is in ./erasure.ts.) Writes use the same optimistic concurrency as the agents
   (mutateWorkspace); an open browser picks the change up on its next load.
   ========================================================================== */

import { mutateWorkspace, readWorkspace } from "@/lib/agents/server/workspace";
import type { CandidateStage } from "@/lib/types";
import type { OdooClient } from "./client";
import {
  applicantUrl,
  applyOdooUpdates,
  ariaStageForApplicant,
  recordHandoff,
  type ApplicantUpdate,
  type ApplicationStatus,
  type StageMap,
  type StageSyncChange,
} from "./mapping";
import { listStages, readApplicantStates } from "./service";
import { recordApplicantSync, type ApplicantLinkRow, type Svc } from "./authority";

export interface SyncedApplicant {
  candidateId: string;
  campaignId: string;
  applicantId: number;
  url: string;
  stage: string | null;
  status: ApplicationStatus;
  refuseReason: string | null;
  ariaStage: CandidateStage | null;
}

/** Odoo's current state of these linked applicants, recorded on the links. */
export async function readLinkedApplicants(
  svc: Svc,
  workspaceId: string,
  odoo: { client: OdooClient; publicUrl: string; stageMap: StageMap },
  links: ReadonlyArray<ApplicantLinkRow & { applicant_id: number }>,
): Promise<SyncedApplicant[]> {
  if (links.length === 0) return [];
  const stages = await listStages(odoo.client);
  const states = new Map(
    (await readApplicantStates(odoo.client, links.map((row) => row.applicant_id), stages)).map((state) => [state.applicantId, state]),
  );
  const applicants: SyncedApplicant[] = [];
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
  return applicants;
}

/** Move the workspace's candidates as Odoo says. Returns what moved. */
export async function applyApplicantUpdates(svc: Svc, workspaceId: string, applicants: readonly SyncedApplicant[]): Promise<StageSyncChange[]> {
  const updates: ApplicantUpdate[] = applicants.map((a) => ({
    candidateId: a.candidateId,
    applicantId: a.applicantId,
    ariaStage: a.ariaStage,
    odooStage: a.stage,
    status: a.status,
    refuseReason: a.refuseReason,
  }));
  if (updates.every((u) => u.ariaStage === null)) return [];
  let changes: StageSyncChange[] = [];
  await mutateWorkspace(svc, workspaceId, (state) => {
    const result = applyOdooUpdates(state, updates, new Date().toISOString());
    changes = result.changes;
    return result.changes.length > 0 ? result.state : null;
  });
  return changes;
}

/** The workspace's own (server) stage of these candidates. */
export async function workspaceStages(svc: Svc, workspaceId: string, candidateIds: readonly string[]): Promise<Record<string, CandidateStage>> {
  if (candidateIds.length === 0) return {};
  const wanted = new Set(candidateIds);
  const { state } = await readWorkspace(svc, workspaceId);
  return Object.fromEntries(state.candidates.filter((c) => wanted.has(c.id)).map((c) => [c.id, c.stage]));
}

/** Write the hand-off in ARIA's own trail (note + activity). */
export async function recordHandoffInWorkspace(
  svc: Svc,
  workspaceId: string,
  input: { candidateId: string; applicantId: number; jobName: string; sentBy: string; created: boolean },
): Promise<void> {
  await mutateWorkspace(svc, workspaceId, (state) => recordHandoff(state, input, new Date().toISOString()));
}
