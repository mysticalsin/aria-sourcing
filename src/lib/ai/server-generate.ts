import "server-only";

/**
 * Server-side cloud LLM completion for autonomous loop cron routes.
 * Prefers deployment env credentials (Fly secrets). When a workspaceId is
 * provided, falls back to that workspace's vault keys after env auth failures
 * (or when no env key exists) — never cross-tenant.
 *
 * Vault is resolved lazily (only when needed) so public-demo paths that never
 * pass workspaceId do not touch the service-role client.
 */

import {
  buildCloudRequest,
  DEFAULT_MODEL,
  parseCloudResponse,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";
import { resolveStoredLlmKeyForWorkspace } from "@/lib/ai/vault-secret";

const PREFERRED: AiProviderSlug[] = ["kimi", "anthropic", "openai", "groq", "mistral", "xai", "deepseek"];

export type ServerGenerateResult = { ok: true; text: string; provider: AiProviderSlug } | { ok: false; reason: string };

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

async function tryOneProvider(
  slug: AiProviderSlug,
  key: string,
  input: { system: string; prompt: string; maxTokens?: number },
): Promise<ServerGenerateResult | { ok: false; reason: string; authFailure: true }> {
  const model = DEFAULT_MODEL[slug];
  const { url, headers, body } = buildCloudRequest(
    slug,
    model,
    input.system,
    input.prompt,
    key,
    input.maxTokens ?? 2048,
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const reason = `Upstream ${slug} HTTP ${res.status}`;
      if (isAuthFailure(res.status)) return { ok: false, reason, authFailure: true };
      return { ok: false, reason };
    }
    const json = await res.json().catch(() => null);
    const text = parseCloudResponse(slug, json);
    if (!text?.trim()) return { ok: false, reason: "Empty model response." };
    return { ok: true, text: text.trim(), provider: slug };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Model unreachable." };
  }
}

export async function serverGenerateText(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** When set, workspace vault keys are tried after env keys (auth failover). */
  workspaceId?: string;
}): Promise<ServerGenerateResult> {
  const workspaceId = input.workspaceId?.trim() || "";
  const failures: string[] = [];
  let attempted = 0;

  for (const slug of PREFERRED) {
    const envKey = (process.env[PROVIDER_ENV[slug]] ?? "").trim();
    let envAuthFailed = false;

    if (envKey) {
      attempted += 1;
      const result = await tryOneProvider(slug, envKey, input);
      if (result.ok) return result;
      failures.push(result.reason);
      if ("authFailure" in result && result.authFailure) {
        envAuthFailed = true;
      } else {
        return { ok: false, reason: result.reason };
      }
    }

    // Lazy vault: only touch service-role when env missing or env auth failed.
    if (workspaceId && (!envKey || envAuthFailed)) {
      const vaultKey = await resolveStoredLlmKeyForWorkspace(workspaceId, slug);
      if (vaultKey?.trim() && vaultKey.trim() !== envKey) {
        attempted += 1;
        const result = await tryOneProvider(slug, vaultKey.trim(), input);
        if (result.ok) return result;
        failures.push(result.reason);
        if ("authFailure" in result && result.authFailure) {
          continue;
        }
        return { ok: false, reason: result.reason };
      }
    }
  }

  if (attempted === 0) {
    return { ok: false, reason: "No cloud LLM API key configured on the server." };
  }
  return { ok: false, reason: failures.join("; ") || "All configured LLM providers failed." };
}
