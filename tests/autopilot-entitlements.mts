import { can } from "../src/lib/rbac";
import { decideAutopilot } from "../src/lib/autopilot";
import { remoteMcpExecutionEnabled, remoteMcpDiscoveryEnabled } from "../src/lib/mcp-client";
import { readFileSync, existsSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

ok("admin can manage_autopilot", can("admin", "manage_autopilot"));
ok("member cannot manage_autopilot", !can("member", "manage_autopilot"));
ok("viewer cannot manage_autopilot", !can("viewer", "manage_autopilot"));

const clean =
  "Good question! The team works in TypeScript and Go, mostly backend services. Want me to set up a quick call so you can meet the lead?";

{
  const denied = decideAutopilot(clean, { autopilot: true, canary_remaining: 0 }, undefined, {
    autopilotEnabled: false,
  });
  ok("non-entitled user stays on human queue", denied.action === "queue");
}

{
  const allowed = decideAutopilot(clean, { autopilot: true, canary_remaining: 0 }, undefined, {
    autopilotEnabled: true,
  });
  ok("entitled user becomes auto-approve eligible", allowed.action === "auto_approve_eligible");
}

ok(
  "production MCP stays denied without allowlist",
  !remoteMcpExecutionEnabled({ NODE_ENV: "production", ARIA_ENABLE_REMOTE_MCP_EXECUTION: "true" }),
);
ok(
  "production MCP opens only when allowlisted",
  remoteMcpExecutionEnabled(
    { NODE_ENV: "production", ARIA_ENABLE_REMOTE_MCP_EXECUTION: "false" },
    { allowlisted: true },
  ),
);
ok(
  "production discovery mirrors execution allowlist gate",
  remoteMcpDiscoveryEnabled({ NODE_ENV: "production" }, { allowlisted: true }) &&
    !remoteMcpDiscoveryEnabled({ NODE_ENV: "production" }, { allowlisted: false }),
);

ok("migration 0055 present", existsSync("supabase/migrations/0055_autopilot_entitlements_and_templates.sql"));
ok("migration 0056 present", existsSync("supabase/migrations/0056_mcp_allowlist_authority.sql"));
ok("API map present", existsSync("docs/API.md"));
ok("issues register present", existsSync("_relay/issues-open.md"));

const migration = readFileSync("supabase/migrations/0055_autopilot_entitlements_and_templates.sql", "utf8");
ok("0055 defines set_member_autopilot", /create or replace function public\.set_member_autopilot/i.test(migration));
ok(
  "0055 accepts template_bound approval source",
  /template_bound/.test(migration) && /outreach_templates/.test(migration),
);
ok(
  "0055 wires outbound_approval_authorizes_send into LinkedIn claim",
  /claim_linkedin_outbound_queued/.test(migration) &&
    /outbound_approval_authorizes_send/.test(migration),
);

const allowlist = readFileSync("supabase/migrations/0056_mcp_allowlist_authority.sql", "utf8");
ok("0056 creates mcp_server_allowlist", /create table if not exists public\.mcp_server_allowlist/i.test(allowlist));
ok("0056 has mcp_allowlist_permits", /mcp_allowlist_permits/.test(allowlist));

const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
ok(
  "loop worker can auto-enqueue drafts for entitled shortlists",
  /entitled auto-approve/i.test(worker) && /approvalSource: "autopilot_shortlist"/.test(worker),
);

console.log(`RESULT autopilot-entitlements: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
