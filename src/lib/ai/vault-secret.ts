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
  const svc = getServiceSupabase();
  if (!session || !svc) return "";
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return "";
  const { data: wid } = await session.rpc("current_workspace_id");
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
