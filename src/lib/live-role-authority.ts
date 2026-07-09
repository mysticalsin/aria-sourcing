import type { HermesState, Role } from "@/lib/types";

export function applyAuthoritativeRole(state: HermesState, role: Role): HermesState {
  return { ...state, currentRole: role };
}

/** User authority is profile data and must never be written to shared JSON. */
export function stripSharedRole(state: HermesState): Omit<HermesState, "currentRole"> {
  const { currentRole: _ignored, ...shared } = state;
  return shared;
}
