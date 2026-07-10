// Adversarial: the Tavily key must NEVER survive redaction, and applyMcpAuth must
// refuse a base URL that already carries the auth param. Visionary Level-10 guard.
import { applyMcpAuth } from "../src/lib/mcp-client";
import { redactSecrets } from "../src/lib/log-redact";

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

console.log(`RESULT mcp-secret-leak-adversarial: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
