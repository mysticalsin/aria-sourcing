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

export function createFailedWorkspaceSave<T>(
  pending: PendingWorkspaceSave<T>,
  message: string,
): FailedWorkspaceSave<T> {
  return {
    status: { phase: "unsaved", mode: "live", message },
    pending,
  };
}
