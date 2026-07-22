/* ============================================================================
   Cloud LLM provider resolution + request builders (pure, no React).

   Client-safe exports: resolveAiProvider, aiProviderConfigured, KIND_TO_SLUG,
   DEFAULT_MODEL, AiProviderSlug, AiResolved.

   SERVER-ONLY exports (pure string helpers — no side effects, but carry
   endpoint URLs and env-var names): CLOUD_ENDPOINT, PROVIDER_ENV,
   buildCloudRequest, parseCloudResponse.
   ========================================================================== */

import type { LlmProviderKind, ModelTask, SystemSettings } from "@/lib/types";

export type AiProviderSlug = "anthropic" | "openai" | "groq" | "xai" | "mistral" | "kimi";

/** Maps LlmProviderKind → AiProviderSlug. Absent = not directly callable. */
export const KIND_TO_SLUG: Partial<Record<LlmProviderKind, AiProviderSlug>> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Groq: "groq",
  xAI: "xai",
  Mistral: "mistral",
  Kimi: "kimi",
  // Google, OpenRouter, and "Local/Custom" intentionally absent —
  // they require different auth schemes or a user-supplied base URL.
};

/** Sensible default model per slug when no SavedModel is configured. */
export const DEFAULT_MODEL: Record<AiProviderSlug, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-2-latest",
  mistral: "mistral-large-latest",
  // Kimi (Moonshot) is OpenAI-compatible. moonshot-v1-8k is the cheap, always-available
  // default; override per-workspace with a SavedModel (e.g. kimi-k2-0711-preview).
  kimi: "moonshot-v1-8k",
};

export interface AiResolved {
  provider: AiProviderSlug;
  model: string;
  /** ApiKey.id — the raw secret is NEVER held here. Resolved server-side only. */
  apiKeyId?: string;
}

export type AiProviderSettings = Pick<
  SystemSettings,
  "llmProviders" | "savedModels" | "defaultModels"
>;

/**
 * Resolve which cloud AI provider + model to use for a given task.
 *
 * Resolution order:
 *  modelId  = override.modelId → settings.defaultModels[task] → first enabled
 *             SavedModel whose defaultForTask includes task
 *  provider = savedModel.providerId → override.providerId →
 *             first enabled isDefault provider → first enabled provider
 *
 * Returns null when no enabled, supported provider is configured.
 */
export function resolveAiProvider(
  settings: AiProviderSettings,
  task: ModelTask,
  override?: { providerId?: string; modelId?: string },
): AiResolved | null {
  const llmProviders = settings.llmProviders ?? [];
  const savedModels = settings.savedModels ?? [];

  const providerSupportsTask = (provider: (typeof llmProviders)[number] | undefined) => {
    if (!provider?.enabled) return false;
    const slug = KIND_TO_SLUG[provider.kind];
    return Boolean(slug);
  };

  const usableModel = (model: (typeof savedModels)[number] | undefined) =>
    Boolean(
      model?.enabled &&
      providerSupportsTask(llmProviders.find((provider) => provider.id === model.providerId)),
    );

  // 1. Resolve modelId
  const requestedModelId = override?.modelId ?? settings.defaultModels?.[task];
  const requestedModel = requestedModelId
    ? savedModels.find((model) => model.id === requestedModelId)
    : undefined;
  const modelId = usableModel(requestedModel)
    ? requestedModel?.id
    : savedModels.find(
        (model) => usableModel(model) && model.defaultForTask?.includes(task),
      )?.id;

  // 2. Resolve SavedModel
  const savedModel = modelId ? savedModels.find((m) => m.id === modelId) : undefined;

  // Sourcing uses tool calls and must never guess a provider's default model.
  // A concrete enabled SavedModel is required; the normalized production path
  // additionally requires fresh exact-model capability evidence in the database.
  if (task === "sourcing" && !savedModel) return null;

  // 3. Resolve providerId (saved model wins over override)
  const providerId = savedModel?.providerId ?? override?.providerId;

  // 4. Resolve LlmProvider object
  let provider = providerId ? llmProviders.find((p) => p.id === providerId) : undefined;
  if (!providerSupportsTask(provider)) {
    provider =
      llmProviders.find((p) => providerSupportsTask(p) && p.isDefault) ??
      llmProviders.find((p) => providerSupportsTask(p));
  }

  if (!provider || !providerSupportsTask(provider)) return null;

  const slug = KIND_TO_SLUG[provider.kind];
  if (!slug) return null;

  const model = savedModel?.modelName ?? DEFAULT_MODEL[slug];

  return { provider: slug, model, apiKeyId: provider.apiKeyId };
}

/** True when at least one enabled provider has a supported slug. */
export function aiProviderConfigured(settings: SystemSettings): boolean {
  return (settings.llmProviders ?? []).some(
    (p) => p.enabled && KIND_TO_SLUG[p.kind] !== undefined,
  );
}

/* ============================================================================
   SERVER-ONLY pure helpers
   ========================================================================== */

