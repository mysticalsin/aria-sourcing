// LIVE probe: does the app's own MCP client connect to Tavily's hosted MCP server
// and list its tools? Key comes from .env.local (TAVILY_API_KEY), injected as the
// Tavily MCP query auth. No secret printed.
import { readFileSync } from "node:fs";
import { applyMcpAuth, connectAndListTools, callMcpTool } from "../src/lib/mcp-client";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}

const key = process.env.TAVILY_API_KEY ?? "";
if (!key) { console.error("PROBE FAIL: TAVILY_API_KEY missing"); process.exit(1); }

const auth = applyMcpAuth("https://mcp.tavily.com/mcp/", key, {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
console.log("[1] connecting to Tavily MCP (key in query, not printed)…");

const res = await connectAndListTools(auth.url, auth.token);
if (!res.ok) { console.error(`PROBE FAIL: connect/list → ${res.error}`); process.exit(1); }
console.log(`[2] connected. tools (${res.tools?.length ?? 0}):`);
for (const t of res.tools ?? []) console.log(`    - ${t.name}: ${(t.description ?? "").slice(0, 70)}`);

// Try a real search tool call if one is exposed.
const searchTool = (res.tools ?? []).find((t) => /search/i.test(t.name));
if (searchTool) {
  console.log(`[3] calling ${searchTool.name}("site:linkedin.com/in senior react engineer london")…`);
  const call = await callMcpTool(auth.url, auth.token, searchTool.name, { query: "site:linkedin.com/in senior react engineer london" });
  if (call.ok) {
    const s = JSON.stringify(call.content ?? call).slice(0, 400);
    const li = (s.match(/linkedin\.com\/in\//gi) || []).length;
    console.log(`    result ok — ${li} linkedin.com/in mention(s). sample: ${s.slice(0, 200)}…`);
    console.log(li > 0 ? "PROBE PASS: Tavily MCP returns real LinkedIn results via the app's MCP client." : "PROBE PARTIAL: connected + tool call ok, but no linkedin.com/in in the sampled slice.");
  } else {
    console.log(`    tool call error: ${call.error}`);
    console.log("PROBE PARTIAL: connected + listed tools, tool call failed (may need different arg shape).");
  }
} else {
  console.log("PROBE PARTIAL: connected + listed tools, no search-named tool found.");
}
process.exit(0);
