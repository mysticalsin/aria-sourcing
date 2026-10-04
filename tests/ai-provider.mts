/**
 * Cloud AI provider resolution + request builder tests.
 *
 * Verifies:
 *  - resolveAiProvider returns null with empty / unsupported settings
 *  - seat modelId override takes precedence over defaultModels
 *  - falls back to defaultModels, then first enabled savedModel with task default
 *  - returns null when the only enabled provider kind has no slug (Google)
 *  - buildCloudRequest produces x-api-key header for Anthropic
 *  - buildCloudRequest produces Bearer token header for OpenAI-compatible providers
 *  - parseCloudResponse extracts text from both Anthropic and OpenAI response shapes
 */
import {
  resolveAiProvider,
  aiProviderConfigured,
  buildCloudRequest,
  parseCloudResponse,
} from "../src/lib/ai/provider.js";
import type { SystemSettings, LlmProvider, SavedModel } from "../src/lib/types.js";
import { defaultSettings } from "../src/lib/seed.js";

let pass = 0,
  fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- Helpers ---------------------------------------------------------------- */

function makeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: "p1",
    kind: "Anthropic",
    label: "Anthropic",
    enabled: true,
    ...overrides,
  };
}

function makeModel(overrides: Partial<SavedModel> = {}): SavedModel {
  return {
    id: "m1",
    providerId: "p1",
    modelName: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    enabled: true,
    ...overrides,
  };
}

function settingsWith(
  providers: LlmProvider[],
  models: SavedModel[] = [],
  defaultModels?: Partial<Record<"sourcing" | "outreach" | "classification" | "chat", string>>,
): SystemSettings {
  return {
    ...defaultSettings(),
    llmProviders: providers,
    savedModels: models,
    defaultModels,
  };
}

/* ---- 1. Empty settings → null --------------------------------------------- */

const emptySettings = settingsWith([]);
ok("resolveAiProvider returns null with no providers", resolveAiProvider(emptySettings, "outreach") === null);
ok("aiProviderConfigured returns false with no providers", !aiProviderConfigured(emptySettings));

/* ---- 2. Single enabled Anthropic provider → resolves ----------------------- */

const anthropicSettings = settingsWith(
  [makeProvider({ id: "p1", kind: "Anthropic", apiKeyId: "key-uuid-1" })],
  [makeModel({ id: "m1", providerId: "p1", modelName: "claude-opus-4-8" })],
  { outreach: "m1" },
);

const resolved = resolveAiProvider(anthropicSettings, "outreach");
ok("resolves provider slug for Anthropic", resolved?.provider === "anthropic");
ok("resolves model from savedModel", resolved?.model === "claude-opus-4-8");
ok("resolves apiKeyId from provider", resolved?.apiKeyId === "key-uuid-1");
ok("aiProviderConfigured true for Anthropic", aiProviderConfigured(anthropicSettings));

/* ---- 3. seat modelId override takes priority ------------------------------- */

const withTwoModels = settingsWith(
  [makeProvider({ id: "p1", kind: "OpenAI" })],
  [
    makeModel({ id: "m1", providerId: "p1", modelName: "gpt-4o-mini", defaultForTask: ["outreach"] }),
    makeModel({ id: "m2", providerId: "p1", modelName: "gpt-4-turbo" }),
  ],
  { outreach: "m1" },
);

const seatOverride = resolveAiProvider(withTwoModels, "outreach", { modelId: "m2" });
ok("seat modelId override wins over defaultModels", seatOverride?.model === "gpt-4-turbo");
ok("seat modelId override resolves correct provider", seatOverride?.provider === "openai");

/* ---- 4. Falls back to first enabled savedModel with task default ----------- */

const noDefaultModel = settingsWith(
  [makeProvider({ id: "p1", kind: "Groq" })],
  [
    makeModel({ id: "m1", providerId: "p1", modelName: "llama-3.3-70b-versatile", defaultForTask: ["classification"] }),
  ],
);

const taskDefault = resolveAiProvider(noDefaultModel, "classification");
ok("resolves from savedModel.defaultForTask when no defaultModels", taskDefault?.model === "llama-3.3-70b-versatile");
ok("task default resolves correct provider", taskDefault?.provider === "groq");

/* ---- 5. Falls back to DEFAULT_MODEL when no savedModel --------------------- */

const noModel = settingsWith([makeProvider({ id: "p1", kind: "Mistral" })]);
const withDefault = resolveAiProvider(noModel, "outreach");
ok("falls back to DEFAULT_MODEL when no savedModel configured", withDefault?.model === "mistral-large-latest");
ok("provider slug correct for Mistral", withDefault?.provider === "mistral");

/* ---- 6. Google-only provider → null (no slug) ----------------------------- */

const googleSettings = settingsWith([
  makeProvider({ id: "p1", kind: "Google", label: "Google Gemini" }),
]);
ok("resolveAiProvider returns null for Google (no slug)", resolveAiProvider(googleSettings, "outreach") === null);
ok("aiProviderConfigured false for Google-only", !aiProviderConfigured(googleSettings));

