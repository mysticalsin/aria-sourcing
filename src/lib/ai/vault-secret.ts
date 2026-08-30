import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { supabaseEnabled } from "@/lib/supabase/config";
import { VAULT_PROVIDER, type AiProviderSlug } from "@/lib/ai/provider";

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

/**
 * Service-role read of a workspace's stored LLM key for autonomous cron/loop
 * paths (mirrors resolveStoredTavilyKeyForWorkspace). Requires an explicit
 * workspaceId — never picks a key from another tenant. Returns null on miss.
 * NEVER logs the decrypted value.
 */
export async function resolveStoredLlmKeyForWorkspace(
  workspaceId: string,
  slug: AiProviderSlug,
): Promise<string | null> {
  if (!workspaceId.trim()) return null;
  const vaultProvider = VAULT_PROVIDER[slug];
  if (!vaultProvider) return null;
  const serviceClient = getServiceSupabase();
  if (!serviceClient) return null;
  const { data: row } = await serviceClient
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", workspaceId)
    .eq("provider", vaultProvider)
    .eq("status", "valid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  const key = decryptSecret(row.secret);
  return key || null;
}
