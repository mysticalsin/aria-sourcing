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
  anthropicCachedSystem,
  buildCloudRequest,
  parseCloudResponse,
  anthropicSupportsEffort,
  ANTHROPIC_TASK_PROFILE,
  cloudStopProblem,
} from "../src/lib/ai/provider.js";
import { parseLocalSecret } from "../src/lib/ai/local-secret.js";
import { INTAKE_OUTPUT_SCHEMA } from "../src/lib/ai/intake-schema.js";
import { buildIntakeParsePrompt } from "../src/lib/ai/intake.js";
import { aiBudgetStatus, aiUsageReport, estimateCostUsd, recordAiUsage, resetAiUsageForTests } from "../src/lib/ai/usage.js";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SystemSettings, LlmProvider, SavedModel } from "../src/lib/types.js";
import { defaultSettings } from "../src/lib/seed.js";
import { resolveProviderEndpoint } from "../src/lib/ai/endpoint";

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
const cachedSystem = anthropicCachedSystem("System msg");
ok(
  "the tool loop's system prompt carries a cache breakpoint",
  Array.isArray(cachedSystem) && cachedSystem[0]?.text === "System msg" && cachedSystem[0]?.cache_control.type === "ephemeral",
);
ok("an empty system prompt is not sent as an empty text block", anthropicCachedSystem("") === "");
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

/* ---- 12. Claude task profiles (effort + output ceiling) ------------------- */

const thinkingJson = { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "After thinking" }] };
ok("parseCloudResponse skips a leading thinking block", parseCloudResponse("anthropic", thinkingJson) === "After thinking");

const classifyBody = JSON.parse(
  buildCloudRequest("anthropic", "claude-haiku-5-5", "S", "P", "k", 2048, undefined, "classify").body,
) as { max_tokens: number; output_config?: { effort?: string } };
ok("classify runs at low effort", classifyBody.output_config?.effort === "low");
ok("classify uses its own output ceiling", classifyBody.max_tokens === ANTHROPIC_TASK_PROFILE.classify.maxTokens);

const outreachBody = JSON.parse(
  buildCloudRequest("anthropic", "claude-sonnet-5-5", "S", "P", "k", 2048, undefined, "outreach").body,
) as { max_tokens: number; output_config?: { effort?: string } };
ok("outreach runs at medium effort", outreachBody.output_config?.effort === "medium");
ok("outreach leaves room for thinking", outreachBody.max_tokens > 2048);

const legacyBody = JSON.parse(
  buildCloudRequest("anthropic", "claude-sonnet-4-5", "S", "P", "k", 2048, undefined, "outreach").body,
) as Record<string, unknown>;
ok("models without effort support keep the legacy shape", !("output_config" in legacyBody) && legacyBody.max_tokens === 2048);
ok("effort support covers current tiers", ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-8"].every(anthropicSupportsEffort));
ok("effort support excludes 4.5 and older", !["claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-7-sonnet"].some(anthropicSupportsEffort));

const priorWorkspace = process.env.ANTHROPIC_WORKSPACE_ID;
process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_test";
ok("workspace id is sent when configured",
  buildCloudRequest("anthropic", "claude-haiku-5-5", "S", "P", "k").headers["anthropic-workspace-id"] === "wrkspc_test");
delete process.env.ANTHROPIC_WORKSPACE_ID;
ok("no workspace header when unset",
  !("anthropic-workspace-id" in buildCloudRequest("anthropic", "claude-haiku-5-5", "S", "P", "k").headers));
if (priorWorkspace !== undefined) process.env.ANTHROPIC_WORKSPACE_ID = priorWorkspace;

/* ---- 12a. Brief extraction: structured output ------------------------------ */

const extractBody = JSON.parse(
  buildCloudRequest("anthropic", "claude-haiku-5-5", "S", "P", "k", 2048, undefined, "extract").body,
) as { max_tokens: number; output_config?: { effort?: string; format?: { type?: string; schema?: unknown } } };
ok("extract runs at low effort", extractBody.output_config?.effort === "low");
ok("extract constrains the answer to the intake schema", extractBody.output_config?.format?.type === "json_schema" && JSON.stringify(extractBody.output_config.format.schema) === JSON.stringify(INTAKE_OUTPUT_SCHEMA));
ok("other tasks send no schema", !("format" in (classifyBody.output_config ?? {})));

// Structured outputs reject open objects, missing required keys and numeric/length constraints.
const schemaProblems: string[] = [];
const walk = (node: unknown, path: string) => {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  for (const banned of ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]) {
    if (banned in n) schemaProblems.push(`${path}.${banned}`);
  }
  if (n.type === "object") {
    if (n.additionalProperties !== false) schemaProblems.push(`${path} is open`);
    const keys = Object.keys((n.properties as object) ?? {});
    if (JSON.stringify([...(n.required as string[])].sort()) !== JSON.stringify(keys.sort())) schemaProblems.push(`${path} required mismatch`);
  }
  for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
};
walk(INTAKE_OUTPUT_SCHEMA, "schema");
ok(`intake schema fits structured-output limits${schemaProblems.length ? `: ${schemaProblems.join(", ")}` : ""}`, schemaProblems.length === 0);
const promptShape = JSON.parse(buildIntakeParsePrompt("x").split("\n").slice(2).join("\n").split("\n\nTEXT:")[0] as string) as object;
ok("schema and prompt describe the same fields", JSON.stringify(Object.keys(INTAKE_OUTPUT_SCHEMA.properties).sort()) === JSON.stringify(Object.keys(promptShape).sort()));
ok("extraction runs on Haiku by default", resolveAiProvider(defaultSettings(), "extraction")?.model === "claude-haiku-5-5");

