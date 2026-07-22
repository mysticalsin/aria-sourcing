import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";

export interface StoredTavilyCredential {
  apiKeyId: string;
  key: string;
}

const TAVILY_VERIFICATION_METHODS = ["tavily_usage_v1", "tavily_key_info_v1"] as const;

function isVerifiedTavilyMethod(value: unknown): boolean {
  return typeof value === "string" && TAVILY_VERIFICATION_METHODS.includes(
    value as (typeof TAVILY_VERIFICATION_METHODS)[number],
  );
}

/**
 * Resolve this workspace's stored, decrypted Tavily key (service-role read -
 * `secret` is withheld from `authenticated` by column grant, same pattern as
 * Apollo/Sillage). Returns null when nothing is stored. Never accepts a raw key
 * from the caller.
 */
export async function resolveStoredTavilyCredential(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  serviceClient = getServiceSupabase(),
): Promise<StoredTavilyCredential | null> {
  if (!serviceClient) return null;
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await serviceClient
    .from("api_keys")
    .select("id, secret, workspace_id, provider, status, verification_method")
    .eq("workspace_id", wid)
    .eq("provider", "Tavily")
    .eq("status", "valid")
    .in("verification_method", [...TAVILY_VERIFICATION_METHODS])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    !row ||
    typeof row.id !== "string" ||
    !row.id ||
    row.workspace_id !== wid ||
    row.provider !== "Tavily" ||
    row.status !== "valid" ||
    !isVerifiedTavilyMethod(row.verification_method) ||
    typeof row.secret !== "string" ||
    !row.secret
  ) {
    return null;
  }
  const key = decryptSecret(row.secret);
  return key ? { apiKeyId: row.id, key } : null;
}

export async function resolveStoredTavilyKey(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  serviceClient = getServiceSupabase(),
): Promise<string | null> {
  return (await resolveStoredTavilyCredential(session, serviceClient))?.key ?? null;
}

export async function isStoredTavilyCredentialAuthorized(
  serviceClient: NonNullable<ReturnType<typeof getServiceSupabase>>,
  workspaceId: string,
  apiKeyId: string,
): Promise<boolean> {
  if (!workspaceId || !apiKeyId) return false;
  const { data: row, error } = await serviceClient
    .from("api_keys")
    .select("id, workspace_id, provider, status, verification_method")
    .eq("id", apiKeyId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "Tavily")
    .eq("status", "valid")
    .in("verification_method", [...TAVILY_VERIFICATION_METHODS])
    .maybeSingle();
  return !error &&
    row?.id === apiKeyId &&
    row.workspace_id === workspaceId &&
    row.provider === "Tavily" &&
    row.status === "valid" &&
    isVerifiedTavilyMethod(row.verification_method);
}
