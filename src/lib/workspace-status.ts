export type WorkspaceDependency = "auth" | "workspace" | "state" | "agent_seats";

export type WorkspaceStatus =
  | { phase: "loading"; mode: "live" | "demo" }
  | { phase: "ready"; mode: "live" | "demo" }
  | { phase: "signed_out"; mode: "live" }
  | {
      phase: "unavailable";
      mode: "live";
      dependency: WorkspaceDependency;
      message: string;
    }
  | { phase: "unsaved"; mode: "live"; message: string };

export interface PendingWorkspaceSave<T> {
  workspaceId: string;
  snapshot: T;
  expectedUpdatedAt: string | null;
  /** Hydration generation that owned this write. Older completions are inert. */
  generation: number;
}

export interface FailedWorkspaceSave<T> {
  status: Extract<WorkspaceStatus, { phase: "unsaved" }>;
  pending: PendingWorkspaceSave<T>;
}

export type BlockingWorkspaceStatus = Exclude<WorkspaceStatus, { phase: "ready" }>;

export function workspaceBlocksProduct(status: WorkspaceStatus): status is BlockingWorkspaceStatus {
  return status.phase !== "ready";
}

export function workspaceAllowsMutation(status: WorkspaceStatus): boolean {
  return status.phase === "ready";
}

export type WorkspaceEffectAttempt<T> =
  | { allowed: true; value: T }
  | { allowed: false; reason: "workspace_unavailable" };

/**
 * Single dispatch-time boundary for browser effects. Callers use it both at
 * action entry and immediately around the network/server helper invocation so
 * an availability change during async preparation cannot leak an effect.
 */
export function runWorkspaceEffect<T>(status: WorkspaceStatus, effect: () => T): WorkspaceEffectAttempt<T> {
  if (!workspaceAllowsMutation(status)) {
    return { allowed: false, reason: "workspace_unavailable" };
  }
  return { allowed: true, value: effect() };
}

export function retainPendingWorkspaceSave<T>(
  pending: PendingWorkspaceSave<T>,
  newestSnapshot: T | null,
  expectedUpdatedAt: string | null,
): PendingWorkspaceSave<T> {
  return {
    ...pending,
    snapshot: newestSnapshot ?? pending.snapshot,
    expectedUpdatedAt,
  };
}

interface WorkspaceBoundarySaveResult<Latest> {
  ok: boolean;
  conflict?: boolean;
  updatedAt?: string;
  latest?: Latest | null;
}

interface SettleWorkspaceSaveInput<Latest, Prepared> {
  generation: number;
  currentGeneration: () => number;
  save: () => Promise<WorkspaceBoundarySaveResult<Latest>>;
  prepareConflict: (latest: Latest) => Promise<Prepared | null>;
  applySaved: (result: WorkspaceBoundarySaveResult<Latest>) => void;
  applyConflict: (prepared: Prepared) => void;
}

export type WorkspaceSaveSettlement = "saved" | "conflict" | "failed" | "stale";

/**
 * Resolve a save without mutating caller state until every async dependency is
 * ready and the owning hydration generation is still current.
 */
export async function settleWorkspaceSave<Latest, Prepared>({
  generation,
  currentGeneration,
  save,
  prepareConflict,
  applySaved,
  applyConflict,
}: SettleWorkspaceSaveInput<Latest, Prepared>): Promise<WorkspaceSaveSettlement> {
  let result: WorkspaceBoundarySaveResult<Latest>;
  try {
    result = await save();
  } catch {
    return "failed";
  }
  if (generation !== currentGeneration()) return "stale";

  if (result.ok) {
    try {
      applySaved(result);
      return "saved";
    } catch {
      return "failed";
    }
  }

  if (!result.conflict || result.latest === undefined || result.latest === null) return "failed";

  let prepared: Prepared | null;
  try {
    prepared = await prepareConflict(result.latest);
  } catch {
    return "failed";
  }
  if (generation !== currentGeneration()) return "stale";
  if (prepared === null) return "failed";

  try {
    applyConflict(prepared);
    return "conflict";
  } catch {
    return "failed";
  }
}

export function createFailedWorkspaceSave<T>(
  pending: PendingWorkspaceSave<T>,
  message: string,
): FailedWorkspaceSave<T> {
  return {
    status: { phase: "unsaved", mode: "live", message },
    pending,
  };
}
