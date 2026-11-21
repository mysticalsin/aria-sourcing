export interface ApprovalBatchState {
  selectedIds: string[];
  approving: boolean;
}

export type ApprovalBatchEvent =
  | { type: "toggle"; id: string }
  | { type: "replace"; ids: string[] }
  | { type: "begin" }
  | { type: "finish"; blockedIds: string[] }
  | { type: "end" };

export function initialApprovalBatch(): ApprovalBatchState {
  return { selectedIds: [], approving: false };
}

/**
 * Bulk approval selection. Begin is ignored while a batch is already running.
 * Finish keeps the drafts that did not move, so the operator can correct them.
 * End only clears the running flag (a thrown batch must not wipe the selection).
 */
export function reduceApprovalBatch(state: ApprovalBatchState, event: ApprovalBatchEvent): ApprovalBatchState {
  switch (event.type) {
    case "toggle":
      return {
        ...state,
        selectedIds: state.selectedIds.includes(event.id)
          ? state.selectedIds.filter((id) => id !== event.id)
          : [...state.selectedIds, event.id],
      };
    case "replace":
      return { ...state, selectedIds: [...event.ids] };
    case "begin":
      return state.approving ? state : { ...state, approving: true };
    case "finish":
      return { selectedIds: [...event.blockedIds], approving: false };
    case "end":
      return state.approving ? { ...state, approving: false } : state;
    default:
      return state;
  }
}
