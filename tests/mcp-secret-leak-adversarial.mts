// Adversarial: the Tavily key must NEVER survive redaction, and applyMcpAuth must
// refuse a base URL that already carries the auth param. Visionary Level-10 guard.
import { applyMcpAuth, callMcpTool, connectAndListTools } from "../src/lib/mcp-client";
import { redactSecrets } from "../src/lib/log-redact";
import { createProcessEnvScope } from "./helpers/process-env.mts";

const environment = createProcessEnvScope(["NODE_ENV", "ARIA_ENABLE_REMOTE_MCP_EXECUTION"]);
environment.set({ NODE_ENV: "test", ARIA_ENABLE_REMOTE_MCP_EXECUTION: "true" });

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

const SECRET = "tvly-dev-SUPERSECRET123-ZZ";
const a = applyMcpAuth("https://mcp.tavily.com/mcp/", SECRET, { authStyle: "query", authQueryParam: "tavilyApiKey" });

ok("assembled url carries the key for the live call", a.url.includes(SECRET));
ok("query auth uses no bearer token", a.token === "");

// The key-bearing URL, when logged, must be redacted.
const logged = redactSecrets(`MCP connect failed for ${a.url} (status 500)`);
ok("redacted log does NOT contain the raw key", !logged.includes(SECRET));
ok("redacted log shows a REDACTED marker", /REDACTED/i.test(logged));

// A base URL already carrying the param must be rejected (can't smuggle a key in).
let threw = false;
try { applyMcpAuth("https://x.example/?tavilyApiKey=smuggled", SECRET, { authStyle: "query", authQueryParam: "tavilyApiKey" }); }
catch { threw = true; }
ok("applyMcpAuth throws on a base url that already has the auth param", threw);

// Missing param on query style must throw (no silent bare URL).
let threw2 = false;
try { applyMcpAuth("https://x.example/", SECRET, { authStyle: "query" }); }
catch { threw2 = true; }
ok("applyMcpAuth throws when query style has no param", threw2);

// Bearer path unchanged (backward compat).
const b = applyMcpAuth("https://server/mcp", SECRET, { authStyle: "bearer" });
ok("bearer path: url unchanged, token=secret", b.url === "https://server/mcp" && b.token === SECRET);

