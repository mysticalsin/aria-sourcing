import { clearLlmEnvStatusCache, probeLlmEnvStatus } from "../src/lib/ai/llm-env-status";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const PREV = {
  KIMI_API_KEY: process.env.KIMI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearPreferredEnv() {
  delete process.env.KIMI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
}

try {
  clearLlmEnvStatusCache();
  clearPreferredEnv();

  {
    const report = await probeLlmEnvStatus({
      force: true,
      fetchImpl: (async () => {
        throw new Error("should not fetch when absent");
      }) as typeof fetch,
    });
    ok("absent keys → llm_keys_absent", report.status === "llm_keys_absent");
    ok("keysPresent false when absent", report.keysPresent === false);
    ok("all four providers listed", report.providers.length === 4);
    ok("kimi absent", report.providers.find((p) => p.slug === "kimi")?.state === "absent");
  }

  {
    clearLlmEnvStatusCache();
    process.env.KIMI_API_KEY = "sk-" + "k".repeat(40);
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "invalid" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const report = await probeLlmEnvStatus({ force: true, fetchImpl });
    ok("401 → llm_auth_dead", report.status === "llm_auth_dead");
    ok("keysPresent true when auth_dead", report.keysPresent === true);
    ok("kimi auth_dead", report.providers.find((p) => p.slug === "kimi")?.state === "auth_dead");
    ok("firstLive null when dead", report.firstLiveProvider === null);
  }

  {
    clearLlmEnvStatusCache();
    process.env.KIMI_API_KEY = "sk-" + "k".repeat(40);
    process.env.OPENAI_API_KEY = "sk-" + "o".repeat(40);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("moonshot") || url.includes("kimi")) {
        return new Response("{}", { status: 401 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    const report = await probeLlmEnvStatus({ force: true, fetchImpl });
    ok("mixed dead+ok → llm_auth_ok", report.status === "llm_auth_ok");
    ok("firstLive is openai", report.firstLiveProvider === "openai");
  }

  {
    const cached = await probeLlmEnvStatus({
      fetchImpl: (async () => {
        throw new Error("cache should short-circuit");
      }) as typeof fetch,
    });
    ok("second call uses cache", cached.cached === true && cached.status === "llm_auth_ok");
  }

  {
    clearLlmEnvStatusCache();
    clearPreferredEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-" + "a".repeat(40);
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
    const report = await probeLlmEnvStatus({ force: true, fetchImpl });
    ok("anthropic alone → ok", report.status === "llm_auth_ok" && report.firstLiveProvider === "anthropic");
  }
} finally {
  restoreEnv();
  clearLlmEnvStatusCache();
}

console.log(`RESULT llm-env-status: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
