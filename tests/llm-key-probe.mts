import { probeLlmApiKey, testLlmApiKey, isLiveLlmKeyProvider } from "../src/lib/ai/key-probe";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("Anthropic is a live LLM key provider", isLiveLlmKeyProvider("Anthropic"));
ok("OpenAI is a live LLM key provider", isLiveLlmKeyProvider("OpenAI"));
ok("Kimi (Moonshot) is a live LLM key provider", isLiveLlmKeyProvider("Kimi (Moonshot)"));
ok("DeepSeek is a live LLM key provider", isLiveLlmKeyProvider("DeepSeek"));
ok("NVIDIA NIM is a live LLM key provider", isLiveLlmKeyProvider("NVIDIA NIM"));
ok("Dust is not a live LLM key provider", !isLiveLlmKeyProvider("Dust"));
ok(
  "Cloudflare is not a live LLM key provider (account-scoped probe via Workers AI connect)",
  !isLiveLlmKeyProvider("Cloudflare"),
);
ok("Apify is not an LLM key provider", !isLiveLlmKeyProvider("Apify"));

{
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  const r = await probeLlmApiKey("Anthropic", "sk-ant-" + "a".repeat(30), fetchImpl as typeof fetch);
  ok("200 models list marks Anthropic key valid", r.valid && /accepted \(HTTP 200\)/.test(r.detail));
}

{
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  const r = await probeLlmApiKey("Anthropic", "sk-ant-" + "a".repeat(30), fetchImpl as typeof fetch);
  ok("401 marks Anthropic key invalid", !r.valid && /rejected this key \(HTTP 401\)/.test(r.detail));
}

{
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  const r = await probeLlmApiKey("OpenAI", "sk-" + "b".repeat(30), fetchImpl as typeof fetch);
  ok("429 still proves OpenAI key authenticated", r.valid && /authenticated \(HTTP 429\)/.test(r.detail));
}

{
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const r = await testLlmApiKey("Groq", "gsk_plausible_key_12345678", fetchImpl as typeof fetch);
  ok("unreachable Groq falls back to format check", r.valid && /unreachable, format check only/.test(r.detail));
}

{
  const r = await testLlmApiKey("Anthropic", "not-a-key");
  ok("malformed Anthropic key rejected before network", !r.valid && /format/i.test(r.detail));
}

{
  const seen: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("{}", { status: 200 });
  };
  await probeLlmApiKey("Kimi (Moonshot)", "sk-" + "c".repeat(30), fetchImpl as typeof fetch);
  ok(
    "Kimi probe hits Moonshot models endpoint",
    seen.some((u) => /api\.moonshot\.ai\/v1\/models/.test(u)),
  );
}

{
  const seen: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("{}", { status: 200 });
  };
  await probeLlmApiKey("DeepSeek", "sk-" + "d".repeat(30), fetchImpl as typeof fetch);
  ok(
    "DeepSeek probe hits api.deepseek.com/models",
    seen.some((u) => /api\.deepseek\.com\/models/.test(u)),
  );
}

{
  const seen: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ status: 403, detail: "Authorization failed" }), { status: 403 });
  };
  const r = await probeLlmApiKey("NVIDIA NIM", "nvapi-" + "e".repeat(30), fetchImpl as typeof fetch);
  ok(
    "NVIDIA NIM skips public /models and probes chat/completions",
    seen.length === 1 && /integrate\.api\.nvidia\.com\/v1\/chat\/completions/.test(seen[0]),
  );
  ok("NVIDIA NIM 403 marks key invalid", !r.valid && /rejected this key \(HTTP 403\)/.test(r.detail));
}

{
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  // If someone accidentally called /models, 200 would be a false positive — ensure we never
  // accept a models-list-only path for NVIDIA by forcing chat path (covered above).
  const r = await probeLlmApiKey(
    "NVIDIA NIM",
    "nvapi-" + "e".repeat(30),
    (async (input: RequestInfo | URL) => {
      if (String(input).includes("/models") && !String(input).includes("chat")) {
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ status: 403 }), { status: 403 });
    }) as typeof fetch,
  );
  ok("NVIDIA NIM ignores public /models 200", !r.valid);
}

{
  const r = await testLlmApiKey("NVIDIA NIM", "sk-not-nvidia");
  ok("malformed NVIDIA NIM key rejected before network", !r.valid && /format/i.test(r.detail));
}

console.log(`RESULT llm-key-probe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