function echoingMcpFetch(echoedSecret: string) {
  return async (_url: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
    let result: Record<string, unknown> = {};
    if (request.method === "initialize") {
      result = { serverInfo: { name: `server-${echoedSecret}` } };
    } else if (request.method === "tools/list") {
      result = {
        tools: [
          {
            name: "safe_tool",
            description: `description ${echoedSecret}`,
            inputSchema: { example: echoedSecret, [echoedSecret]: "secret used as an object key" },
          },
          { name: `leak_${echoedSecret}`, description: "must be dropped", inputSchema: { type: "object" } },
        ],
      };
    } else if (request.method === "tools/call") {
      result = {
        content: [
          { type: "text", text: `tool output ${echoedSecret}` },
          { [echoedSecret]: "secret used as an object key" },
        ],
      };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const unusualBearer = "short-unusual-bearer-value";
const bearerFetch = echoingMcpFetch(unusualBearer);
const bearerList = await connectAndListTools("https://mcp.example.test/", unusualBearer, { fetchImpl: bearerFetch });
const bearerCall = await callMcpTool("https://mcp.example.test/", unusualBearer, "safe_tool", {}, { fetchImpl: bearerFetch });
ok("successful MCP metadata cannot echo a bearer credential", !JSON.stringify(bearerList).includes(unusualBearer));
ok("successful MCP tool output cannot echo a bearer credential", !JSON.stringify(bearerCall).includes(unusualBearer));
ok("tool names containing a bearer credential are dropped", bearerList.tools?.every((tool) => !tool.name.includes("leak_")) === true);
const bearerSchema = bearerList.tools?.find((tool) => tool.name === "safe_tool")?.inputSchema as Record<string, unknown> | undefined;
const bearerContent = bearerCall.content as Record<string, unknown>[] | undefined;
ok("schema keys containing a bearer credential are dropped", bearerSchema !== undefined && Object.keys(bearerSchema).length === 1 && bearerSchema.example === "");
ok(
  "tool-output keys containing a bearer credential are dropped",
  Array.isArray(bearerContent) && Object.keys(bearerContent[1] ?? {}).length === 0,
);

const unusualQuery = "short-unusual-query-value";
const queryAuth = applyMcpAuth("https://mcp.example.test/", unusualQuery, {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
const queryList = await connectAndListTools(queryAuth.url, queryAuth.token, { fetchImpl: echoingMcpFetch(unusualQuery) });
const queryCall = await callMcpTool(queryAuth.url, queryAuth.token, "safe_tool", {}, { fetchImpl: echoingMcpFetch(unusualQuery) });
ok("successful MCP metadata cannot echo a query credential", !JSON.stringify(queryList).includes(unusualQuery));
ok("successful MCP tool output cannot echo a query credential", !JSON.stringify(queryCall).includes(unusualQuery));

const arbitraryQuerySecret = "secret-in-an-unnamed-query-field";
const arbitraryQueryUrl = `https://mcp.example.test/?cursor=${encodeURIComponent(arbitraryQuerySecret)}`;
const arbitraryQueryList = await connectAndListTools(arbitraryQueryUrl, "", {
  fetchImpl: echoingMcpFetch(arbitraryQuerySecret),
});
const arbitraryQueryCall = await callMcpTool(arbitraryQueryUrl, "", "safe_tool", {}, {
  fetchImpl: echoingMcpFetch(arbitraryQuerySecret),
});
ok("successful MCP metadata cannot echo an arbitrary query value", !JSON.stringify(arbitraryQueryList).includes(arbitraryQuerySecret));
ok("successful MCP tool output cannot echo an arbitrary query value", !JSON.stringify(arbitraryQueryCall).includes(arbitraryQuerySecret));

function primitiveEchoingMcpFetch(echoed: number | boolean) {
  return async (_url: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
    let result: Record<string, unknown> = {};
    if (request.method === "initialize") {
      result = { serverInfo: { name: "safe-server" } };
    } else if (request.method === "tools/list") {
      result = { tools: [{ name: "safe_tool", inputSchema: { echo: echoed } }] };
    } else if (request.method === "tools/call") {
      result = { content: [echoed] };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

for (const primitiveSecret of ["42", "true"] as const) {
  const primitive = primitiveSecret === "42" ? 42 : true;
  const primitiveFetch = primitiveEchoingMcpFetch(primitive);
  const primitiveList = await connectAndListTools("https://mcp.example.test/", primitiveSecret, { fetchImpl: primitiveFetch });
  const primitiveCall = await callMcpTool("https://mcp.example.test/", primitiveSecret, "safe_tool", {}, { fetchImpl: primitiveFetch });
  const schema = primitiveList.tools?.[0]?.inputSchema as Record<string, unknown> | undefined;
  ok(`MCP schema scrubs a ${typeof primitive} credential echo`, schema?.echo === null);
  ok(`MCP tool output scrubs a ${typeof primitive} credential echo`, Array.isArray(primitiveCall.content) && primitiveCall.content[0] === null);
}

const markerSecret = "[REDACTED]";
const markerFetch = echoingMcpFetch(markerSecret);
const markerList = await connectAndListTools("https://mcp.example.test/", markerSecret, { fetchImpl: markerFetch });
const markerCall = await callMcpTool("https://mcp.example.test/", markerSecret, "safe_tool", {}, { fetchImpl: markerFetch });
ok("marker-shaped bearer credential cannot survive MCP metadata sanitization", !JSON.stringify(markerList).includes(markerSecret));
ok("marker-shaped bearer credential cannot survive MCP tool-output sanitization", !JSON.stringify(markerCall).includes(markerSecret));
ok("tool names containing a marker-shaped credential are dropped", markerList.tools?.length === 1);

environment.restore();

console.log(`RESULT mcp-secret-leak-adversarial: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
