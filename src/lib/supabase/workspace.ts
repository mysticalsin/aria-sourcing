"use client";

import type { HermesState } from "@/lib/types";
import { getBrowserSupabase } from "./client";

export interface RemoteLoad {
  workspaceId: string;
  state: HermesState | null;
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
      return { workspaceId: "", state: null, updatedAt: null };
    }
    const { data: row } = await supabase
      .from("workspace_state")
      .select("state, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return {
      workspaceId: workspaceId as string,
      state: (row?.state as HermesState) ?? null,
      updatedAt: (row?.updated_at as string) ?? null,
    };
  } catch (err) {
    console.warn("loadRemoteState error:", err);
    return { workspaceId: "", state: null, updatedAt: null };
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
  try {
    if (expectedUpdatedAt === null) {
      // No known prior version — create (or adopt) the row. `updated_at` is owned by
      // the DB (column default on insert, the touch_updated_at trigger on update),
      // so we read it back as the authoritative concurrency token rather than
      // trusting a client clock the trigger would overwrite anyway.
      const { data, error } = await supabase
        .from("workspace_state")
        .upsert({ workspace_id: workspaceId, state }, { onConflict: "workspace_id" })
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
      .update({ state })
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
