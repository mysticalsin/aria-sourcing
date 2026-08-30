/**
 * Live API-key authentication probes for LLM vault providers.
 * Cheap auth checks (models list / tiny completion) — never logs the secret.
 * Network/timeout failures fall back to format validation at the call site.
 */

import { DEFAULT_MODEL, type AiProviderSlug } from "@/lib/ai/provider";
import { validateApiKeyFormat } from "@/lib/providers";

export type LlmKeyProbeResult = { valid: boolean; detail: string };

const TIMEOUT_MS = 12_000;

/** api_keys.provider values that support a live upstream probe. */
export const LIVE_LLM_KEY_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "Groq",
  "xAI",
  "Mistral",
  "Kimi (Moonshot)",
  "DeepSeek",
  "NVIDIA NIM",
] as const;

export type LiveLlmKeyProvider = (typeof LIVE_LLM_KEY_PROVIDERS)[number];

export function isLiveLlmKeyProvider(provider: string): provider is LiveLlmKeyProvider {
  return (LIVE_LLM_KEY_PROVIDERS as readonly string[]).includes(provider);
}

const SLUG_FOR: Record<LiveLlmKeyProvider, AiProviderSlug> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Groq: "groq",
  xAI: "xai",
  Mistral: "mistral",
  "Kimi (Moonshot)": "kimi",
  DeepSeek: "deepseek",
  "NVIDIA NIM": "nvidia",
};

function kimiBase(): string {
  return (process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
}

function deepseekBase(): string {
  return (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
}

function nvidiaNimBase(): string {
  return (
    process.env.NVIDIA_NIM_BASE_URL ||
    process.env.NIM_BASE_URL ||
    "https://integrate.api.nvidia.com/v1"
  ).replace(/\/+$/, "");
}

function modelsUrl(slug: AiProviderSlug): string {
  switch (slug) {
    case "anthropic":
      return "https://api.anthropic.com/v1/models";
    case "openai":
      return "https://api.openai.com/v1/models";
    case "groq":
      return "https://api.groq.com/openai/v1/models";
    case "xai":
      return "https://api.x.ai/v1/models";
    case "mistral":
      return "https://api.mistral.ai/v1/models";
    case "kimi":
      return `${kimiBase()}/models`;
    case "deepseek":
      return `${deepseekBase()}/models`;
    case "nvidia":
      return `${nvidiaNimBase()}/models`;
    case "cloudflare":
      return "";
  }
}

function authHeaders(slug: AiProviderSlug, key: string): Record<string, string> {
  if (slug === "anthropic") {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
  }
  return { Authorization: `Bearer ${key}` };
}

/**
 * Probe an LLM provider key with a cheap authenticated GET /models (or equivalent).
 * 401/403 → invalid. 2xx → valid. Other statuses → valid if auth clearly accepted,
 * otherwise invalid with detail. Transport failures throw for the caller to fall back.
 *
 * NVIDIA NIM's hosted GET /models is public (returns 200 with no/invalid auth), so
 * NVIDIA always probes via a tiny chat completion instead.
 */
export async function probeLlmApiKey(
  provider: LiveLlmKeyProvider,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmKeyProbeResult> {
  const slug = SLUG_FOR[provider];

  // Hosted NIM catalog listing does not authenticate — never use it as a key probe.
  if (slug === "nvidia") {
    return probeLlmWithMiniCompletion(provider, slug, key, fetchImpl);
  }

  const url = modelsUrl(slug);
  const res = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders(slug, key),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => "");
    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      valid: false,
      detail: snippet
        ? `${provider} rejected this key (HTTP ${res.status}): ${snippet}`
        : `${provider} rejected this key (HTTP ${res.status}).`,
    };
  }

  if (res.ok) {
    return { valid: true, detail: `${provider} key accepted (HTTP ${res.status}).` };
  }

  // Some gateways return 404 on /models but still authenticated — try a tiny chat call.
  if (res.status === 404 || res.status === 405) {
    return probeLlmWithMiniCompletion(provider, slug, key, fetchImpl);
  }

  const body = await res.text().catch(() => "");
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  // Rate limits / billing / not-found-model still prove the key authenticated.
  if (res.status === 429 || res.status === 402 || res.status === 400) {
    return {
      valid: true,
      detail: snippet
        ? `${provider} authenticated (HTTP ${res.status}): ${snippet}`
        : `${provider} authenticated (HTTP ${res.status}).`,
    };
  }

  return {
    valid: false,
    detail: snippet
      ? `${provider} returned unexpected HTTP ${res.status}: ${snippet}`
      : `${provider} returned unexpected HTTP ${res.status}.`,
  };
}

async function probeLlmWithMiniCompletion(
  provider: LiveLlmKeyProvider,
  slug: AiProviderSlug,
  key: string,
  fetchImpl: typeof fetch,
): Promise<LlmKeyProbeResult> {
  const model = DEFAULT_MODEL[slug];
  if (slug === "anthropic") {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        ...authHeaders(slug, key),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, detail: `${provider} rejected this key (HTTP ${res.status}).` };
    }
    if (res.ok || res.status === 400 || res.status === 429 || res.status === 402) {
      return { valid: true, detail: `${provider} key accepted (HTTP ${res.status}).` };
    }
    return { valid: false, detail: `${provider} returned unexpected HTTP ${res.status}.` };
  }

  const chatUrl = modelsUrl(slug).replace(/\/models$/, "/chat/completions");
  const res = await fetchImpl(chatUrl, {
    method: "POST",
    headers: {
      ...authHeaders(slug, key),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, detail: `${provider} rejected this key (HTTP ${res.status}).` };
  }
  // Hosted NIM returns 410 when a catalog model is EOL — that is not an auth signal.
  if (res.status === 410) {
    return {
      valid: false,
      detail: `${provider} probe model is unavailable (HTTP 410). Pick a live model in Saved models, or check NVIDIA_NIM_BASE_URL.`,
    };
  }
  if (res.ok || res.status === 400 || res.status === 429 || res.status === 402) {
    return { valid: true, detail: `${provider} key accepted (HTTP ${res.status}).` };
  }
  return { valid: false, detail: `${provider} returned unexpected HTTP ${res.status}.` };
}

/** Live probe with format-only fallback when the provider is unreachable. */
export async function testLlmApiKey(
  provider: string,
  value: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmKeyProbeResult> {
  const fmt = validateApiKeyFormat(provider, value);
  if (!fmt.valid) return fmt;
  if (!isLiveLlmKeyProvider(provider)) {
    return { valid: fmt.valid, detail: `${fmt.detail} (format check only — no live probe for this provider).` };
  }
  try {
    return await probeLlmApiKey(provider, value, fetchImpl);
  } catch {
    return {
      valid: fmt.valid,
      detail: `${fmt.detail} ${provider} was unreachable, format check only.`,
    };
  }
}
