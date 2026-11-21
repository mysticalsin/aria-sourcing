import type { OdooSyncView } from "@/features/odoo-sync/projection";

export type OdooSyncPhase = "idle" | "preview" | "queued" | "mirrored";

export interface OdooSyncState {
  phase: OdooSyncPhase;
  view: OdooSyncView | null;
}

export type OdooSyncEvent =
  | { type: "preview"; view: OdooSyncView }
  | { type: "queue" }
  | { type: "mirror" }
  | { type: "reset" };

export function initialOdooSync(): OdooSyncState {
  return { phase: "idle", view: null };
}

function canQueue(state: OdooSyncState): boolean {
  return state.phase === "preview" && !!state.view && state.view.ready > 0 && state.view.blocked === 0;
}

/**
 * Preview → queue → local mirror.
 * Queue is refused unless every record in the preview is ready.
 * Mirror is refused until the batch is queued. Nothing here contacts Odoo.
 */
export function reduceOdooSync(state: OdooSyncState, event: OdooSyncEvent): OdooSyncState {
  switch (event.type) {
    case "preview":
      return { phase: "preview", view: event.view };
    case "queue":
      return canQueue(state) ? { ...state, phase: "queued" } : state;
    case "mirror":
      return state.phase === "queued" ? { ...state, phase: "mirrored" } : state;
    case "reset":
      return initialOdooSync();
    default:
      return state;
  }
}