const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
// Kimi Code subscription credentials use this separate official endpoint.
const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";

/**
 * Resolve Kimi's credential-bearing egress origin. This is deliberately an
 * exact allowlist, not a generic URL safety check: even a public HTTPS host is
 * not authority to receive a decrypted Kimi key. Invalid configuration fails
 * closed during module initialization before a request can be built.
 */
export function resolveKimiBaseUrl(configured: string | undefined): string {
  if (configured === undefined || configured === "") return DEFAULT_KIMI_BASE_URL;
  if (configured !== configured.trim() || configured.includes("\\")) {
    throw new Error("invalid KIMI_BASE_URL");
  }

  // Preserve the prior harmless trailing-slash normalization while rejecting
  // every other textual rewrite (userinfo, ports, encoded paths, or lookalike
  // hosts). Parsing first also makes query and fragment rejection explicit.
  const candidate = configured.replace(/\/+$/, "");
  let endpoint: URL;
  try {
    endpoint = new URL(candidate);
  } catch {
    throw new Error("invalid KIMI_BASE_URL");
  }
  const canonical = `${endpoint.origin}${endpoint.pathname}`;
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.port !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    candidate !== canonical
  ) {
    throw new Error("invalid KIMI_BASE_URL");
  }
  // Return a compile-time literal rather than the validated input itself so a
  // credential-bearing request can never inherit attacker-controlled URL text.
  if (canonical === DEFAULT_KIMI_BASE_URL) return DEFAULT_KIMI_BASE_URL;
  if (canonical === KIMI_CODE_BASE_URL) return KIMI_CODE_BASE_URL;
  throw new Error("invalid KIMI_BASE_URL");
}

// Non-NEXT_PUBLIC env is undefined in the browser bundle, where the safe
// default is used. Credential-bearing requests are server-only.
export const KIMI_BASE_URL = resolveKimiBaseUrl(process.env.KIMI_BASE_URL);

const STATIC_ENDPOINT_PROFILE: Omit<Record<AiProviderSlug, string>, "kimi"> = {
  anthropic: "anthropic_messages_2023_06_01",
  openai: "openai_chat_completions_v1",
  groq: "groq_chat_completions_v1",
  xai: "xai_chat_completions_v1",
  mistral: "mistral_chat_completions_v1",
};

/**
 * Return the exact reviewed endpoint profile implemented by this process.
 * Kimi Code remains available to the legacy interactive chat path, but it is
 * deliberately distinct from the Moonshot profile approved by the durable AI
 * runtime-binding catalog. A binding can therefore never attest one origin
 * while sending its credential to the other.
 */
export function providerRuntimeEndpointProfile(
  provider: AiProviderSlug,
  kimiBaseUrl: string = KIMI_BASE_URL,
): string {
  if (provider !== "kimi") return STATIC_ENDPOINT_PROFILE[provider];
  return kimiBaseUrl === DEFAULT_KIMI_BASE_URL
    ? "moonshot_chat_completions_v1"
    : "kimi_code_chat_completions_v1";
}

export function providerRuntimeMatchesEndpointProfile(
  provider: AiProviderSlug,
  endpointProfile: string,
): boolean {
  return providerRuntimeEndpointProfile(provider) === endpointProfile;
}

export const CLOUD_ENDPOINT: Record<AiProviderSlug, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  kimi: `${KIMI_BASE_URL}/chat/completions`,
};

export const PROVIDER_ENV: Record<AiProviderSlug, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  kimi: "KIMI_API_KEY",
};

/** Canonical api_keys.provider value for each callable cloud provider. The
 * server uses this to bind a caller-selected key id to the intended egress
 * provider before decrypting it. */
export const VAULT_PROVIDER: Record<AiProviderSlug, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  groq: "Groq",
  xai: "xAI",
  mistral: "Mistral",
  kimi: "Kimi (Moonshot)",
};

/**
 * Build the fetch args for a cloud provider call.
 *
 * Anthropic uses the Messages API (x-api-key + anthropic-version header).
 * All others use OpenAI-compatible chat/completions (Bearer token).
 */
export function buildCloudRequest(
  provider: AiProviderSlug,
  model: string,
  system: string,
  prompt: string,
  key: string,
  /** Output ceiling. Defaults to 2048 — enough headroom for JSON drafts, CV
   *  analysis and screening-question generation that 1024 silently truncated. */
  maxTokens = 2048,
): { url: string; headers: Record<string, string>; body: string } {
  if (provider === "anthropic") {
    return {
      url: CLOUD_ENDPOINT.anthropic,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    };
  }

  return {
    url: CLOUD_ENDPOINT[provider],
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  };
}

/**
 * Extract the generated text from a cloud provider JSON response.
 * Always returns a string ("" when the expected field is absent).
 */
export function parseCloudResponse(provider: AiProviderSlug, json: unknown): string {
  if (provider === "anthropic") {
    const text = (json as { content?: { text?: unknown }[] } | null)?.content?.[0]?.text;
    return typeof text === "string" ? text : "";
  }
  const content = (json as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
