/**
 * Live network E2E for LLM key probes — well-formed FAKE keys must be rejected
 * by the real provider (401/403). Never prints secrets.
 *
 * Run: node --import tsx --test tests/llm-key-probe-live.mts
 */
import { testLlmApiKey } from "../src/lib/ai/key-probe";
import { validateApiKeyFormat } from "../src/lib/providers";
import { DEFAULT_MODEL } from "../src/lib/ai/provider";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name, detail ?? "");
  }
}

const FAKE = {
  Anthropic: "sk-ant-" + "a".repeat(40),
  OpenAI: "sk-" + "b".repeat(40),
  "Kimi (Moonshot)": "sk-" + "c".repeat(40),
  DeepSeek: "sk-" + "d".repeat(40),
  "NVIDIA NIM": "nvapi-" + "e".repeat(40),
  Groq: "gsk_" + "f".repeat(40),
  Mistral: "mst-" + "g".repeat(40), // may be format-only if rule absent
  xAI: "xai-" + "h".repeat(40),
} as const;

ok(
  "NVIDIA default model is not the EOL llama-3.3-70b id",
  DEFAULT_MODEL.nvidia !== "meta/llama-3.3-70b-instruct" && DEFAULT_MODEL.nvidia.includes("/"),
  DEFAULT_MODEL.nvidia,
);

for (const [provider, value] of Object.entries(FAKE)) {
  const fmt = validateApiKeyFormat(provider, value);
  if (!fmt.valid) {
    // Providers without a strict format rule still need a live probe path when listed live.
    ok(`${provider} fake key format gate`, provider === "Mistral" || provider === "xAI" || provider === "Groq", fmt.detail);
  }
}

{
  const r = await testLlmApiKey("Anthropic", FAKE.Anthropic);
  ok("live Anthropic rejects fake key", !r.valid && /HTTP 401|rejected|format/i.test(r.detail), r.detail);
}

{
  const r = await testLlmApiKey("DeepSeek", FAKE.DeepSeek);
  ok("live DeepSeek rejects fake key", !r.valid && /HTTP 401|rejected|Authentication/i.test(r.detail), r.detail);
}

{
  const r = await testLlmApiKey("Kimi (Moonshot)", FAKE["Kimi (Moonshot)"]);
  ok("live Kimi rejects fake key", !r.valid && /HTTP 401|rejected|Authentication|Invalid/i.test(r.detail), r.detail);
}

{
  const r = await testLlmApiKey("NVIDIA NIM", FAKE["NVIDIA NIM"]);
  ok(
    "live NVIDIA NIM rejects fake key via chat (not public /models)",
    !r.valid && /HTTP 403|HTTP 401|rejected|Authorization failed/i.test(r.detail),
    r.detail,
  );
  ok("NVIDIA live detail must not claim accepted HTTP 200", !/accepted \(HTTP 200\)/.test(r.detail), r.detail);
}

{
  const r = await testLlmApiKey("Anthropic", "not-a-key");
  ok("malformed Anthropic never hits network claim of accepted", !r.valid && /format/i.test(r.detail), r.detail);
}

{
  const r = await testLlmApiKey("NVIDIA NIM", "nvapi-short");
  ok("short NVIDIA key fails format before network", !r.valid && /format/i.test(r.detail), r.detail);
}

console.log(`RESULT llm-key-probe-live: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
