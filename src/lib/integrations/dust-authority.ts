import { z } from "zod";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getServiceSupabase, type getServerSupabase } from "@/lib/supabase/server";
import type { DustAgentSummary, DustRegion } from "@/lib/types";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type ServiceSupabase = NonNullable<ReturnType<typeof getServiceSupabase>>;

const DustAgentSchema = z.object({
  sId: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  description: z.string().max(2_000),
});

const DustConnectionRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  dust_workspace_id: z.string().min(1).max(256),
  region: z.enum(["us", "eu"]),
  api_key_id: z.string().uuid(),
  agent_locks: z.record(z.string().max(80), z.string().min(1).max(256)),
  agents: z.array(DustAgentSchema).max(500),
  enabled: z.boolean(),
  config_revision: z.number().int().positive(),
});

export interface ResolvedDustAuthority {
  workspaceId: string;
  region: DustRegion;
  agentLocks: Record<string, string>;
  agents: DustAgentSummary[];
  secret: string;
  authorityScope: string;
}

export type DustAuthorityResult =
  | { ok: true; authority: ResolvedDustAuthority }
  | { ok: false; code: "not_configured" | "credential_unavailable" | "backend_error" };

/** Resolve the sole admin-approved Dust authority for the authenticated
 * workspace. The service client bypasses RLS, so every read is explicitly
 * tenant scoped and the credential is bound to provider Dust plus valid status. */
export async function resolveDustAuthority(
  session: ServerSupabase,
  serviceClient: ServiceSupabase | null = getServiceSupabase(),
): Promise<DustAuthorityResult> {
  if (!serviceClient) return { ok: false, code: "backend_error" };

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return { ok: false, code: "backend_error" };
  }

  const { data: connectionData, error: connectionError } = await serviceClient
    .from("dust_connections")
    .select(
      "id, workspace_id, dust_workspace_id, region, api_key_id, agent_locks, agents, enabled, config_revision",
    )
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .maybeSingle();
  if (connectionError) return { ok: false, code: "backend_error" };
  if (!connectionData) return { ok: false, code: "not_configured" };

  const parsed = DustConnectionRowSchema.safeParse(connectionData);
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || !parsed.data.enabled) {
    return { ok: false, code: "backend_error" };
  }

  const connection = parsed.data;
  const { data: keyData, error: keyError } = await serviceClient
    .from("api_keys")
    .select("secret, workspace_id, provider, status")
    .eq("id", connection.api_key_id)
    .eq("workspace_id", workspaceId)
    .eq("provider", "Dust")
    .eq("status", "valid")
    .maybeSingle();
  if (keyError) return { ok: false, code: "backend_error" };
  if (
    !keyData ||
    keyData.workspace_id !== workspaceId ||
    keyData.provider !== "Dust" ||
    keyData.status !== "valid" ||
    typeof keyData.secret !== "string"
  ) {
    return { ok: false, code: "credential_unavailable" };
  }

  const secret = decryptSecret(keyData.secret);
  if (!secret) return { ok: false, code: "credential_unavailable" };

  return {
    ok: true,
    authority: {
      workspaceId: connection.dust_workspace_id,
      region: connection.region,
      agentLocks: connection.agent_locks,
      agents: connection.agents,
      secret,
      authorityScope: [workspaceId, connection.id, connection.config_revision, connection.api_key_id].join(":"),
    },
  };
}
