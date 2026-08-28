import { z } from "zod";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getServiceSupabase, type getServerSupabase } from "@/lib/supabase/server";
import {
  cloudflareWorkersAiChatUrl,
  CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
} from "@/lib/integrations/cloudflare-workers-ai";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type ServiceSupabase = NonNullable<ReturnType<typeof getServiceSupabase>>;

const CloudflareConnectionRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  account_id: z.string().min(1).max(64),
  api_key_id: z.string().uuid(),
  default_model: z.string().min(1).max(160),
  models: z.array(z.string()).max(500),
  enabled: z.boolean(),
  config_revision: z.number().int().positive(),
});

export interface ResolvedCloudflareAuthority {
  workspaceId: string;
  accountId: string;
  apiKeyId: string;
  chatEndpoint: string;
  defaultModel: string;
  models: string[];
  secret: string;
}

export type CloudflareAuthorityResult =
  | { ok: true; authority: ResolvedCloudflareAuthority }
  | { ok: false; code: "not_configured" | "credential_unavailable" | "backend_error" };

export async function resolveCloudflareAuthority(
  session: ServerSupabase,
  serviceClient: ServiceSupabase | null = getServiceSupabase(),
): Promise<CloudflareAuthorityResult> {
  if (!serviceClient) return { ok: false, code: "backend_error" };

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return { ok: false, code: "backend_error" };
  }

  const { data: connectionData, error: connectionError } = await serviceClient
    .from("cloudflare_connections")
    .select("id, workspace_id, account_id, api_key_id, default_model, models, enabled, config_revision")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .maybeSingle();
  if (connectionError) return { ok: false, code: "backend_error" };
  if (!connectionData) return { ok: false, code: "not_configured" };

  const parsed = CloudflareConnectionRowSchema.safeParse({
    ...connectionData,
    models: Array.isArray(connectionData.models) ? connectionData.models : [],
  });
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || !parsed.data.enabled) {
    return { ok: false, code: "backend_error" };
  }

  const connection = parsed.data;
  const { data: keyData, error: keyError } = await serviceClient
    .from("api_keys")
    .select("secret, workspace_id, provider, status")
    .eq("id", connection.api_key_id)
    .eq("workspace_id", workspaceId)
    .eq("provider", "Cloudflare")
    .eq("status", "valid")
    .maybeSingle();
  if (keyError) return { ok: false, code: "backend_error" };
  if (
    !keyData?.secret ||
    keyData.workspace_id !== workspaceId ||
    keyData.provider !== "Cloudflare" ||
    keyData.status !== "valid"
  ) {
    return { ok: false, code: "credential_unavailable" };
  }

  const secret = decryptSecret(keyData.secret);
  if (!secret) return { ok: false, code: "credential_unavailable" };

  return {
    ok: true,
    authority: {
      workspaceId,
      accountId: connection.account_id,
      apiKeyId: connection.api_key_id,
      chatEndpoint: cloudflareWorkersAiChatUrl(connection.account_id),
      defaultModel: connection.default_model || CLOUDFLARE_WORKERS_AI_DEFAULT_MODEL,
      models: connection.models,
      secret,
    },
  };
}
