export interface ReportsConsoleState {
  selectedId: string;
  generating: boolean;
}

export type ReportsConsoleEvent =
  | { type: "select"; id: string }
  | { type: "begin-generate" }
  | { type: "finish-generate" };

export function initialReportsConsole(): ReportsConsoleState {
  return { selectedId: "", generating: false };
}

/** Which campaign report is on screen, and whether generation is in flight. */
export function reduceReportsConsole(
  state: ReportsConsoleState,
  event: ReportsConsoleEvent,
): ReportsConsoleState {
  switch (event.type) {
    case "select":
      return { ...state, selectedId: event.id };
    case "begin-generate":
      return state.generating ? state : { ...state, generating: true };
    case "finish-generate":
      return state.generating ? { ...state, generating: false } : state;
    default:
      return state;
  }
}
