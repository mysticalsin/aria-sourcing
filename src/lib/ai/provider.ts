/* ============================================================================
   Cloud LLM provider resolution + request builders (pure, no React).

   Client-safe exports: resolveAiProvider, aiProviderConfigured, KIND_TO_SLUG,
   DEFAULT_MODEL, AiProviderSlug, AiResolved.

   SERVER-ONLY exports (pure string helpers — no side effects, but carry
   endpoint URLs and env-var names): CLOUD_ENDPOINT, PROVIDER_ENV,
   buildCloudRequest, parseCloudResponse.
   ========================================================================== */

import type { LlmProviderKind, ModelTask, SystemSettings } from "@/lib/types";
import type { HermesTask } from "./hermes";

export type AiProviderSlug = "anthropic" | "openai" | "groq" | "xai" | "mistral" | "kimi" | "local";

/** Maps LlmProviderKind → AiProviderSlug. Absent = not directly callable. */
export const KIND_TO_SLUG: Partial<Record<LlmProviderKind, AiProviderSlug>> = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Groq: "groq",
  xAI: "xai",
  Mistral: "mistral",
  Kimi: "kimi",
  "Local/Custom": "local",
  // Google and OpenRouter are not directly callable here.
};

/** Sensible default model per slug when no SavedModel is configured. */
export const DEFAULT_MODEL: Record<AiProviderSlug, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-2-latest",
  mistral: "mistral-large-latest",
  // Kimi (Moonshot) is OpenAI-compatible. moonshot-v1-8k is the cheap, always-available
  // default; override per-workspace with a SavedModel (e.g. kimi-k2-0711-preview).
  kimi: "moonshot-v1-8k",
  local: "",
};

export interface AiResolved {
  provider: AiProviderSlug;
  model: string;
  /** ApiKey.id — the raw secret is NEVER held here. Resolved server-side only. */
  apiKeyId?: string;
  baseUrl?: string;
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
    return Boolean(slug) && !(task === "sourcing" && slug === "kimi");
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

  const model = savedModel?.modelName ?? (slug === "local" ? provider.modelName ?? "" : DEFAULT_MODEL[slug]);

  return { provider: slug, model, apiKeyId: provider.apiKeyId, ...(slug === "local" ? { baseUrl: provider.baseUrl } : {}) };
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

// Kimi/Moonshot base URL is overridable so a non-standard gateway key (e.g. an
// "sk-kimi-…" reseller key) can point elsewhere without a code change. Server-only:
// non-NEXT_PUBLIC env is undefined in the browser bundle, but CLOUD_ENDPOINT is only
// read server-side (buildCloudRequest / tool-loop), so the default applies there.
const KIMI_BASE = (process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");

export const CLOUD_ENDPOINT: Record<AiProviderSlug, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  kimi: `${KIMI_BASE}/chat/completions`,
  local: "",
};

export const PROVIDER_ENV: Record<AiProviderSlug, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  kimi: "KIMI_API_KEY",
  local: "LOCAL_LLM_API_KEY",
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
  local: "Custom",
};

/* ---- Anthropic request shaping --------------------------------------------
   Current Claude models think adaptively by default, and thinking tokens count
   against max_tokens. Each task therefore gets an explicit effort level (how
   much the model may think) and an output ceiling with room for that thinking.
   Cheap, high-volume tasks stay at low effort; drafting gets more. */

export interface AnthropicTaskProfile {
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

export const ANTHROPIC_TASK_PROFILE: Record<HermesTask, AnthropicTaskProfile> = {
  classify: { effort: "low", maxTokens: 1024 },
  chat: { effort: "low", maxTokens: 8192 },
  outreach: { effort: "medium", maxTokens: 8192 },
  sourcing: { effort: "medium", maxTokens: 16000 },
};

/** True for models that accept output_config.effort with low/medium/high.
 *  Older ids (Sonnet/Haiku 4.5 and before) reject the field, so they keep the
 *  legacy request shape. */
export function anthropicSupportsEffort(model: string): boolean {
  return /^claude-(?:fable|mythos|opus|sonnet|haiku)-5(?:-|$)|^claude-(?:opus|sonnet)-4-[6-9](?:-|$)/.test(model);
}

/** Messages API headers. A key that is not scoped to an Anthropic workspace
 *  must name one, read server-side from ANTHROPIC_WORKSPACE_ID. */
export function anthropicHeaders(key: string): Record<string, string> {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
  };
}

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
  endpoint?: string,
  /** Anthropic only: selects the effort level and output ceiling. */
  task?: HermesTask,
): { url: string; headers: Record<string, string>; body: string } {
  if (provider === "anthropic") {
    const profile = task && anthropicSupportsEffort(model) ? ANTHROPIC_TASK_PROFILE[task] : undefined;
    return {
      url: CLOUD_ENDPOINT.anthropic,
      headers: anthropicHeaders(key),
      body: JSON.stringify({
        model,
        max_tokens: profile ? profile.maxTokens : maxTokens,
        ...(profile ? { output_config: { effort: profile.effort } } : {}),
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    };
  }

  return {
    url: endpoint ?? CLOUD_ENDPOINT[provider],
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
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
    // Thinking blocks come first and carry no `text`; join the text blocks.
    const content = (json as { content?: { text?: unknown }[] } | null)?.content;
    if (!Array.isArray(content)) return "";
    return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("");
  }
  return (
    (json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]
      ?.message?.content ?? ""
  );
}