/* ---- 7. Disabled provider → null ----------------------------------------- */

const disabledSettings = settingsWith([
  makeProvider({ id: "p1", kind: "Anthropic", enabled: false }),
]);
ok("resolveAiProvider returns null when provider disabled", resolveAiProvider(disabledSettings, "outreach") === null);

const staleSourcingDefault = settingsWith(
  [
    makeProvider({ id: "disabled-anthropic", kind: "Anthropic", enabled: false }),
    makeProvider({ id: "enabled-openai", kind: "OpenAI", enabled: true, isDefault: true }),
  ],
  [
    makeModel({
      id: "stale-sourcing-model",
      providerId: "disabled-anthropic",
      modelName: "claude-stale",
      defaultForTask: ["sourcing"],
    }),
  ],
  { sourcing: "stale-sourcing-model" },
);
const sourcingFallback = resolveAiProvider(staleSourcingDefault, "sourcing");
ok("stale sourcing model on a disabled provider falls back to an enabled provider", sourcingFallback?.provider === "openai");
ok("stale sourcing model does not leak its disabled-provider model name", sourcingFallback?.model === "gpt-4o-mini");

/* ---- 8. buildCloudRequest — Anthropic shape ------------------------------- */

const anthropicReq = buildCloudRequest("anthropic", "claude-sonnet-4-6", "System msg", "User msg", "sk-ant-test");
ok("Anthropic request uses CLOUD_ENDPOINT URL", anthropicReq.url === "https://api.anthropic.com/v1/messages");
ok("Anthropic request has x-api-key header", anthropicReq.headers["x-api-key"] === "sk-ant-test");
ok("Anthropic request has anthropic-version header", "anthropic-version" in anthropicReq.headers);
ok("Anthropic request has no authorization header", !("authorization" in anthropicReq.headers));

const anthropicBody = JSON.parse(anthropicReq.body) as Record<string, unknown>;
ok("Anthropic body has system field", anthropicBody.system === "System msg");
ok("Anthropic body has max_tokens", typeof anthropicBody.max_tokens === "number");
ok("Anthropic body messages is user-only", Array.isArray(anthropicBody.messages) && (anthropicBody.messages as {role:string}[]).length === 1 && (anthropicBody.messages as {role:string}[])[0]?.role === "user");

/* ---- 9. buildCloudRequest — OpenAI-compatible shape ----------------------- */

const openaiReq = buildCloudRequest("openai", "gpt-4o-mini", "System msg", "User msg", "sk-openai-test");
ok("OpenAI request has authorization Bearer header", openaiReq.headers.authorization === "Bearer sk-openai-test");
ok("OpenAI request has no x-api-key header", !("x-api-key" in openaiReq.headers));

const openaiBody = JSON.parse(openaiReq.body) as Record<string, unknown>;
const openaiMessages = openaiBody.messages as {role:string; content:string}[];
ok("OpenAI body has system message first", openaiMessages[0]?.role === "system" && openaiMessages[0]?.content === "System msg");
ok("OpenAI body has user message second", openaiMessages[1]?.role === "user" && openaiMessages[1]?.content === "User msg");
ok("OpenAI body does not have top-level system field", !("system" in openaiBody));

/* Groq and Mistral follow the same OpenAI path */
const groqReq = buildCloudRequest("groq", "llama-3.3-70b-versatile", "Sys", "Prompt", "gsk-test");
ok("Groq request has authorization Bearer header", groqReq.headers.authorization === "Bearer gsk-test");

/* ---- 10. parseCloudResponse — Anthropic shape ----------------------------- */

const anthropicJson = { content: [{ type: "text", text: "Hello from Anthropic" }] };
ok("parseCloudResponse extracts text from Anthropic shape", parseCloudResponse("anthropic", anthropicJson) === "Hello from Anthropic");
ok("parseCloudResponse returns empty string for missing anthropic content", parseCloudResponse("anthropic", {}) === "");
ok("parseCloudResponse returns empty string for null", parseCloudResponse("anthropic", null) === "");

/* ---- 11. parseCloudResponse — OpenAI shape -------------------------------- */

const openaiJson = { choices: [{ message: { role: "assistant", content: "Hello from OpenAI" } }] };
ok("parseCloudResponse extracts text from OpenAI shape", parseCloudResponse("openai", openaiJson) === "Hello from OpenAI");
ok("parseCloudResponse returns empty for missing choices", parseCloudResponse("openai", {}) === "");
ok("parseCloudResponse returns empty for null (openai)", parseCloudResponse("openai", null) === "");

// Groq / Mistral / xAI use same OpenAI path
const groqJson = { choices: [{ message: { content: "Hello from Groq" } }] };
ok("parseCloudResponse works for groq shape", parseCloudResponse("groq", groqJson) === "Hello from Groq");

/* ---- Report ---------------------------------------------------------------- */

console.log(`RESULT ai-provider: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
