import { z } from "zod";

import {
  providerRuntimeMatchesEndpointProfile,
  type AiProviderSlug,
} from "@/lib/ai/provider";

export type AiRuntimePurpose = "requisition_parse" | "sourcing";

export interface AiRuntimeBindingRpcClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ActiveAiRuntimeBinding {
  workspaceId: string;
  bindingSetId: string;
  setSha256: string;
  bindingId: string;
  purpose: AiRuntimePurpose;
  provider: AiProviderSlug;
  credentialProvider: string;
  endpointProfile: string;
  model: string;
  apiKeyId: string;
  catalogRevision: number;
  configSha256: string;
}

export type ActiveAiRuntimeBindingResult =
  | { ok: true; binding: ActiveAiRuntimeBinding }
  | {
      ok: false;
      code:
        | "not_configured"
        | "credential_unavailable"
        | "authority_invalid"
        | "backend_error";
    };

const UuidSchema = z.string().uuid();
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const PurposeSchema = z.enum(["requisition_parse", "sourcing"]);
const ProviderSchema = z.enum(["anthropic", "openai", "groq", "xai", "mistral", "kimi"]);

const ConfiguredBindingSchema = z
  .object({
    status: z.literal("configured"),
    workspace_id: UuidSchema,
    binding_set_id: UuidSchema,
    set_sha256: HashSchema,
    binding_id: UuidSchema,
    purpose: PurposeSchema,
    provider_slug: ProviderSchema,
    credential_provider: z.string().trim().min(1).max(80),
    endpoint_profile: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
    model_name: z.string().trim().min(1).max(200),
    api_key_id: UuidSchema,
    catalog_revision: z.number().int().positive(),
    config_sha256: HashSchema,
  })
  .strict();

const FailureSchema = z
  .object({
    status: z.enum(["not_configured", "credential_unavailable", "authority_invalid"]),
  })
  .strict();

/**
 * Resolve one database-approved AI execution binding. The database response is
 * treated as untrusted input even though the RPC is service-only. This module
 * never reads, decrypts, logs, or returns the credential value itself.
 */
export async function resolveActiveAiRuntimeBinding(
  client: AiRuntimeBindingRpcClient,
  workspaceId: string,
  purpose: AiRuntimePurpose,
): Promise<ActiveAiRuntimeBindingResult> {
  if (!UuidSchema.safeParse(workspaceId).success || !PurposeSchema.safeParse(purpose).success) {
    return { ok: false, code: "backend_error" };
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc("resolve_active_ai_runtime_binding", {
      p_workspace_id: workspaceId,
      p_purpose: purpose,
    });
  } catch {
    return { ok: false, code: "backend_error" };
  }

  if (response.error) return { ok: false, code: "backend_error" };

  const failure = FailureSchema.safeParse(response.data);
  if (failure.success) return { ok: false, code: failure.data.status };

  const parsed = ConfiguredBindingSchema.safeParse(response.data);
  if (!parsed.success) return { ok: false, code: "backend_error" };

  const data = parsed.data;
  if (data.workspace_id !== workspaceId || data.purpose !== purpose) {
    return { ok: false, code: "backend_error" };
  }
  if (!providerRuntimeMatchesEndpointProfile(data.provider_slug, data.endpoint_profile)) {
    return { ok: false, code: "authority_invalid" };
  }

  return {
    ok: true,
    binding: {
      workspaceId: data.workspace_id,
      bindingSetId: data.binding_set_id,
      setSha256: data.set_sha256,
      bindingId: data.binding_id,
      purpose: data.purpose,
      provider: data.provider_slug,
      credentialProvider: data.credential_provider,
      endpointProfile: data.endpoint_profile,
      model: data.model_name,
      apiKeyId: data.api_key_id,
      catalogRevision: data.catalog_revision,
      configSha256: data.config_sha256,
    },
  };
}
