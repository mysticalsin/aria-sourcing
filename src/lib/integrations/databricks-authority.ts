import { z } from "zod";
import { decryptSecret } from "@/lib/crypto-secrets";
import { getServiceSupabase, type getServerSupabase } from "@/lib/supabase/server";
import type { DatabricksSettings } from "@/lib/types";
import { isDatabricksOriginAllowed } from "@/lib/integrations/databricks-origin-policy";

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
type ServiceSupabase = NonNullable<ReturnType<typeof getServiceSupabase>>;

const DatabricksConnectionRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  origin: z.string().url(),
  warehouse_id: z.string().min(1).max(256),
  auth_mode: z.enum(["pat", "m2m"]),
  client_id: z.string().nullable(),
  api_key_id: z.string().uuid(),
  needs_query: z.string().min(1).max(20_000),
  config_revision: z.number().int().positive(),
  enabled: z.boolean(),
});

export interface ResolvedDatabricksAuthority {
  config: DatabricksSettings;
  secret: string;
  authorityScope: string;
}

export type DatabricksAuthorityResult =
  | { ok: true; authority: ResolvedDatabricksAuthority }
  | {
      ok: false;
      code: "not_configured" | "credential_unavailable" | "backend_error";
    };

/**
 * Resolve the one approved Databricks execution authority for the authenticated
 * workspace. The service client bypasses RLS, so every read is manually scoped
 * to the session-derived workspace and backed by the migration's composite key
 * constraint. No caller-controlled origin or credential id is accepted here.
 */
export async function resolveDatabricksAuthority(
  session: ServerSupabase,
  serviceClient: ServiceSupabase | null = getServiceSupabase(),
): Promise<DatabricksAuthorityResult> {
  if (!serviceClient) return { ok: false, code: "backend_error" };

  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return { ok: false, code: "backend_error" };
  }

  const { data: connectionData, error: connectionError } = await serviceClient
    .from("databricks_connections")
    .select(
      "id, workspace_id, origin, warehouse_id, auth_mode, client_id, api_key_id, needs_query, config_revision, enabled",
    )
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .maybeSingle();
  if (connectionError) return { ok: false, code: "backend_error" };
  if (!connectionData) return { ok: false, code: "not_configured" };

  const parsed = DatabricksConnectionRowSchema.safeParse(connectionData);
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || !parsed.data.enabled) {
    return { ok: false, code: "backend_error" };
  }

  const connection = parsed.data;
  // Check deployment authority before reading or decrypting the bound secret.
  // Admin-controlled database content alone must never choose a credential sink.
  if (!isDatabricksOriginAllowed(connection.origin)) {
    return { ok: false, code: "backend_error" };
  }

  const { data: keyData, error: keyError } = await serviceClient
    .from("api_keys")
    .select("secret, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "Databricks")
    .eq("status", "valid")
    .eq("id", connection.api_key_id)
    .maybeSingle();
  if (keyError) return { ok: false, code: "backend_error" };
  if (!keyData || keyData.status !== "valid" || typeof keyData.secret !== "string") {
    return { ok: false, code: "credential_unavailable" };
  }

  const secret = decryptSecret(keyData.secret);
  if (!secret) return { ok: false, code: "credential_unavailable" };

  const config: DatabricksSettings = {
    host: connection.origin,
    warehouseId: connection.warehouse_id,
    authMode: connection.auth_mode,
    clientId: connection.client_id ?? undefined,
    apiKeyId: connection.api_key_id,
    needsQuery: connection.needs_query,
  };

  return {
    ok: true,
    authority: {
      config,
      secret,
      authorityScope: [
        workspaceId,
        connection.id,
        connection.config_revision,
        connection.api_key_id,
      ].join(":"),
    },
  };
}
