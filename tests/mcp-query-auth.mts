import { connectAndListTools, applyMcpAuth } from "../src/lib/mcp-client";
import { redactSecrets } from "../src/lib/log-redact";
import { validateMcpBaseUrl } from "../src/lib/mcp-auth-params";
import { readFileSync } from "node:fs";

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

const saveGuard = validateMcpBaseUrl("https://mcp.tavily.com/mcp/?tavilyApiKey=SEKRET");
ok("base-url save guard rejects auth query param", saveGuard.ok === false);
const arbitraryQueryGuard = validateMcpBaseUrl("https://mcp.example.com/mcp?cursor=not-a-secret");
ok("base-url save guard rejects every query parameter", arbitraryQueryGuard.ok === false);
ok(
  "base-url save guard rejects non-HTTPS endpoints",
  validateMcpBaseUrl("http://mcp.example.com/mcp").ok === false,
);
ok(
  "base-url save guard rejects embedded userinfo",
  validateMcpBaseUrl("https://user:password@mcp.example.com/mcp").ok === false,
);
ok(
  "base-url save guard rejects fragments",
  validateMcpBaseUrl("https://mcp.example.com/mcp#secret-fragment").ok === false,
);
ok(
  "base-url save guard rejects a non-standard HTTPS port",
  validateMcpBaseUrl("https://mcp.example.com:8443/mcp").ok === false,
);
ok(
  "base-url save guard accepts the standard HTTPS port",
  validateMcpBaseUrl("https://mcp.example.com:443/mcp").ok === true,
);

ok(
  "bearer auth rejects a base URL with arbitrary query parameters",
  (() => {
    try {
      applyMcpAuth("https://mcp.example.com/mcp?cursor=not-a-secret", "SEKRET", { authStyle: "bearer" });
      return false;
    } catch {
      return true;
    }
  })(),
);

ok(
  "query auth rejects a base URL with arbitrary query parameters",
  (() => {
    try {
      applyMcpAuth("https://mcp.example.com/mcp?cursor=not-a-secret", "SEKRET", {
        authStyle: "query",
        authQueryParam: "tavilyApiKey",
      });
      return false;
    } catch {
      return true;
    }
  })(),
);

const rawSecret = "SEKRET-URL-FAIL";
const failingAuth = applyMcpAuth("https://mcp.tavily.com/mcp/", rawSecret, {
  authStyle: "query",
  authQueryParam: "tavilyApiKey",
});
const failingFetch = async (input: string | URL) =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { message: `Denied ${String(input)}` },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
const originalNodeEnv = process.env.NODE_ENV;
const originalRemoteMcpFlag = process.env.ARIA_ENABLE_REMOTE_MCP_EXECUTION;
process.env.NODE_ENV = "test";
process.env.ARIA_ENABLE_REMOTE_MCP_EXECUTION = "true";
const failed = await connectAndListTools(failingAuth.url, failingAuth.token, { fetchImpl: failingFetch });
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
if (originalRemoteMcpFlag === undefined) delete process.env.ARIA_ENABLE_REMOTE_MCP_EXECUTION;
else process.env.ARIA_ENABLE_REMOTE_MCP_EXECUTION = originalRemoteMcpFlag;
const error = failed.error ?? "";
ok("failing query-auth error contains only the expected host context", failed.ok === false && error === "MCP initialize failed (mcp.tavily.com).");
ok("failing query-auth error omits raw key", !error.includes(rawSecret));
ok("failing query-auth error omits auth query field", !error.includes("tavilyApiKey"));

const hermesRouteSource = readFileSync("src/app/api/hermes/chat/route.ts", "utf8");
ok("Hermes MCP comment no longer claims generic http(s) support", !hermesRouteSource.includes("http(s) only"));

console.log(`RESULT mcp-query-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
