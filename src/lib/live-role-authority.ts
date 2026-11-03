import type { WorkspaceState, Role } from "@/lib/types";

export function applyAuthoritativeRole(state: WorkspaceState, role: Role): WorkspaceState {
  return { ...state, currentRole: role };
}

/** User authority is profile data and must never be written to shared JSON. */
export function stripSharedRole(state: WorkspaceState): Omit<WorkspaceState, "currentRole"> {
  const { currentRole: _ignored, ...shared } = state;
  return shared;
}
