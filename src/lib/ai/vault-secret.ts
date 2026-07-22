import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled } from "@/lib/supabase/config";

/**
 * Resolve a vault secret by ApiKey.id, scoped to a workspace.
 *
 * Scoping comes from one of two sources:
 *  - the caller's authenticated session (default — the browser-facing path);
 *  - an explicit `workspaceId`, for session-less service callers (e.g. a
 *    worker-triggered job handler) that have ALREADY authenticated the
 *    request by another means and independently know the exact workspace the
 *    key must belong to. Passing `workspaceId` skips the session lookup.
 *
 * Returns the raw secret string, or "" on any failure. NEVER logs or returns
 * the value outside the immediate call site.
 */
export async function resolveVaultSecret(
  id?: string,
  expectedProvider?: string,
  workspaceId?: string,
): Promise<string> {
  if (!supabaseEnabled || !id) return "";
  const svc = getServiceSupabase();
  if (!svc) return "";
  let wid: string | undefined = workspaceId;
  if (!wid) {
    const session = await getServerSupabase();
    if (!session) return "";
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return "";
    const { data } = await session.rpc("current_workspace_id");
    wid = data ?? undefined;
  }
  let query = svc
    .from("api_keys")
    .select("secret, workspace_id, provider, status")
    .eq("id", id)
    .eq("workspace_id", wid)
    .eq("status", "valid");
  if (expectedProvider) query = query.eq("provider", expectedProvider);
  const { data: row } = await query.single();
  if (
    row &&
    row.workspace_id === wid &&
    row.status === "valid" &&
    (!expectedProvider || row.provider === expectedProvider) &&
    typeof row.secret === "string"
  ) {
    return decryptSecret(row.secret);
  }
  return "";
}
