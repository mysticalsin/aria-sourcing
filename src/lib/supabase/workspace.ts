"use client";

import type { HermesState, Role } from "@/lib/types";
import { getBrowserSupabase } from "./client";
import { stripSharedRole } from "@/lib/live-role-authority";
import { AGENT_SEAT_SELECT, type AgentSeatRow } from "@/lib/fleet-seats";
import type { WorkspaceDependency } from "@/lib/workspace-status";

function isProfileRole(value: unknown): value is Role {
  return value === "admin" || value === "member" || value === "viewer";
}

function profileRole(value: unknown): Role {
  return isProfileRole(value) ? value : "viewer";
}

export interface RemoteStateVersion {
  workspaceId: string;
  state: HermesState | null;
  /** The row's `updated_at` when loaded — the optimistic-concurrency token. */
  updatedAt: string | null;
}

export interface RemoteReadyLoad extends RemoteStateVersion {
  status: "ready";
  /** Signed-in profile authority. Shared workspace JSON is never authoritative. */
  role: Role;
}

export interface RemoteSignedOutLoad {
  status: "signed_out";
}

export interface RemoteUnavailableLoad {
  status: "unavailable";
  dependency: Exclude<WorkspaceDependency, "agent_seats">;
}

export type RemoteLoad = RemoteReadyLoad | RemoteSignedOutLoad | RemoteUnavailableLoad;

export type RemoteAgentSeatsLoad =
  | { status: "ready"; seats: AgentSeatRow[] }
  | { status: "unavailable"; dependency: "agent_seats" };

export interface SaveResult {
  ok: boolean;
  /** True when the write was rejected because a teammate saved since we loaded. */
  conflict?: boolean;
  /** The new `updated_at` after a successful save (becomes the next token). */
  updatedAt?: string;
  /** On a conflict, the latest shared state to reload. */
  latest?: RemoteStateVersion;
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
 * and the caller's profile, returning the workspace id. The tagged result keeps
 * confirmed sign-out, dependency failure, and a successful empty workspace
 * distinct so callers never substitute synthetic data for a failed read.
 */
export async function loadRemoteState(): Promise<RemoteLoad> {
  const supabase = getBrowserSupabase();
  if (!supabase) return { status: "unavailable", dependency: "auth" };
  let dependency: RemoteUnavailableLoad["dependency"] = "auth";

  try {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.warn("auth session load failed:", authError.message);
      return { status: "unavailable", dependency: "auth" };
    }
    if (!userData.user) return { status: "signed_out" };

    dependency = "workspace";
    const { data: workspaceId, error: rpcError } = await supabase.rpc("ensure_workspace");
    if (rpcError || !workspaceId) {
      console.warn("ensure_workspace failed:", rpcError?.message);
      return { status: "unavailable", dependency: "workspace" };
    }
    const { data: resolvedRole, error: roleError } = await supabase.rpc("current_profile_role");
    if (roleError) {
      console.warn("current_profile_role failed:", roleError.message);
      return { status: "unavailable", dependency: "workspace" };
    }
    if (!isProfileRole(resolvedRole)) {
      console.warn("current_profile_role returned an invalid authority value");
      return { status: "unavailable", dependency: "workspace" };
    }
    const role = resolvedRole;
    dependency = "state";
    const { data: row, error: rowError } = await supabase
      .from("workspace_state")
      .select("state, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (rowError) {
      console.warn("workspace_state load failed:", rowError.message);
      return { status: "unavailable", dependency: "state" };
    }
    return {
      status: "ready",
      workspaceId: workspaceId as string,
      state: (row?.state as HermesState) ?? null,
      updatedAt: (row?.updated_at as string) ?? null,
      role,
    };
  } catch (err) {
    console.warn("loadRemoteState error:", err);
    return { status: "unavailable", dependency };
  }
}

export async function loadRemoteAgentSeats(): Promise<RemoteAgentSeatsLoad> {
  const supabase = getBrowserSupabase();
  if (!supabase) return { status: "unavailable", dependency: "agent_seats" };
  try {
    const { data, error } = await supabase
      .from("agent_seats")
      .select(AGENT_SEAT_SELECT)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("agent_seats load failed:", error.message);
      return { status: "unavailable", dependency: "agent_seats" };
    }
    return { status: "ready", seats: (data ?? []) as AgentSeatRow[] };
  } catch (err) {
    console.warn("agent_seats load error:", err);
    return { status: "unavailable", dependency: "agent_seats" };
  }
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
      const { data: latestRow, error: latestError } = await supabase
        .from("workspace_state")
        .select("state, updated_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (latestError) {
        console.warn("saveRemoteState conflict reload failed:", latestError.message);
        return { ok: false };
      }
      if (
        !latestRow ||
        latestRow.state === null ||
        latestRow.state === undefined ||
        typeof latestRow.updated_at !== "string" ||
        !latestRow.updated_at
      ) {
        console.warn("saveRemoteState conflict reload returned no authoritative state version");
        return { ok: false };
      }
      return {
        ok: false,
        conflict: true,
        latest: {
          workspaceId,
          state: latestRow.state as HermesState,
          updatedAt: latestRow.updated_at,
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
