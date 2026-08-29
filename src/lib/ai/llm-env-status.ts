/**
 * Probe Fly / process-env LLM API keys for live auth (presence ≠ usable).
 * Mirrors scripts/probe-fly-llm-auth.sh preferred set: kimi, anthropic, openai, deepseek.
 * Never returns secret material — only status labels.
 */

import { isLiveLlmKeyProvider, probeLlmApiKey, type LiveLlmKeyProvider } from "@/lib/ai/key-probe";
import { PROVIDER_ENV, VAULT_PROVIDER, type AiProviderSlug } from "@/lib/ai/provider";

/** Preferred env providers for ops/status (same order as probe-fly-llm-auth.sh). */
export const LLM_ENV_STATUS_SLUGS = ["kimi", "anthropic", "openai", "deepseek"] as const;

export type LlmEnvStatusSlug = (typeof LLM_ENV_STATUS_SLUGS)[number];

export type LlmEnvProviderState =
  | "absent"
  | "ok"
  | "auth_dead"
  | "error"
  | `http_${number}`;

export type LlmEnvProviderResult = {
  slug: LlmEnvStatusSlug;
  env: string;
  state: LlmEnvProviderState;
  httpStatus: number | null;
};

export type LlmEnvAuthStatus = "llm_auth_ok" | "llm_auth_dead" | "llm_keys_absent";

export type LlmEnvStatusReport = {
  status: LlmEnvAuthStatus;
  keysPresent: boolean;
  firstLiveProvider: LlmEnvStatusSlug | null;
  providers: LlmEnvProviderResult[];
  probedAt: string;
  cached: boolean;
};

const CACHE_TTL_MS = 60_000;
let cachedReport: LlmEnvStatusReport | null = null;
let cachedUntil = 0;

/** Test hook — clear process cache between cases. */
export function clearLlmEnvStatusCache(): void {
  cachedReport = null;
  cachedUntil = 0;
}

function vaultForSlug(slug: LlmEnvStatusSlug): LiveLlmKeyProvider {
  const vault = VAULT_PROVIDER[slug as AiProviderSlug];
  if (!isLiveLlmKeyProvider(vault)) {
    throw new Error(`Unexpected vault provider for ${slug}`);
  }
  return vault;
}

function classifyProbe(
  valid: boolean,
  detail: string,
  httpHint: number | null,
): { state: LlmEnvProviderState; httpStatus: number | null } {
  const httpMatch = /HTTP (\d{3})/.exec(detail);
  const httpStatus = httpHint ?? (httpMatch ? Number(httpMatch[1]) : null);
  if (valid) return { state: "ok", httpStatus: httpStatus ?? 200 };
  if (httpStatus === 401 || httpStatus === 403) return { state: "auth_dead", httpStatus };
  if (httpStatus != null) return { state: `http_${httpStatus}`, httpStatus };
  return { state: "error", httpStatus: null };
}

async function probeOne(
  slug: LlmEnvStatusSlug,
  fetchImpl: typeof fetch,
): Promise<LlmEnvProviderResult> {
  const env = PROVIDER_ENV[slug as AiProviderSlug];
  const key = (process.env[env] ?? "").trim();
  if (!key) {
    return { slug, env, state: "absent", httpStatus: null };
  }
  try {
    const vault = vaultForSlug(slug);
    const result = await probeLlmApiKey(vault, key, fetchImpl);
    const classified = classifyProbe(result.valid, result.detail, null);
    return { slug, env, ...classified };
  } catch {
    return { slug, env, state: "error", httpStatus: null };
  }
}

function summarize(providers: LlmEnvProviderResult[], probedAt: string, cached: boolean): LlmEnvStatusReport {
  let attempted = 0;
  let ok = 0;
  let firstLive: LlmEnvStatusSlug | null = null;
  for (const p of providers) {
    if (p.state === "absent") continue;
    attempted += 1;
    if (p.state === "ok") {
      ok += 1;
      if (!firstLive) firstLive = p.slug;
    }
  }
  const keysPresent = attempted > 0;
  const status: LlmEnvAuthStatus =
    ok > 0 ? "llm_auth_ok" : attempted === 0 ? "llm_keys_absent" : "llm_auth_dead";
  return {
    status,
    keysPresent,
    firstLiveProvider: firstLive,
    providers,
    probedAt,
    cached,
  };
}

/**
 * Probe preferred process-env LLM keys. Results are cached briefly so Settings
 * refreshes and concurrent admin polls do not hammer upstream /models.
 */
export async function probeLlmEnvStatus(opts?: {
  fetchImpl?: typeof fetch;
  /** Bypass cache (still subject to route rate limits). */
  force?: boolean;
  now?: number;
}): Promise<LlmEnvStatusReport> {
  const now = opts?.now ?? Date.now();
  if (!opts?.force && cachedReport && now < cachedUntil) {
    return { ...cachedReport, cached: true };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const providers: LlmEnvProviderResult[] = [];
  for (const slug of LLM_ENV_STATUS_SLUGS) {
    providers.push(await probeOne(slug, fetchImpl));
  }
  const report = summarize(providers, new Date(now).toISOString(), false);
  cachedReport = report;
  cachedUntil = now + CACHE_TTL_MS;
  return report;
}
