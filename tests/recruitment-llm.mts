import { KIND_TO_SLUG, resolveAiProvider } from "../src/lib/ai/provider";
import { defaultSettings } from "../src/lib/seed";
import type { SystemSettings } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const base = defaultSettings();

// Enable Anthropic so sourcing can resolve when set as default.
const withAnthropic: SystemSettings = {
  ...base,
  llmProviders: (base.llmProviders ?? []).map((p) =>
    p.kind === "Anthropic" ? { ...p, enabled: true, isDefault: true } : { ...p, isDefault: false },
  ),
  defaultModels: {
    ...base.defaultModels,
    sourcing: "model_claude_opus_4",
    chat: "model_kimi_coding",
    outreach: "model_kimi_coding",
    classification: "model_kimi_coding",
  },
};

const sourcing = resolveAiProvider(withAnthropic, "sourcing");
ok("sourcing resolves to anthropic when Opus defaulted", sourcing?.provider === "anthropic");
ok("sourcing model is opus", /opus/i.test(sourcing?.model ?? ""));

const chat = resolveAiProvider(withAnthropic, "chat");
ok("chat/intake still resolves (Kimi ok for parse)", chat?.provider === "kimi");

ok("Kimi slug exists", KIND_TO_SLUG.Kimi === "kimi");
ok("Anthropic slug exists", KIND_TO_SLUG.Anthropic === "anthropic");

// Kimi must not be selectable as sourcing via resolveAiProvider even if forced.
const kimiForced: SystemSettings = {
  ...base,
  defaultModels: { ...base.defaultModels, sourcing: "model_kimi_coding" },
};
const blocked = resolveAiProvider(kimiForced, "sourcing");
ok("Kimi cannot be the sourcing agent", blocked === null);

console.log(`RESULT recruitment-llm: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
