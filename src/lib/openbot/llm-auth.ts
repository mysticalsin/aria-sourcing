/**
 * OpenBot LLM proxy auth + Aria provider key resolution.
 *
 * OpenBot must use the **same** cloud API key Aria uses — not a separate
 * model key. Configure OpenBot with:
 *   OPENAI_BASE_URL=https://<aria>/api/openbot/v1
 *   OPENAI_API_KEY=<same value as Aria OPENAI_API_KEY (or other PROVIDER_ENV)>
 *
 * Aria authenticates the Bearer token against its configured PROVIDER_ENV
 * keys and spends that same key upstream. An optional OPENBOT_LLM_PROXY_TOKEN
 * remains as an alternate service auth that still spends Aria's keys.
 *
 * Cloudflare Workers AI (`CLOUDFLARE_WORKERS_AI_SECRET` +
 * `CLOUDFLARE_WORKERS_AI_URL`) is also same-key eligible when configured —
 * OpenBot presents that secret as OPENAI_API_KEY and Aria spends it on the
 * intake-llm worker.
 */

import {
  CLOUD_ENDPOINT,
  DEFAULT_MODEL,
  PROVIDER_ENV,
  type AiProviderSlug,
} from "@/lib/ai/provider";
import { timingSafeEqual } from "node:crypto";

export const OPENBOT_LLM_SLUG_ORDER: AiProviderSlug[] = [
  "openai",
  "anthropic",
  "groq",
  "mistral",
  "xai",
  "kimi",
  "deepseek",
  "nvidia",
];

export const OPENBOT_CF_WORKERS_AI_SLUG = "cloudflare_workers_ai" as const;

export type OpenBotLlmSlug = AiProviderSlug | typeof OPENBOT_CF_WORKERS_AI_SLUG;

export type OpenBotLlmProvider = {
  slug: OpenBotLlmSlug;
  key: string;
  /** Upstream URL for non-OpenAI-shape providers (e.g. CF Workers AI). */
  endpoint?: string;
};

const CF_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function secretsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function optionalProxyToken(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.OPENBOT_LLM_PROXY_TOKEN ??
    env.ARIA_OPENBOT_LLM_TOKEN ??
    ""
  ).trim();
}

function cloudflareWorkersAiProvider(
  env: NodeJS.ProcessEnv = process.env,
): OpenBotLlmProvider | null {
  const key = (env.CLOUDFLARE_WORKERS_AI_SECRET ?? "").trim();
  const endpoint = (env.CLOUDFLARE_WORKERS_AI_URL ?? "").trim().replace(/\/+$/, "");
  if (!key || !endpoint) return null;
  return { slug: OPENBOT_CF_WORKERS_AI_SLUG, key, endpoint };
}

/** Every Aria cloud LLM key present in env (same PROVIDER_ENV as hermes/chat). */
export function listAriaLlmProviders(
  env: NodeJS.ProcessEnv = process.env,
): OpenBotLlmProvider[] {
  const out: OpenBotLlmProvider[] = [];
  for (const slug of OPENBOT_LLM_SLUG_ORDER) {
    const key = (env[PROVIDER_ENV[slug]] ?? "").trim();
    if (key && CLOUD_ENDPOINT[slug]) out.push({ slug, key });
  }
  const cf = cloudflareWorkersAiProvider(env);
  if (cf) out.push(cf);
  return out;
}

/**
 * Resolve which Aria provider OpenBot should spend.
 * Prefer OPENBOT_LLM_PROVIDER when set and keyed; else first configured PROVIDER_ENV.
 */
export function resolveAriaLlmProvider(
  env: NodeJS.ProcessEnv = process.env,
): OpenBotLlmProvider | null {
  const preferred = (env.OPENBOT_LLM_PROVIDER ?? "").trim().toLowerCase();
  const configured = listAriaLlmProviders(env);
  if (configured.length === 0) return null;
  if (preferred) {
    const hit = configured.find((p) => p.slug === preferred);
    if (hit) return hit;
  }
  return configured[0] ?? null;
}

export function openBotLlmModelFor(
  provider: OpenBotLlmProvider,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = (env.OPENBOT_LLM_MODEL ?? "").trim();
  if (override) return override;
  if (provider.slug === OPENBOT_CF_WORKERS_AI_SLUG) return CF_DEFAULT_MODEL;
  return DEFAULT_MODEL[provider.slug];
}

export function isCloudflareWorkersAiProvider(
  provider: OpenBotLlmProvider,
): boolean {
  return provider.slug === OPENBOT_CF_WORKERS_AI_SLUG;
}

export type OpenBotLlmAuthFailureReason = "missing_aria_key" | "unauthorized";

export type OpenBotLlmAuthResult =
  | { ok: true; provider: OpenBotLlmProvider; auth: "aria_api_key" | "proxy_token" }
  | { ok: false; reason: OpenBotLlmAuthFailureReason };

/**
 * Authorize an OpenBot LLM request.
 * Primary: Bearer === Aria's configured provider API key (same key Aria spends).
 * Optional: Bearer === OPENBOT_LLM_PROXY_TOKEN, still spends Aria's provider key.
 */
export function authorizeOpenBotLlm(
  authorizationHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): OpenBotLlmAuthResult {
  const configured = listAriaLlmProviders(env);
  if (configured.length === 0) {
    return { ok: false, reason: "missing_aria_key" };
  }

  const auth = (authorizationHeader ?? "").trim();
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { ok: false, reason: "unauthorized" };

  for (const provider of configured) {
    if (secretsEqual(bearer, provider.key)) {
      return { ok: true, provider, auth: "aria_api_key" };
    }
  }

  const proxy = optionalProxyToken(env);
  if (proxy && secretsEqual(bearer, proxy)) {
    const provider = resolveAriaLlmProvider(env);
    if (!provider) return { ok: false, reason: "missing_aria_key" };
    return { ok: true, provider, auth: "proxy_token" };
  }

  return { ok: false, reason: "unauthorized" };
}

export function openBotLlmReadyMessage(
  reason: OpenBotLlmAuthFailureReason | "not_ready",
): string {
  if (reason === "missing_aria_key" || reason === "not_ready") {
    return "No Aria LLM provider API key is configured (set OPENAI_API_KEY or another PROVIDER_ENV key).";
  }
  return "Unauthorized.";
}
