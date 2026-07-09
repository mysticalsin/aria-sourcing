/**
 * Unit tests for browser-tools.ts. No live Obscura sidecar needed -- everything
 * here either fails before ever reaching the sidecar (SSRF/vocabulary/unknown
 * session) or is a pure function (robots.txt parsing). The live-sidecar
 * integration test lives in tests/obscura-integration.mts (run separately via
 * `npm run test:obscura`, since it needs `docker compose up obscura`).
 */
import {
  runBrowserTool,
  isBrowserTool,
  BROWSER_TOOL_DEFS,
  parseRobotsTxt,
  isPathAllowed,
} from "../src/lib/ai/browser-tools";
import { readFileSync } from "fs";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, extra ?? "");
  }
}

/* -------- tool defs never expose a credential-entry action -------- */

const actDef = BROWSER_TOOL_DEFS.find((t) => t.name === "browser_act");
const enumValues = (actDef?.inputSchema as { properties?: { type?: { enum?: string[] } } })?.properties?.type?.enum ?? [];
ok(
  "browser_act enum exposes read-only research actions only",
  JSON.stringify([...enumValues].sort()) === JSON.stringify(["back", "click", "forward", "scroll", "wait"]),
  enumValues,
);

const allPropertyKeys = BROWSER_TOOL_DEFS.flatMap(
  (t) => Object.keys((t.inputSchema as { properties?: object })?.properties ?? {}),
);
ok(
  "read-only action property keys exist without a text-entry value",
  allPropertyKeys.includes("selector") && allPropertyKeys.includes("direction") && allPropertyKeys.includes("ms") && !allPropertyKeys.includes("value"),
  allPropertyKeys,
);

ok("all 5 tools registered", BROWSER_TOOL_DEFS.length === 5);
ok("isBrowserTool true for browser_open", isBrowserTool("browser_open"));
ok("isBrowserTool false for an unregistered name", !isBrowserTool("browser_type"));

/* -------- dispatch-level defense in depth (no live session needed) -------- */

const main = async () => {
  for (const type of ["type", "fill", "press_key", "select_option", "evaluate"]) {
    const disallowed = await runBrowserTool("browser_act", { sessionId: "does-not-exist", type, selector: "#u", value: "hello" });
    ok(`browser_act rejects non-read-only '${type}' before session lookup`, disallowed.ok === false && /not allowed/i.test(String(disallowed.error)), disallowed);
  }

  const unknownSession = await runBrowserTool("browser_act", { sessionId: "does-not-exist", type: "click", selector: "#x" });
  ok(
    "a valid action against an unknown session reports session-not-found, not a vocabulary error",
    unknownSession.ok === false && /session/i.test(String(unknownSession.error)),
    unknownSession,
  );

  const unknownTool = await runBrowserTool("browser_type_text", {});
  ok("unknown tool name is rejected", unknownTool.ok === false);

  /* -------- SSRF guard blocks before ever touching the sidecar -------- */

  const loopback = await runBrowserTool("browser_open", { url: "http://127.0.0.1:9222/" });
  ok("browser_open refuses a loopback URL (SSRF)", loopback.ok === false, loopback);

  const privateIp = await runBrowserTool("browser_open", { url: "http://10.1.2.3/" });
  ok("browser_open refuses a private-range URL (SSRF)", privateIp.ok === false, privateIp);

  const badScheme = await runBrowserTool("browser_open", { url: "file:///etc/passwd" });
  ok("browser_open refuses a non-http(s) scheme", badScheme.ok === false, badScheme);

  // browser_close is safe to call on an unknown/already-closed session.
  const closeUnknown = await runBrowserTool("browser_close", { sessionId: "does-not-exist" });
  ok("browser_close on an unknown session still reports ok", closeUnknown.ok === true, closeUnknown);

  /* -------- robots.txt parsing (pure, no network) -------- */

  const wildcardOnly = parseRobotsTxt("User-agent: *\nDisallow: /private\nAllow: /private/public-page\n");
  const wildcardRules = wildcardOnly.get("*")!;
  ok("wildcard group parsed", !!wildcardRules);
  ok("Disallow blocks the private path", !isPathAllowed(wildcardRules, "/private/secret"));
  ok("longer Allow overrides the shorter Disallow", isPathAllowed(wildcardRules, "/private/public-page"));
  ok("unrelated path stays allowed", isPathAllowed(wildcardRules, "/public"));

  const emptyDisallow = parseRobotsTxt("User-agent: *\nDisallow:\n");
  ok("an empty Disallow value means allow-everything", isPathAllowed(emptyDisallow.get("*")!, "/anything"));

  const namedAndWildcard = parseRobotsTxt(
    "User-agent: ariaresearchbot\nDisallow: /no-bots-of-this-name\n\nUser-agent: *\nDisallow: /generic-block\n",
  );
  ok("named UA group is separate from wildcard", !isPathAllowed(namedAndWildcard.get("ariaresearchbot")!, "/no-bots-of-this-name"));
  ok("named UA group isn't blocked by the wildcard's rule", isPathAllowed(namedAndWildcard.get("ariaresearchbot")!, "/generic-block"));
  ok("wildcard group still has its own rule", !isPathAllowed(namedAndWildcard.get("*")!, "/generic-block"));

  const multiAgentGroup = parseRobotsTxt("User-agent: googlebot\nUser-agent: bingbot\nDisallow: /shared-block\n");
  ok("a rule line applies to every User-agent line in the same group", !isPathAllowed(multiAgentGroup.get("bingbot")!, "/shared-block"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

const launcher = readFileSync(new URL("../src/lib/ai/obscura-launcher.ts", import.meta.url), "utf8");
ok("sidecar launcher does not enable stealth", !/--stealth/.test(launcher));
ok("sidecar launcher does not permit private-network browsing", !/--allow-private-network/.test(launcher));

main().catch((err) => {
  console.error("TEST CRASHED:", err);
  process.exit(1);
});
