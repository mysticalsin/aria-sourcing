export interface OutreachQueueState {
  campaignFilter: string;
  sentOpen: boolean;
  glassBoxId: string | null;
  expandedId: string | null;
  composerOpen: boolean;
  draftingAll: boolean;
  draftProgress: { done: number; total: number };
}

export type OutreachQueueEvent =
  | { type: "set-campaign"; campaignId: string }
  | { type: "toggle-sent" }
  | { type: "toggle-glass"; id: string }
  | { type: "toggle-expanded"; id: string }
  | { type: "set-composer"; open: boolean }
  | { type: "draft-start"; total: number }
  | { type: "draft-progress"; done: number; total: number }
  | { type: "draft-finish" };

export function initialOutreachQueue(campaignFilter: string): OutreachQueueState {
  return {
    campaignFilter: campaignFilter || "all",
    sentOpen: false,
    glassBoxId: null,
    expandedId: null,
    composerOpen: false,
    draftingAll: false,
    draftProgress: { done: 0, total: 0 },
  };
}

/** Outreach page chrome: filter, one open draft, glass box, and the follow-up run. */
export function reduceOutreachQueue(state: OutreachQueueState, event: OutreachQueueEvent): OutreachQueueState {
  switch (event.type) {
    case "set-campaign":
      return { ...state, campaignFilter: event.campaignId };
    case "toggle-sent":
      return { ...state, sentOpen: !state.sentOpen };
    case "toggle-glass":
      return { ...state, glassBoxId: state.glassBoxId === event.id ? null : event.id };
    case "toggle-expanded":
      return { ...state, expandedId: state.expandedId === event.id ? null : event.id };
    case "set-composer":
      return { ...state, composerOpen: event.open };
    case "draft-start":
      return { ...state, draftingAll: true, draftProgress: { done: 0, total: event.total } };
    case "draft-progress":
      return { ...state, draftProgress: { done: event.done, total: event.total } };
    case "draft-finish":
      return state.draftingAll ? { ...state, draftingAll: false } : state;
    default:
      return state;
  }
}
