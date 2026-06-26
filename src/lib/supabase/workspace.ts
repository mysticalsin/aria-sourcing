"use client";

import type { HermesState } from "@/lib/types";
import { getBrowserSupabase } from "./client";

export interface RemoteLoad {
  workspaceId: string;
  state: HermesState | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
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
  return { id: u.id, email: u.email ?? "", name };
}

/**
 * Load this user's shared workspace state. `ensure_workspace` (a SECURITY DEFINER
 * function in the migration) finds-or-creates the org workspace by email domain
 * and the caller's profile, returning the workspace id. Returns null only when
 * signed out; otherwise returns the workspace id and its persisted state (or null
 * if the workspace has never been seeded).
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
      return { workspaceId: "", state: null };
    }
    const { data: row } = await supabase
      .from("workspace_state")
      .select("state")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return { workspaceId: workspaceId as string, state: (row?.state as HermesState) ?? null };
  } catch (err) {
    console.warn("loadRemoteState error:", err);
    return { workspaceId: "", state: null };
  }
}

/** Persist the full workspace state document (debounced by the caller). */
export async function saveRemoteState(workspaceId: string, state: HermesState): Promise<void> {
  const supabase = getBrowserSupabase();
  if (!supabase || !workspaceId) return;
  try {
    await supabase.from("workspace_state").upsert(
      { workspace_id: workspaceId, state, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id" },
    );
  } catch (err) {
    console.warn("saveRemoteState error:", err);
  }
}

export async function signOut(): Promise<void> {
  const supabase = getBrowserSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}
