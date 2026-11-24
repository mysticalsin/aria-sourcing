import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled } from "@/lib/supabase/config";

/**
 * Resolve a vault secret by ApiKey.id, scoped to the caller's workspace.
 * Returns the raw secret string, or "" on any failure. NEVER logs or returns
 * the value outside the immediate call site.
 */
export async function resolveVaultSecret(id?: string, expectedProvider?: string): Promise<string> {
  if (!supabaseEnabled || !id) return "";
  const session = await getServerSupabase();
  if (!session) return "";
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return "";
  const { data: wid } = await session.rpc("current_workspace_id");
  return typeof wid === "string" ? resolveWorkspaceVaultSecret(wid, id, expectedProvider) : "";
}

/**
 * Resolve a vault secret of a known workspace, with the service client. For
 * server callers that already established the workspace authority (the
 * agents runner acting for a delegating user). Same contract: "" on failure.
 */
export async function resolveWorkspaceVaultSecret(workspaceId: string, id?: string, expectedProvider?: string): Promise<string> {
  if (!supabaseEnabled || !id || !workspaceId) return "";
  const svc = getServiceSupabase();
  if (!svc) return "";
  let query = svc
    .from("api_keys")
    .select("secret, workspace_id, provider, status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("status", "valid");
  if (expectedProvider) query = query.eq("provider", expectedProvider);
  const { data: row } = await query.single();
  if (
    row &&
    row.workspace_id === workspaceId &&
    row.status === "valid" &&
    (!expectedProvider || row.provider === expectedProvider) &&
    typeof row.secret === "string"
  ) {
    return decryptSecret(row.secret);
  }
  return "";
}