/* ---- 12b. Unusable stop reasons ------------------------------------------- */

ok("complete Anthropic answer has no stop problem", cloudStopProblem("anthropic", { stop_reason: "end_turn" }) === null);
ok("Anthropic max_tokens is a truncation", cloudStopProblem("anthropic", { stop_reason: "max_tokens" }) === "Response truncated at the output limit.");
ok("Anthropic refusal is a decline", cloudStopProblem("anthropic", { stop_reason: "refusal" }) === "The model declined this request.");
ok("OpenAI-compatible length is a truncation", cloudStopProblem("openai", { choices: [{ finish_reason: "length" }] }) === "Response truncated at the output limit.");
ok("OpenAI-compatible stop is complete", cloudStopProblem("groq", { choices: [{ finish_reason: "stop" }] }) === null);
ok("missing body has no stop problem", cloudStopProblem("anthropic", null) === null);

/* ---- 13. Local .secret file parsing --------------------------------------- */

ok("a bare key is read as ANTHROPIC_API_KEY", parseLocalSecret("sk-ant-api03-abc_DEF-1\n").ANTHROPIC_API_KEY === "sk-ant-api03-abc_DEF-1");
const named = parseLocalSecret("# local\nANTHROPIC_API_KEY=\"sk-ant-x\"\r\nexport ANTHROPIC_WORKSPACE_ID=wrkspc_1\nNODE_OPTIONS=--inspect\n");
ok("KEY=VALUE lines are read and unquoted", named.ANTHROPIC_API_KEY === "sk-ant-x" && named.ANTHROPIC_WORKSPACE_ID === "wrkspc_1");
ok("variables outside the allow-list are ignored", !("NODE_OPTIONS" in named));
ok("a bare non-Anthropic line is ignored", Object.keys(parseLocalSecret("hello world")).length === 0);

/* ---- Report ---------------------------------------------------------------- */

const localSettings = settingsWith([makeProvider({
  kind: "Local/Custom", baseUrl: "http://127.0.0.1:11434/v1/", modelName: "qwen3:8b",
})]);
const local = resolveAiProvider(localSettings, "sourcing");
ok("local provider resolves without a key", local?.provider === "local" && !local.apiKeyId);
ok("local model tags and endpoint survive resolution", local?.model === "qwen3:8b" && local.baseUrl === "http://127.0.0.1:11434/v1/");
const localEndpoint = resolveProviderEndpoint("local", local?.baseUrl);
ok("local endpoint joins v1 without duplicate slash", localEndpoint === "http://127.0.0.1:11434/v1/chat/completions");
const localRequest = buildCloudRequest("local", "qwen3:8b", "System", "Hello", "", 2048, localEndpoint);
ok("keyless local request omits authorization", !("authorization" in localRequest.headers));
for (const url of ["http://169.254.169.254/v1", "https://example.com/v1", "http://user:secret@localhost/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment", "file:///tmp/model"]) {
  let blocked = false;
  try { resolveProviderEndpoint("local", url); } catch { blocked = true; }
  ok(`unsafe local endpoint blocked: ${url}`, blocked);
}
ok("Docker host endpoint allowed", resolveProviderEndpoint("local", "http://host.docker.internal:11434/v1").includes("host.docker.internal"));
ok("hosted provider ignores custom URL", resolveProviderEndpoint("openai", "http://localhost:1234") === "https://api.openai.com/v1/chat/completions");

