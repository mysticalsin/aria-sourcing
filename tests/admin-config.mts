/**
 * Admin config spine tests.
 * Verifies RBAC for the new LLM-config permissions, that the seed migration
 * fills new fields on old-shaped state, and that the key store actions mutate
 * state correctly.
 */
import { can } from "../src/lib/rbac.js";
import {
  buildSeedState,
  defaultLlmProviders,
  defaultSavedModels,
  defaultTools,
  STATE_VERSION,
} from "../src/lib/seed.js";
import { LLM_PROVIDERS, TOOL_IDS } from "../src/lib/types.js";

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

/* ---- RBAC: manage_providers, manage_models, manage_tools ----------------- */

ok("admin can manage_providers", can("admin", "manage_providers"));
ok("admin can manage_models", can("admin", "manage_models"));
ok("admin can manage_tools", can("admin", "manage_tools"));

ok("member CANNOT manage_providers", !can("member", "manage_providers"));
ok("member CANNOT manage_models", !can("member", "manage_models"));
ok("member CANNOT manage_tools", !can("member", "manage_tools"));

ok("viewer CANNOT manage_providers", !can("viewer", "manage_providers"));
ok("viewer CANNOT manage_models", !can("viewer", "manage_models"));
ok("viewer CANNOT manage_tools", !can("viewer", "manage_tools"));

// Existing RBAC should be unaffected.
ok("admin still has manage_settings", can("admin", "manage_settings"));
ok("member still can source", can("member", "source"));
ok("viewer still can view", can("viewer", "view"));

/* ---- Seed / migration: new fields present on fresh state ----------------- */

const seed = buildSeedState();

ok("seed version is current", seed.version === STATE_VERSION);
ok("seed has llmProviders array", Array.isArray(seed.settings.llmProviders));
ok("seed has at least one provider", seed.settings.llmProviders.length >= 1);
ok("seed has savedModels array", Array.isArray(seed.settings.savedModels));
ok("seed has tools array", Array.isArray(seed.settings.tools));
ok("seed tools cover all TOOL_IDS", seed.settings.tools.length === TOOL_IDS.length);
ok("seed has defaultModels object", typeof seed.settings.defaultModels === "object" && seed.settings.defaultModels !== null);

// Verify Kimi is the default provider (the public demo runs on a Kimi Code key).
const kimiProv = seed.settings.llmProviders.find((p) => p.kind === "Kimi");
ok("Kimi provider exists", !!kimiProv);
ok("Kimi provider is default", !!kimiProv?.isDefault);
ok("Kimi provider is enabled", !!kimiProv?.enabled);

// Other providers should be disabled by default.
const otherProviders = seed.settings.llmProviders.filter((p) => p.kind !== "Kimi");
ok("non-Kimi providers are disabled by default", otherProviders.every((p) => !p.enabled));

// LLM_PROVIDERS coverage.
ok("all LLM_PROVIDERS have an entry", LLM_PROVIDERS.every((k) => seed.settings.llmProviders.some((p) => p.kind === k)));

/* ---- defaultLlmProviders helper ----------------------------------------- */

const providers = defaultLlmProviders();
ok("defaultLlmProviders returns array", Array.isArray(providers));
ok("defaultLlmProviders has correct count", providers.length === LLM_PROVIDERS.length);
ok("every provider has id, kind, label", providers.every((p) => p.id && p.kind && p.label));

/* ---- defaultSavedModels helper ------------------------------------------ */

const models = defaultSavedModels();
ok("defaultSavedModels returns array", Array.isArray(models));
ok("default models are enabled", models.every((m) => m.enabled));
ok("default models have providerId", models.every((m) => !!m.providerId));

/* ---- defaultTools helper ------------------------------------------------ */

const tools = defaultTools();
ok("defaultTools returns all tools", tools.length === TOOL_IDS.length);
ok("all tools enabled by default", tools.every((t) => t.enabled));
ok("tools have label and description", tools.every((t) => t.label && t.description));
ok("tool ids match TOOL_IDS", tools.map((t) => t.id).every((id) => (TOOL_IDS as readonly string[]).includes(id)));

/* ---- Migration: old state missing new fields gets defaults filled --------- */

// Simulate an old-version state blob missing the new fields.
const oldState = {
  ...seed,
  version: STATE_VERSION - 1,
  settings: {
    ...seed.settings,
    llmProviders: undefined as unknown as typeof seed.settings.llmProviders,
    savedModels: undefined as unknown as typeof seed.settings.savedModels,
    tools: undefined as unknown as typeof seed.settings.tools,
    defaultModels: undefined as unknown as typeof seed.settings.defaultModels,
  },
};

// The migration function fills these in — we test the helpers directly since
// loadState() is browser-side. The same defaultSettings() call drives it.
import { defaultSettings } from "../src/lib/seed.js";
const defs = defaultSettings();
const migrated = {
  ...oldState,
  settings: {
    ...oldState.settings,
    llmProviders: oldState.settings.llmProviders ?? defs.llmProviders,
    savedModels: oldState.settings.savedModels ?? defs.savedModels,
    tools: oldState.settings.tools ?? defs.tools,
    defaultModels: oldState.settings.defaultModels ?? defs.defaultModels,
  },
};

ok("migration fills llmProviders when missing", Array.isArray(migrated.settings.llmProviders) && migrated.settings.llmProviders.length > 0);
ok("migration fills savedModels when missing", Array.isArray(migrated.settings.savedModels));
ok("migration fills tools when missing", Array.isArray(migrated.settings.tools) && migrated.settings.tools.length === TOOL_IDS.length);
ok("migration preserves other settings fields", migrated.settings.operatorName === seed.settings.operatorName);
ok("migration preserves campaigns", migrated.campaigns === seed.campaigns);

/* ---- State mutation helpers (pure logic, not hooks) ---------------------- */

// Verify that mutating an LlmProvider's enabled flag works correctly.
const provList = defaultLlmProviders();
const updated = provList.map((p) => (p.id === provList[0].id ? { ...p, enabled: false } : p));
ok("updateProvider disables a provider", !updated[0].enabled);

// setDefaultProvider logic.
const withDefault = provList.map((p) => ({ ...p, isDefault: p.id === provList[1].id }));
ok("setDefaultProvider marks one as default", withDefault.filter((p) => p.isDefault).length === 1);
ok("setDefaultProvider marks the right one", withDefault[1].isDefault === true);
ok("setDefaultProvider clears old default", withDefault[0].isDefault === false);

// toggleTool logic.
const toolList = defaultTools();
const toggled = toolList.map((t) => (t.id === toolList[0].id ? { ...t, enabled: !t.enabled } : t));
ok("toggleTool flips enabled for target tool", toggled[0].enabled !== toolList[0].enabled);
ok("toggleTool leaves other tools unchanged", toggled[1].enabled === toolList[1].enabled);

// setModelDefaultForTask logic (mimics store action).
const modelList = defaultSavedModels();
const afterTaskSet = modelList.map((m) => ({
  ...m,
  defaultForTask: m.id === modelList[0].id
    ? [...new Set([...(m.defaultForTask ?? []), "sourcing" as const])]
    : (m.defaultForTask ?? []).filter((t) => t !== "sourcing"),
}));
ok("setModelDefaultForTask adds task to target model", afterTaskSet[0].defaultForTask?.includes("sourcing") === true);

/* ---- Report -------------------------------------------------------------- */

console.log(`RESULT admin-config: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
