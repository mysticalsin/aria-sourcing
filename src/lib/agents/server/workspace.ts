/* ============================================================================
   The workspace document (workspace_state) read and written by the agents,
   with the same optimistic concurrency as the browser store: a write only
   lands on the exact version it was computed from. The browser that holds
   an older version gets a conflict on its next save and rebases, as it does
   after a durable sourcing step.
   ========================================================================== */

import "server-only";
import type { WorkspaceState } from "@/lib/types";
import { stripSharedRole } from "@/lib/live-role-authority";
import type { Svc } from "./authority";

export interface WorkspaceVersion {
  state: WorkspaceState;
  updatedAt: string;
}

export async function readWorkspace(svc: Svc, workspaceId: string): Promise<WorkspaceVersion> {
  const { data, error } = await svc.from("workspace_state").select("state, updated_at").eq("workspace_id", workspaceId).single();
  if (error || !data?.updated_at || !data.state || typeof data.state !== "object") throw new Error("Workspace unavailable.");
  return { state: data.state as WorkspaceState, updatedAt: data.updated_at as string };
}

/**
 * Apply `change` to the latest workspace and save it, retrying on a
 * concurrent write. `change` returns null to leave the workspace as it is.
 * Returns the saved state, or null when nothing was written.
 */
export async function mutateWorkspace(
  svc: Svc,
  workspaceId: string,
  change: (state: WorkspaceState) => WorkspaceState | null,
  attempts = 4,
): Promise<WorkspaceState | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await readWorkspace(svc, workspaceId);
    const next = change(current.state);
    if (!next || next === current.state) return null;
    const { data, error } = await svc.from("workspace_state")
      .update({ state: stripSharedRole(next) })
      .eq("workspace_id", workspaceId)
      .eq("updated_at", current.updatedAt)
      .select("updated_at")
      .maybeSingle();
    if (error) throw new Error("Workspace could not be saved.");
    if (data) return next;
  }
  throw new Error("Workspace changed repeatedly; the agent will retry on its next tick.");
}
