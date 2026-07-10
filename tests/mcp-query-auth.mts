import { connectAndListTools, applyMcpAuth } from "../src/lib/mcp-client";
import { redactSecrets } from "../src/lib/log-redact";
import { validateMcpBaseUrlHasNoAuthQueryParam } from "../src/lib/mcp-auth-params";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const bearer = applyMcpAuth("https://mcp.example.com/mcp", "SEKRET");
ok("bearer leaves url unchanged", bearer.url === "https://mcp.example.com/mcp");
ok("bearer returns token", bearer.token === "SEKRET");

const query = applyMcpAuth("https://mcp.tavily.com/mcp/", "SEKRET", {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
ok("query adds auth param", new URL(query.url).searchParams.get("tavilyApiKey") === "SEKRET");
ok("query returns empty bearer token", query.token === "");

const withExistingQuery = applyMcpAuth("https://mcp.tavily.com/mcp/?foo=bar", "SEKRET", {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
ok("existing query appends with ampersand", withExistingQuery.url.includes("?foo=bar&tavilyApiKey="));

const specialSecret = "S E&K?R=E/T#";
const special = applyMcpAuth("https://mcp.tavily.com/mcp/", specialSecret, {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
ok("special chars round-trip through URL encoding", new URL(special.url).searchParams.get("tavilyApiKey") === specialSecret);
ok("special chars are encoded in raw url", !special.url.includes("S E&K?R=E/T#"));

ok(
  "query auth throws when param already exists case-insensitively",
  (() => {
    try {
      applyMcpAuth("https://mcp.tavily.com/mcp/?TavilyApiKey=already", "SEKRET", {
        authStyle: "query",
        authQueryParam: "tavilyApiKey",
      });
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  "query auth throws when param missing",
  (() => {
    try {
      applyMcpAuth("https://mcp.tavily.com/mcp/", "SEKRET", { authStyle: "query" });
      return false;
    } catch {
      return true;
    }
  })(),
);

const redacted = redactSecrets("https://mcp.tavily.com/mcp/?tavilyApiKey=SEKRET");
ok("redacts Tavily query secret", redacted.includes("tavilyApiKey=REDACTED"));
ok("redaction removes raw query secret", !redacted.includes("SEKRET"));

const saveGuard = validateMcpBaseUrlHasNoAuthQueryParam("https://mcp.tavily.com/mcp/?tavilyApiKey=SEKRET");
ok("base-url save guard rejects auth query param", saveGuard.ok === false);

const rawSecret = "SEKRET-URL-FAIL";
const failingAuth = applyMcpAuth("https://mcp.tavily.com/mcp/", rawSecret, {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { message: `Denied ${String(input)}` },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
try {
  const failed = await connectAndListTools(failingAuth.url, failingAuth.token);
  const error = failed.error ?? "";
  ok("failing query-auth error contains host", failed.ok === false && error.includes("mcp.tavily.com"));
  ok("failing query-auth error omits raw key", !error.includes(rawSecret));
  ok("failing query-auth error omits auth query field", !error.includes("tavilyApiKey"));
} finally {
  globalThis.fetch = realFetch;
}

console.log(`RESULT mcp-query-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
