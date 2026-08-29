import { applyMcpAuth } from "../src/lib/mcp-client.ts";
import {
  HEYREACH_MCP_HOST,
  HEYREACH_MCP_INTEGRATION_ID,
  HEYREACH_MCP_SERVER_NAME,
  findHeyReachMcpServer,
  isHeyReachMcpUrl,
  validateHeyReachMcpUrl,
} from "../src/lib/heyreach-mcp.ts";
import { defaultIntegrations } from "../src/lib/integrations.ts";
import { validateMcpBaseUrl } from "../src/lib/mcp-auth-params.ts";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("HeyReach host accepted", isHeyReachMcpUrl("https://mcp.heyreach.io/workspace-abc"));
ok("HeyReach rejects other hosts", !isHeyReachMcpUrl("https://evil.example/mcp"));
ok("HeyReach rejects query in stored url", validateHeyReachMcpUrl("https://mcp.heyreach.io/w?key=secret").ok === false);

const good = validateHeyReachMcpUrl("https://mcp.heyreach.io/my-workspace");
ok("valid HeyReach MCP url passes", good.ok === true);

const xAuth = applyMcpAuth("https://mcp.heyreach.io/ws", "hr_secret", { authStyle: "x-api-key" });
ok("x-api-key keeps url clean", xAuth.url === "https://mcp.heyreach.io/ws");
ok("x-api-key returns token", xAuth.token === "hr_secret");
ok("x-api-key auth style tagged", xAuth.authStyle === "x-api-key");

const bearer = applyMcpAuth("https://mcp.example.com/mcp", "SEKRET");
ok("bearer default unchanged", bearer.authStyle === "bearer");

const servers = [
  { id: "m1", name: "Other", url: "https://mcp.example.com/mcp", enabled: true, status: "connected" as const },
  {
    id: "m2",
    name: HEYREACH_MCP_SERVER_NAME,
    url: "https://mcp.heyreach.io/acme",
    enabled: true,
    status: "connected" as const,
    preset: "heyreach" as const,
  },
];
ok("findHeyReachMcpServer locates preset", findHeyReachMcpServer(servers)?.id === "m2");

const integ = defaultIntegrations().find((i) => i.id === HEYREACH_MCP_INTEGRATION_ID);
ok("integrations catalogue includes HeyReach MCP", Boolean(integ?.real));

const panel = readFileSync("src/components/settings/heyreach-mcp-panel.tsx", "utf8");
ok("settings panel wires connect + test", /Connect HeyReach MCP/.test(panel) && /testMcpServer/.test(panel));
ok("settings panel saves API delivery inline", /Save HeyReach API/.test(panel) && /Paste HeyReach API key/.test(panel));
ok("settings panel accepts campaign id", /heyreach-campaign-id/.test(panel));

const settings = readFileSync("src/app/settings/page.tsx", "utf8");
ok(
  "integrations tab mounts LinkedIn outreach stack",
  settings.includes("LinkedInOutreachStack"),
);

const guide = readFileSync("src/components/settings/setup-guide-panel.tsx", "utf8");
ok("setup guide includes HeyReach step", /Add HeyReach \(LinkedIn\)/.test(guide) && /heyreach-settingsReady|heyReachSettingsReady/.test(guide));
ok("setup guide links LinkedIn stack anchor", /linkedin-outreach-stack/.test(guide));

console.log(`RESULT heyreach-mcp: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
