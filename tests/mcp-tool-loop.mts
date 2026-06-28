import { buildAnthropicToolDefs, type ResolvedMcpServer } from "../src/lib/ai/tool-loop";

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
ok("preserves description", toolDefs.find((t) => t.name === "search")?.description === "Search");
ok(
  "passes through a valid input schema",
  JSON.stringify(toolDefs.find((t) => t.name === "search")?.input_schema) ===
    JSON.stringify({ type: "object", properties: { q: { type: "string" } } }),
);
ok("defaults a missing description to empty", toolDefs.find((t) => t.name === "enrich")?.description === "");
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

console.log(`RESULT mcp-tool-loop: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
