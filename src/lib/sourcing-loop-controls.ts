/**
 * Service-role reads of sourcing_loop_controls MUST use get_sourcing_loop_controls.
 * Table SELECT is revoked (0038) — PostgREST returns 42501 and callers that
 * SELECT silently treat sequences as disarmed / skip forever.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SourcingLoopControlsRow = {
  workspace_id?: string;
  kill_switch?: boolean;
  intake_enabled?: boolean;
  sourcing_enabled?: boolean;
  enrichment_enabled?: boolean;
  sequences_enabled?: boolean;
  swarm_enabled?: boolean;
  auto_shortlist_min_score?: number | null;
  max_sourcing_runs_per_day?: number | null;
  max_sequence_sends_per_day?: number | null;
  max_enrichment_units_per_day?: number | null;
};

export async function loadSourcingLoopControls(
  svc: SupabaseClient,
  workspaceId: string,
): Promise<{ ok: true; row: SourcingLoopControlsRow } | { ok: false; detail: string }> {
  const wid = workspaceId.trim();
  if (!wid) return { ok: false, detail: "workspace_required" };
  const { data, error } = await svc.rpc("get_sourcing_loop_controls", {
    p_workspace_id: wid,
  });
  if (error) return { ok: false, detail: error.message };
  const row = Array.isArray(data)
    ? (data[0] as SourcingLoopControlsRow | undefined)
    : (data as SourcingLoopControlsRow | null);
  if (!row || typeof row !== "object") return { ok: false, detail: "controls_missing" };
  return { ok: true, row };
}

/** Sequences armed = kill off + sequences on (Autopilot / outbound dispatch gate). */
export function sequencesArmedFromControls(row: SourcingLoopControlsRow | null | undefined): boolean {
  return row?.kill_switch === false && row?.sequences_enabled === true;
}
