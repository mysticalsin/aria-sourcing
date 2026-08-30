import "server-only";

/**
 * Server-side cloud LLM completion for autonomous loop cron routes.
 * Prefers deployment env credentials (Fly secrets). When a workspaceId is
 * provided, falls back to that workspace's vault keys after env auth failures
 * (or when no env key exists) — never cross-tenant.
 *
 * Vault is resolved lazily (only when needed) so public-demo paths that never
 * pass workspaceId do not touch the service-role client.
 *
 * Auth-dead env providers (401/403) are skipped for a short TTL so sequential
 * multi-agent critics do not re-probe a known-bad Fly KIMI_API_KEY on every call.
 * Retryable non-auth failures (429/5xx/timeout) continue to the next provider.
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

/** Skip re-probing env keys that just returned 401/403 (ms). */
const ENV_AUTH_DEAD_TTL_MS = 5 * 60_000;
const envAuthDeadUntil = new Map<AiProviderSlug, number>();

export type ServerGenerateResult = { ok: true; text: string; provider: AiProviderSlug } | { ok: false; reason: string };

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

/** Transient upstream failures — try the next provider instead of aborting. */
function isRetryableUpstream(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function markEnvAuthDead(slug: AiProviderSlug): void {
  envAuthDeadUntil.set(slug, Date.now() + ENV_AUTH_DEAD_TTL_MS);
}

function isEnvAuthDead(slug: AiProviderSlug): boolean {
  const until = envAuthDeadUntil.get(slug);
  if (until == null) return false;
  if (Date.now() >= until) {
    envAuthDeadUntil.delete(slug);
    return false;
  }
  return true;
}

/** Test/ops hook — clear auth-dead skip cache. */
export function clearServerGenerateAuthDeadCache(): void {
  envAuthDeadUntil.clear();
}

async function tryOneProvider(
  slug: AiProviderSlug,
  key: string,
  input: { system: string; prompt: string; maxTokens?: number },
): Promise<
  | ServerGenerateResult
  | { ok: false; reason: string; authFailure: true }
  | { ok: false; reason: string; retryable: true }
> {
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
      if (isRetryableUpstream(res.status)) return { ok: false, reason, retryable: true };
      return { ok: false, reason };
    }
    const json = await res.json().catch(() => null);
    const text = parseCloudResponse(slug, json);
    if (!text?.trim()) return { ok: false, reason: "Empty model response.", retryable: true };
    return { ok: true, text: text.trim(), provider: slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model unreachable.";
    // Timeouts / disconnects are retryable across providers.
    return { ok: false, reason: message, retryable: true };
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
    let tryVault = !envKey || isEnvAuthDead(slug);
    const skipEnv = Boolean(envKey) && isEnvAuthDead(slug);

    if (envKey && !skipEnv) {
      attempted += 1;
      const result = await tryOneProvider(slug, envKey, input);
      if (result.ok) return result;
      failures.push(result.reason);
      if ("authFailure" in result && result.authFailure) {
        markEnvAuthDead(slug);
        tryVault = true;
      } else if ("retryable" in result && result.retryable) {
        tryVault = true;
      } else {
        // Definitive client error (e.g. 400) — do not burn other providers on bad request shape.
        return { ok: false, reason: result.reason };
      }
    } else if (skipEnv) {
      failures.push(`Upstream ${slug} skipped (env auth recently failed)`);
      tryVault = true;
    }

    // Lazy vault: only touch service-role when env missing, auth-dead, or env failed retryably.
    if (workspaceId && tryVault) {
      const vaultKey = await resolveStoredLlmKeyForWorkspace(workspaceId, slug);
      if (vaultKey?.trim() && vaultKey.trim() !== envKey) {
        attempted += 1;
        const result = await tryOneProvider(slug, vaultKey.trim(), input);
        if (result.ok) return result;
        failures.push(result.reason);
        if ("authFailure" in result && result.authFailure) {
          continue;
        }
        if ("retryable" in result && result.retryable) {
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
