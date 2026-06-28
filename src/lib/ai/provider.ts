/* ============================================================================
   Cloud LLM provider resolution + request builders (pure, no React).

   Client-safe exports: resolveAiProvider, aiProviderConfigured, KIND_TO_SLUG,
   DEFAULT_MODEL, AiProviderSlug, AiResolved.

   SERVER-ONLY exports (pure string helpers — no side effects, but carry
   endpoint URLs and env-var names): CLOUD_ENDPOINT, PROVIDER_ENV,
   buildCloudRequest, parseCloudResponse.
   ========================================================================== */

import type { LlmProviderKind, ModelTask, SystemSettings } from "@/lib/types";

export type AiProviderSlug = "anthropic" | "openai" | "groq" | "xai" | "mistral";

/** Maps LlmProviderKind → AiProviderSlug. Absent = not directly callable. */
export const KIND_TO_SLUG: Partial<Record<LlmProviderKind, AiProviderSlug>> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Groq: "groq",
  xAI: "xai",
  Mistral: "mistral",
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
};

export interface AiResolved {
  provider: AiProviderSlug;
  model: string;
  /** ApiKey.id — the raw secret is NEVER held here. Resolved server-side only. */
  apiKeyId?: string;
}

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
  settings: SystemSettings,
  task: ModelTask,
  override?: { providerId?: string; modelId?: string },
): AiResolved | null {
  const llmProviders = settings.llmProviders ?? [];
  const savedModels = settings.savedModels ?? [];

  // 1. Resolve modelId
  const modelId =
    override?.modelId ??
    settings.defaultModels?.[task] ??
    savedModels.find((m) => m.enabled && m.defaultForTask?.includes(task))?.id;

  // 2. Resolve SavedModel
  const savedModel = modelId ? savedModels.find((m) => m.id === modelId) : undefined;

  // 3. Resolve providerId (saved model wins over override)
  const providerId = savedModel?.providerId ?? override?.providerId;

  // 4. Resolve LlmProvider object
  let provider = providerId ? llmProviders.find((p) => p.id === providerId) : undefined;
  if (!provider) {
    provider =
      llmProviders.find((p) => p.enabled && p.isDefault) ??
      llmProviders.find((p) => p.enabled);
  }

  if (!provider?.enabled) return null;

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

export const CLOUD_ENDPOINT: Record<AiProviderSlug, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

export const PROVIDER_ENV: Record<AiProviderSlug, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
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
        max_tokens: 1024,
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
    return (
      (json as { content?: { text?: string }[] } | null)?.content?.[0]?.text ?? ""
    );
  }
  return (
    (json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]
      ?.message?.content ?? ""
  );
}
