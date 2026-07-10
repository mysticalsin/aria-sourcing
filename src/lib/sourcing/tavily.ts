import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";

/**
 * Resolve this workspace's stored, decrypted Tavily key (service-role read -
 * `secret` is withheld from `authenticated` by column grant, same pattern as
 * Apollo/Sillage). Returns null when nothing is stored. Never accepts a raw key
 * from the caller.
 */
export async function resolveStoredTavilyKey(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  serviceClient = getServiceSupabase(),
): Promise<string | null> {
  if (!serviceClient) return null;
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await serviceClient
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", wid)
    .eq("provider", "Tavily")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  const key = decryptSecret(row.secret);
  return key || null;
}

/**
 * Resolve a Databricks secret by the exact ApiKey.id selected in integration
 * settings. This intentionally does not fall back to "newest Databricks key":
 * the workspace config owns which credential is allowed for Statement Execution.
 */
export async function resolveStoredDatabricksSecret(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  apiKeyId: string | undefined,
  serviceClient = getServiceSupabase(),
): Promise<string | null> {
  if (!apiKeyId || !serviceClient) return null;
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await serviceClient
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", wid)
    .eq("provider", "Databricks")
    .eq("id", apiKeyId)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  const key = decryptSecret(row.secret);
  return key || null;
}
