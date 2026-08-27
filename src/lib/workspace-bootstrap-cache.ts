/**
 * Session cache for live workspace bootstrap so hard reloads paint the shell
 * immediately while remote state revalidates.
 */

import type { HermesState, Role } from "@/lib/types";

const CACHE_KEY = "aria-workspace-bootstrap-v1";
const MAX_AGE_MS = 30 * 60 * 1000;

export type WorkspaceBootstrapCache = {
  workspaceId: string;
  updatedAt: string | null;
  role: Role;
  state: HermesState;
  cachedAt: number;
};

export function readWorkspaceBootstrapCache(): WorkspaceBootstrapCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceBootstrapCache;
    if (!parsed?.workspaceId || !parsed?.state || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWorkspaceBootstrapCache(entry: Omit<WorkspaceBootstrapCache, "cachedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: WorkspaceBootstrapCache = { ...entry, cachedAt: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — ignore; next load just waits on network.
  }
}

export function clearWorkspaceBootstrapCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
