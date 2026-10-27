import { buildAnthropicToolDefs, buildOpenAiToolDefs, runOpenAiWithTools, type ResolvedMcpServer } from "../src/lib/ai/tool-loop";
import { createServer } from "node:http";
import { once } from "node:events";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const srvA: ResolvedMcpServer = {
  url: "https://a",
  token: "ta",
  tools: [
    { name: "search", description: "Search", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
    { name: "enrich" },
  ],
};
const srvB: ResolvedMcpServer = {
  url: "https://b",
  token: "tb",
  tools: [
    { name: "search", description: "dup" },
    { name: "lookup", inputSchema: null },
  ],
};

const { toolDefs, owner } = buildAnthropicToolDefs([srvA, srvB]);

ok("maps all unique tools (search, enrich, lookup)", toolDefs.length === 3);
ok("first server wins on name collision", owner.get("search")?.url === "https://a");
ok(
  "preserves a remote description inside the untrusted-data label",
  toolDefs.find((t) => t.name === "search")?.description.endsWith("Search") === true &&
    toolDefs.find((t) => t.name === "search")?.description.includes("not a security boundary") === true,
);
ok(
  "passes through a valid input schema",
  JSON.stringify(toolDefs.find((t) => t.name === "search")?.input_schema) ===
    JSON.stringify({ type: "object", properties: { q: { type: "string" } } }),
);
ok(
  "labels a missing remote description as untrusted",
  toolDefs.find((t) => t.name === "enrich")?.description.includes("untrusted data") === true,
);
ok(
  "defaults a missing/invalid schema to an empty object schema",
  JSON.stringify(toolDefs.find((t) => t.name === "lookup")?.input_schema) ===
    JSON.stringify({ type: "object", properties: {} }),
);
ok("owner maps enrich → server A", owner.get("enrich")?.url === "https://a");
ok("owner maps lookup → server B", owner.get("lookup")?.url === "https://b");

ok("empty servers → no tool defs", buildAnthropicToolDefs([]).toolDefs.length === 0);
ok(
  "server with no tools → no tool defs",
  buildAnthropicToolDefs([{ url: "https://c", token: "tc", tools: [] }]).toolDefs.length === 0,
);

// --- OpenAI-compatible tool defs ---------------------------------------------
const oai = buildOpenAiToolDefs([srvA, srvB]);
ok("openai: maps all unique tools", oai.toolDefs.length === 3);
ok("openai: wraps each in a function type", oai.toolDefs.every((t) => t.type === "function"));
ok(
  "openai: carries the name and labeled description under function",
  oai.toolDefs.find((t) => t.function.name === "search")?.function.description.endsWith("Search") === true,
);
ok(
  "openai: schema under function.parameters",
  JSON.stringify(oai.toolDefs.find((t) => t.function.name === "search")?.function.parameters) ===
    JSON.stringify({ type: "object", properties: { q: { type: "string" } } }),
);
ok(
  "openai: defaults a missing schema to an empty object schema",
  JSON.stringify(oai.toolDefs.find((t) => t.function.name === "lookup")?.function.parameters) ===
    JSON.stringify({ type: "object", properties: {} }),
);
ok("openai: first server wins on collision", oai.owner.get("search")?.url === "https://a");

// Exercise the actual HTTP wire protocol against a keyless local provider.
let requests = 0;
let toolRuns = 0;
let redirect = false;
const localServer = createServer(async (req, res) => {
  requests++;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  ok("local HTTP path", req.url === "/v1/chat/completions");
  ok("local HTTP omits bearer when keyless", !req.headers.authorization);
  ok("local HTTP model retains Ollama tag", body.model === "qwen3:8b");
  if (redirect) {
    res.writeHead(302, { location: "http://169.254.169.254/" }).end();
    return;
  }
  const called = body.messages.some((message: { role: string }) => message.role === "tool");
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ finish_reason: called ? "stop" : "tool_calls", message: called
    ? { role: "assistant", content: '{"drafts":[]}' }
    : { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "search", arguments: '{"query":"TypeScript"}' } }] },
  }] }));
});
localServer.listen(0, "127.0.0.1");
await once(localServer, "listening");
try {
  const address = localServer.address() as { port: number };
  const args = {
    provider: "local" as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "qwen3:8b", system: "System", prompt: "Find profiles", key: "",
    servers: [{ url: "builtin:test", token: "", tools: [{ name: "search" }], run: async () => { toolRuns++; return { ok: true, content: [] }; } }],
  };
  const result = await runOpenAiWithTools(args);
  ok("local provider completes a real HTTP tool roundtrip", result.ok && result.text === '{"drafts":[]}' && requests === 2 && toolRuns === 1);
  redirect = true;
  const redirected = await runOpenAiWithTools(args);
  ok("local provider never follows redirects", !redirected.ok && requests === 3);
  const unsafe = await runOpenAiWithTools({ ...args, baseUrl: "http://169.254.169.254/v1" });
  ok("unsafe local provider is rejected before egress", !unsafe.ok && requests === 3);
} finally {
  await new Promise<void>((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
}

console.log(`RESULT mcp-tool-loop: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
