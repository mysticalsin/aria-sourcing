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

const mig = readFileSync("supabase/migrations/0076_autopilot_critics_approval.sql", "utf8");
ok("0076 email enqueue requires approval", /enqueue_email_outbound_service[\s\S]*approval-required/.test(mig));
ok("0076 mint requires sequences armed", /mint_autopilot_critics_approval[\s\S]*sequences_not_armed/.test(mig));

const mig79 = readFileSync("supabase/migrations/0079_autopilot_enqueue_approval_hash_bind.sql", "utf8");
ok(
  "0079 Autopilot enqueue binds body_hash + scope for Email/WA/LinkedIn",
  (mig79.match(/reason', 'approval-mismatch'/g) ?? []).length === 3
    && /'Email'/.test(mig79)
    && /'WhatsApp'/.test(mig79)
    && /'LinkedIn'/.test(mig79),
);

const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
ok("worker only autopilots qualityStatus ready", /qualityStatus === "ready"/.test(worker) && /criticsPassed: true/.test(worker));
ok("worker sweeps autopilot ready drafts", /sweepAutopilotReadyDrafts/.test(worker) && /sweep: true/.test(worker));
ok("worker autopilots interview prep when critics green", /handleInterviewPrepSend[\s\S]*criticsPassed: true/.test(worker));
ok(
  "worker fail-closes confirm statuses outside soft Graph/ops allowlist",
  /calendar_confirm_\$\{confirm\.status\}/.test(worker)
    && /calendar_confirm_unexpected/.test(worker),
);

const cron = readFileSync("src/app/api/cron/autopilot-send-outreach/route.ts", "utf8");
ok("cron requires criticsPassed === true", /criticsPassed: parsed\.data\.criticsPassed === true/.test(cron));
ok("sweep filters ready+critics", /qualityStatus === "ready"/.test(cron) && /qualityCriticsUsed === true/.test(cron));
ok("sweep honors recipientOverride", /recipientOverride/.test(cron));

const prepCron = readFileSync("src/app/api/cron/interview-prep-dispatch/route.ts", "utf8");
ok("prep dispatch runs live critics", /validateOutreachQualityLive/.test(prepCron));
ok("prep dispatch uses booking slice RPC", /loadBookingForLoop|read_workspace_booking_for_loop/.test(prepCron));
ok("autopilot send uses post-0074 slices", /loadReadyAutopilotOutreachSweep|mergeOutreachMessageScheduled/.test(cron));
ok(
  "poll-provider-run uses campaign + identity slices (no full state blob)",
  (() => {
    const poll = readFileSync("src/app/api/cron/poll-provider-run/route.ts", "utf8");
    return (
      /loadCampaignForLoop/.test(poll) &&
      /read_workspace_candidate_identities_for_loop/.test(poll) &&
      !/read_workspace_state_for_loop/.test(poll)
    );
  })(),
);
const transitions = readFileSync("src/lib/langchain/pipeline-transitions.json", "utf8");
ok(
  "pipeline claims interview_prep_send after live book",
  /"first_interview_book":\s*\["interview_prep_send"\]/.test(transitions) &&
    /"interview_prep_send":\s*\[\]/.test(transitions),
);

console.log(`RESULT heyreach-mcp: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