/* ---- 14. Claude spend ledger and budget gate ------------------------------ */

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
ok("Haiku pricing", near(estimateCostUsd("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6));
ok("Sonnet pricing with cache read", near(estimateCostUsd("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000 }), 0.002 + 0.005 + 0.002));
ok("unknown model priced conservatively", estimateCostUsd("claude-mystery", { output_tokens: 1000 }) >= estimateCostUsd("claude-opus-5-5", { output_tokens: 1000 }));
ok("missing usage costs nothing", estimateCostUsd("claude-sonnet-5-5", undefined) === 0);

const budgetEnv = { AI_MONTHLY_BUDGET_USD: "1", AI_DAILY_BUDGET_USD: "0.5" } as unknown as NodeJS.ProcessEnv;
const day1 = new Date("2026-11-03T10:00:00Z");
const quietLog = console.info;
console.info = () => {};
const usageDir = mkdtempSync(path.join(tmpdir(), "aria-usage-"));
const priorUsageFile = process.env.AI_USAGE_FILE;
process.env.AI_USAGE_FILE = path.join(usageDir, "nested", "ai-usage.json");
try {
  resetAiUsageForTests();
  ok("fresh ledger is within budget", aiBudgetStatus(day1, budgetEnv).ok);
  recordAiUsage({ task: "outreach", model: "claude-sonnet-5-5", usage: { output_tokens: 50_000 } }, day1);
  const dayCapped = aiBudgetStatus(day1, budgetEnv);
  ok("daily cap blocks further calls", !dayCapped.ok && dayCapped.reason === "Daily AI budget reached.");
  const day2 = new Date("2026-11-04T10:00:00Z");
  ok("a new day reopens the daily budget", aiBudgetStatus(day2, budgetEnv).ok);
  recordAiUsage({ task: "sourcing", model: "claude-sonnet-5-5", usage: { output_tokens: 60_000 } }, day2);
  const nextDay = new Date("2026-11-05T10:00:00Z");
  const monthCapped = aiBudgetStatus(nextDay, budgetEnv);
  ok("monthly cap holds across days", !monthCapped.ok && monthCapped.reason === "Monthly AI budget reached.");
  ok("default caps apply without env", aiBudgetStatus(day1, {} as unknown as NodeJS.ProcessEnv).monthlyLimitUsd === 30);

  // Per task + model breakdown, and the totals survive a restart.
  const report = aiUsageReport(nextDay, budgetEnv);
  ok("report breaks spend down by task and model", report.byTask.length === 2 && report.byTask[0]?.task === "sourcing" && report.byTask[0]?.outputTokens === 60_000);
  ok("report counts calls", report.calls === 2 && report.month === "2026-11");
  ok("ledger is written to the usage file", existsSync(process.env.AI_USAGE_FILE as string));
  resetAiUsageForTests(); // simulates a process restart
  const restarted = aiUsageReport(nextDay, budgetEnv);
  ok("a restart reloads month-to-date spend", Math.abs(restarted.monthUsd - 1.1) < 1e-9 && restarted.byTask.length === 2);
  ok("a new month resets the ledger", aiBudgetStatus(new Date("2026-12-01T00:00:00Z"), budgetEnv).ok);
  writeFileSync(process.env.AI_USAGE_FILE as string, "{not json");
  resetAiUsageForTests();
  ok("a corrupt usage file starts a fresh ledger", aiUsageReport(nextDay, budgetEnv).monthUsd === 0);
} finally {
  console.info = quietLog;
  resetAiUsageForTests();
  if (priorUsageFile === undefined) delete process.env.AI_USAGE_FILE;
  else process.env.AI_USAGE_FILE = priorUsageFile;
  rmSync(usageDir, { recursive: true, force: true });
}

/* ---- Cost by activity (AI costs page) ------------------------------------ */
{
  const activityDir = mkdtempSync(path.join(tmpdir(), "aria-activity-"));
  const priorFile = process.env.AI_USAGE_FILE;
  const quiet = console.info;
  console.info = () => {};
  process.env.AI_USAGE_FILE = path.join(activityDir, "ai-usage.json");
  try {
    resetAiUsageForTests();
    const d1 = new Date("2026-11-02T09:00:00Z");
    const d2 = new Date("2026-11-03T09:00:00Z");
    recordAiUsage({ task: "outreach", activity: "first-contact", model: "claude-sonnet-5-5", usage: { input_tokens: 600, output_tokens: 300 } }, d1);
    recordAiUsage({ task: "outreach", activity: "follow-up", model: "claude-sonnet-5-5", usage: { input_tokens: 600, output_tokens: 300 } }, d1);
    recordAiUsage({ task: "classify", model: "claude-haiku-5-5", usage: { input_tokens: 400, output_tokens: 100 } }, d2);
    const report = aiUsageReport(d2, budgetEnv);
    const ids = report.byActivity.map((a) => a.activity);
    ok("the same task splits into its activities", ids.includes("first-contact") && ids.includes("follow-up"));
    ok("a call without an activity is filed under its task's default", ids.includes("reply-triage"));
    ok("activities are ranked most expensive first", report.byActivity[0].costUsd >= report.byActivity.at(-1)!.costUsd);
    ok(
      "activity totals add up to the month",
      Math.abs(report.byActivity.reduce((sum, a) => sum + a.costUsd, 0) - report.monthUsd) < 1e-12,
    );
    ok("each activity remembers its model", report.byActivity.find((a) => a.activity === "reply-triage")?.models["claude-haiku-5-5"] === 1);
    ok("the daily series covers 30 days ending today", report.daily.length === 30 && report.daily.at(-1)?.day === "2026-11-03");
    const nov2 = report.daily.find((d) => d.day === "2026-11-02");
    ok("a day keeps its cost per activity", nov2?.calls === 2 && Boolean(nov2?.byActivity["first-contact"]) && Boolean(nov2?.byActivity["follow-up"]));
    ok("days without spend are zero, not missing", report.daily[0].costUsd === 0 && report.daily[0].calls === 0);
    ok("the projection extends the month at today's pace", Math.abs(report.projectedMonthUsd - (report.monthUsd / 3) * 30) < 1e-12);
    ok("history starts on the first day with spend", report.trackedSince === "2026-11-02");

    // A new month restarts the totals but keeps the history.
    const dec = new Date("2026-12-01T09:00:00Z");
    recordAiUsage({ task: "chat", model: "claude-sonnet-5-5", usage: { output_tokens: 100 } }, dec);
    const december = aiUsageReport(dec, budgetEnv);
    ok("a new month restarts activity totals", december.byActivity.length === 1 && december.byActivity[0].activity === "assistant-chat");
    ok("month history keeps the previous month", december.months.map((m) => m.month).join(",") === "2026-11,2026-12");
    ok("day history crosses the month boundary", december.daily.some((d) => d.day === "2026-11-03" && d.costUsd > 0));

    // A file written before activities existed keeps its total, labelled.
    writeFileSync(
      process.env.AI_USAGE_FILE as string,
      JSON.stringify({
        month: "2026-11",
        day: "2026-11-02",
        monthUsd: 0.08,
        dayUsd: 0.08,
        calls: 31,
        byTask: { "outreach claude-sonnet-5-5": { task: "outreach", model: "claude-sonnet-5-5", calls: 19, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0.07 } },
      }),
    );
    resetAiUsageForTests();
    const legacy = aiUsageReport(new Date("2026-11-02T12:00:00Z"), budgetEnv);
    ok(
      "an older usage file shows up as 'before activity tracking'",
      legacy.byActivity.length === 1 && legacy.byActivity[0].activity === "untracked" && legacy.byActivity[0].costUsd === 0.08 && legacy.byActivity[0].calls === 31,
    );
    ok("an older usage file still feeds today's bar", legacy.daily.at(-1)?.costUsd === 0.08 && legacy.daily.at(-1)?.calls === 31);
  } finally {
    console.info = quiet;
    resetAiUsageForTests();
    if (priorFile === undefined) delete process.env.AI_USAGE_FILE;
    else process.env.AI_USAGE_FILE = priorFile;
    rmSync(activityDir, { recursive: true, force: true });
  }
}

const routeSource = readFileSync(new URL("../src/app/api/hermes/chat/route.ts", import.meta.url), "utf8");
ok("the chat route accepts an activity and records it", /activity: z\.enum\(AI_ACTIVITY_IDS\)\.optional\(\)/.test(routeSource) && /recordAiUsage\(\{ task, activity,/.test(routeSource));

console.log(`RESULT ai-provider: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
