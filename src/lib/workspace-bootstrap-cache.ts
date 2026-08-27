/**
 * Session + local cache for live workspace bootstrap so hard reloads paint the
 * shell immediately while remote state revalidates. localStorage survives tab
 * close; sessionStorage is a same-tab fast path.
 */

import type { HermesState, Role } from "@/lib/types";

const CACHE_KEY = "aria-workspace-bootstrap-v1";
/** 12h — hard reloads within a working day should not wait on a cold network waterfall. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type WorkspaceBootstrapCache = {
  workspaceId: string;
  updatedAt: string | null;
  role: Role;
  state: HermesState;
  cachedAt: number;
};

function readFrom(storage: Storage | undefined): WorkspaceBootstrapCache | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceBootstrapCache;
    if (!parsed?.workspaceId || !parsed?.state || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeTo(storage: Storage | undefined, payload: WorkspaceBootstrapCache): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — ignore; next load just waits on network.
  }
}

function removeFrom(storage: Storage | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function readWorkspaceBootstrapCache(): WorkspaceBootstrapCache | null {
  if (typeof window === "undefined") return null;
  // Prefer session (same tab), then local (survives hard reload / new tab).
  return readFrom(window.sessionStorage) ?? readFrom(window.localStorage);
}

export function writeWorkspaceBootstrapCache(entry: Omit<WorkspaceBootstrapCache, "cachedAt">): void {
  if (typeof window === "undefined") return;
  const payload: WorkspaceBootstrapCache = { ...entry, cachedAt: Date.now() };
  writeTo(window.sessionStorage, payload);
  writeTo(window.localStorage, payload);
}

export function clearWorkspaceBootstrapCache(): void {
  if (typeof window === "undefined") return;
  removeFrom(window.sessionStorage);
  removeFrom(window.localStorage);
}
