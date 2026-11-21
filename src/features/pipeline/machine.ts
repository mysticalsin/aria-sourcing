export type CandidateSort = "match" | "recent";

export interface PipelineListState {
  query: string;
  sort: CandidateSort;
  stage: string;
  source: string;
  page: number;
  pageSize: number;
  selectedIds: string[];
  bulkStage: string;
  bulkReason: string;
}

export type PipelineListEvent =
  | { type: "set-query"; query: string }
  | { type: "set-sort"; sort: CandidateSort }
  | { type: "set-stage"; stage: string }
  | { type: "set-source"; source: string }
  | { type: "set-page-size"; pageSize: number }
  | { type: "set-page"; page: number }
  | { type: "clamp-page"; page: number }
  | { type: "clear-filters" }
  | { type: "toggle-select"; id: string }
  | { type: "select-page"; ids: string[]; mode: "add" | "remove" }
  | { type: "set-bulk-stage"; stage: string }
  | { type: "set-bulk-reason"; reason: string }
  | { type: "clear-selection" };

export interface PipelineFilterCandidate {
  id: string;
  name: string;
  currentTitle: string;
  currentCompany: string;
  stage: string;
  sourcePlatform: string;
  matchScore: number;
  lastContactedAt: string | null;
  createdAt: string;
}

const DEFAULT_PAGE_SIZE = 50;

export function initialPipelineList(): PipelineListState {
  return {
    query: "",
    sort: "match",
    stage: "all",
    source: "all",
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    selectedIds: [],
    bulkStage: "",
    bulkReason: "",
  };
}

function withPageReset(state: PipelineListState, patch: Partial<PipelineListState>): PipelineListState {
  return { ...state, ...patch, page: 0 };
}

/** Candidates-page list chrome: filters, paging, and the bulk selection. */
export function reducePipelineList(state: PipelineListState, event: PipelineListEvent): PipelineListState {
  switch (event.type) {
    case "set-query":
      return withPageReset(state, { query: event.query });
    case "set-sort":
      return withPageReset(state, { sort: event.sort === "recent" ? "recent" : "match" });
    case "set-stage":
      return withPageReset(state, { stage: event.stage });
    case "set-source":
      return withPageReset(state, { source: event.source });
    case "set-page-size":
      return withPageReset(state, {
        pageSize: Number.isFinite(event.pageSize) && event.pageSize > 0 ? event.pageSize : state.pageSize,
      });
    case "set-page":
      return { ...state, page: event.page };
    case "clamp-page":
      return state.page === event.page ? state : { ...state, page: event.page };
    case "clear-filters":
      return withPageReset(state, { query: "", stage: "all", source: "all" });
    case "toggle-select": {
      const selected = state.selectedIds.includes(event.id);
      return {
        ...state,
        selectedIds: selected
          ? state.selectedIds.filter((id) => id !== event.id)
          : [...state.selectedIds, event.id],
      };
    }
    case "select-page": {
      if (event.mode === "remove") {
        const drop = new Set(event.ids);
        return { ...state, selectedIds: state.selectedIds.filter((id) => !drop.has(id)) };
      }
      const next = [...state.selectedIds];
      for (const id of event.ids) {
        if (!next.includes(id)) next.push(id);
      }
      return { ...state, selectedIds: next };
    }
    case "set-bulk-stage":
      return { ...state, bulkStage: event.stage };
    case "set-bulk-reason":
      return { ...state, bulkReason: event.reason };
    case "clear-selection":
      return { ...state, selectedIds: [], bulkStage: "", bulkReason: "" };
    default:
      return state;
  }
}

/** Same filter and sort the candidates page applied inline. */
export function filterPipelineCandidates<T extends PipelineFilterCandidate>(
  candidates: readonly T[],
  criteria: Pick<PipelineListState, "query" | "sort" | "stage" | "source">,
): T[] {
  const query = criteria.query.trim().toLowerCase();
  const result = candidates.filter((candidate) => {
    if (criteria.stage !== "all" && candidate.stage !== criteria.stage) return false;
    if (criteria.source !== "all" && candidate.sourcePlatform !== criteria.source) return false;
    if (!query) return true;
    return (
      candidate.name.toLowerCase().includes(query) ||
      candidate.currentTitle.toLowerCase().includes(query) ||
      candidate.currentCompany.toLowerCase().includes(query)
    );
  });
  result.sort((a, b) =>
    criteria.sort === "match"
      ? b.matchScore - a.matchScore
      : new Date(b.lastContactedAt ?? b.createdAt).getTime() - new Date(a.lastContactedAt ?? a.createdAt).getTime(),
  );
  return result;
}
