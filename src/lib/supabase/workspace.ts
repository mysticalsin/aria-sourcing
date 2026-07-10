"use client";

import type { HermesState, Role } from "@/lib/types";
import { getBrowserSupabase } from "./client";
import { stripSharedRole } from "@/lib/live-role-authority";
import { AGENT_SEAT_SELECT, type AgentSeatRow } from "@/lib/fleet-seats";

function profileRole(value: unknown): Role {
  return value === "admin" || value === "member" || value === "viewer" ? value : "viewer";
}

export interface RemoteLoad {
  workspaceId: string;
  state: HermesState | null;
  /** Signed-in profile authority. Shared workspace JSON is never authoritative. */
  role: Role;
  /** The row's `updated_at` when loaded — the optimistic-concurrency token. */
  updatedAt: string | null;
}

export interface SaveResult {
  ok: boolean;
  /** True when the write was rejected because a teammate saved since we loaded. */
  conflict?: boolean;
  /** The new `updated_at` after a successful save (becomes the next token). */
  updatedAt?: string;
  /** On a conflict, the latest shared state to reload. */
  latest?: RemoteLoad;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Resolve the signed-in user (browser). Returns null in demo mode / signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const name =
    (u.user_metadata?.full_name as string) ||
    (u.user_metadata?.name as string) ||
    (u.email ? u.email.split("@")[0] : "Operator");
  const { data: role } = await supabase.rpc("current_profile_role");
  return { id: u.id, email: u.email ?? "", name, role: profileRole(role) };
}

/**
 * Load this user's shared workspace state. `ensure_workspace` (a SECURITY DEFINER
 * function in the migration) finds-or-creates the org workspace by email domain
 * and the caller's profile, returning the workspace id. Returns null only when
 * signed out; otherwise returns the workspace id, its persisted state (or null if
 * the workspace has never been seeded), and the row's `updated_at` token.
 */
export async function loadRemoteState(): Promise<RemoteLoad | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  try {
    const { data: workspaceId, error: rpcError } = await supabase.rpc("ensure_workspace");
    if (rpcError || !workspaceId) {
      console.warn("ensure_workspace failed; running in-memory only:", rpcError?.message);
      return { workspaceId: "", state: null, updatedAt: null, role: "viewer" };
    }
    const { data: resolvedRole, error: roleError } = await supabase.rpc("current_profile_role");
    if (roleError) {
      console.warn("current_profile_role failed; using read-only authority:", roleError.message);
    }
    const role = roleError ? "viewer" : profileRole(resolvedRole);
    const { data: row, error: rowError } = await supabase
      .from("workspace_state")
      .select("state, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (rowError) {
      // A FAILED read must not masquerade as an EMPTY workspace: the hydrate
      // path seeds-and-saves when it sees `state: null` with a workspaceId,
      // which would overwrite the whole shared blob during a transient backend
      // blip. Run in-memory only (no workspaceId → nothing ever persists).
      console.warn("workspace_state load failed; running in-memory only:", rowError.message);
      return { workspaceId: "", state: null, updatedAt: null, role };
    }
    return {
      workspaceId: workspaceId as string,
      state: (row?.state as HermesState) ?? null,
      updatedAt: (row?.updated_at as string) ?? null,
      role,
    };
  } catch (err) {
    console.warn("loadRemoteState error:", err);
    return { workspaceId: "", state: null, updatedAt: null, role: "viewer" };
  }
}

export async function loadRemoteAgentSeats(): Promise<AgentSeatRow[] | null> {
  const supabase = getBrowserSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("agent_seats")
    .select(AGENT_SEAT_SELECT)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("agent_seats load failed; keeping workspace-state seats:", error.message);
    return null;
  }
  return (data ?? []) as AgentSeatRow[];
}

/**
 * Persist the full workspace state document with OPTIMISTIC CONCURRENCY.
 *
 * `expectedUpdatedAt` is the `updated_at` the caller last loaded. The write only
 * lands if the row STILL has that timestamp — so if a teammate saved in the
 * meantime, the conditional update matches zero rows and we report a conflict
 * (with the latest state) instead of silently clobbering their change. The shared
 * workspace is one JSONB document, so last-write-wins would otherwise lose a whole
 * concurrent edit with no warning to anyone.
 *
 * When `expectedUpdatedAt` is null (first save, the row does not exist yet) we
 * upsert to create it.
 */
export async function saveRemoteState(
  workspaceId: string,
  state: HermesState,
  expectedUpdatedAt: string | null,
): Promise<SaveResult> {
  const supabase = getBrowserSupabase();
  if (!supabase || !workspaceId) return { ok: false };
  const sharedState = stripSharedRole(state);
  try {
    if (expectedUpdatedAt === null) {
      // No known prior version — create (or adopt) the row. `updated_at` is owned by
      // the DB (column default on insert, the touch_updated_at trigger on update),
      // so we read it back as the authoritative concurrency token rather than
      // trusting a client clock the trigger would overwrite anyway.
      const { data, error } = await supabase
        .from("workspace_state")
        .upsert({ workspace_id: workspaceId, state: sharedState }, { onConflict: "workspace_id" })
        .select("updated_at")
        .maybeSingle();
      if (error) {
        console.warn("saveRemoteState (insert) failed:", error.message);
        return { ok: false };
      }
      return { ok: true, updatedAt: (data?.updated_at as string) ?? undefined };
    }

    // Conditional update — only overwrite the exact version we loaded. The
    // touch_updated_at trigger assigns the new updated_at; we read it back as the
    // authoritative next token (never via a JS Date, which would drop microseconds).
    const { data, error } = await supabase
      .from("workspace_state")
      .update({ state: sharedState })
      .eq("workspace_id", workspaceId)
      .eq("updated_at", expectedUpdatedAt)
      .select("updated_at")
      .maybeSingle();
    if (error) {
      console.warn("saveRemoteState (update) failed:", error.message);
      return { ok: false };
    }
    if (!data) {
      // Zero rows matched → a teammate wrote since we loaded. Return the latest
      // state so the caller can reload instead of clobbering it.
      const { data: latestRow } = await supabase
        .from("workspace_state")
        .select("state, updated_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return {
        ok: false,
        conflict: true,
        latest: {
          workspaceId,
          state: (latestRow?.state as HermesState) ?? null,
          updatedAt: (latestRow?.updated_at as string) ?? null,
          role: "viewer",
        },
      };
    }
    return { ok: true, updatedAt: data.updated_at as string };
  } catch (err) {
    console.warn("saveRemoteState error:", err);
    return { ok: false };
  }
}

export async function signOut(): Promise<void> {
  const supabase = getBrowserSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}
