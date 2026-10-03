/* ==========================================================================
   tests/browser-agent-permissions.mts
   Claude-in-Chrome permission modes + LinkedIn host allowlist.
   ========================================================================== */

import {
  DEFAULT_BROWSER_AGENT_PERMISSIONS,
  isHostAllowedForBot,
  normalizeAllowedHost,
  parseBrowserAgentPermissions,
  permissionModeLabel,
  shouldPauseForOperator,
} from "../src/lib/browser-agent-permissions";
import { looksLikeLinkedInAuthWall } from "../src/lib/session-health";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("default mode is auto", DEFAULT_BROWSER_AGENT_PERMISSIONS.mode === "auto");
ok(
  "default hosts include linkedin.com",
  DEFAULT_BROWSER_AGENT_PERMISSIONS.allowedHosts.some((host) => host === "www.linkedin.com"),
);

const parsed = parseBrowserAgentPermissions({
  mode: "manual",
  allowedHosts: ["https://WWW.LinkedIn.com/feed", "talent.linkedin.com", "bad host"],
  pauseOnChallenge: true,
});
ok("parse keeps manual mode", parsed.mode === "manual");
ok(
  "parse normalizes hosts",
  parsed.allowedHosts.some((host) => host === "www.linkedin.com") &&
    parsed.allowedHosts.some((host) => host === "talent.linkedin.com") &&
    !parsed.allowedHosts.some((host) => host === "bad host"),
);

ok(
  "normalizeAllowedHost strips path",
  normalizeAllowedHost("https://linkedin.com/in/x") === "linkedin.com",
);

ok(
  "isHostAllowedForBot accepts LinkedIn profile URL",
  isHostAllowedForBot("https://www.linkedin.com/in/jane", parsed),
);
ok(
  "isHostAllowedForBot rejects unrelated host",
  !isHostAllowedForBot("https://evil.example/", parsed),
);

ok(
  "manual mode pauses for operator",
  shouldPauseForOperator({ mode: "manual" }) === true,
);
ok(
  "auto mode does not pause without challenge",
  shouldPauseForOperator({ mode: "auto", challengeDetected: false }) === false,
);
ok(
  "auto mode pauses on challenge",
  shouldPauseForOperator({ mode: "auto", challengeDetected: true }) === true,
);
ok(
  "permission labels match Claude Chrome wording",
  permissionModeLabel("manual").includes("Manually") &&
    permissionModeLabel("auto").includes("Automatically") &&
    permissionModeLabel("skip").includes("Skip"),
);

ok(
  "captcha copy trips auth wall",
  looksLikeLinkedInAuthWall("Please complete the captcha", "Security", "https://www.linkedin.com/checkpoint/challenge"),
);
ok(
  "unusual activity trips auth wall",
  looksLikeLinkedInAuthWall("We detected unusual activity", "", "https://www.linkedin.com/check/add"),
);
ok(
  "healthy feed does not trip auth wall",
  !looksLikeLinkedInAuthWall("Your feed", "Feed | LinkedIn", "https://www.linkedin.com/feed/"),
);

const supervisor = readFileSync("scripts/openbot-chromium-supervisor.mjs", "utf8");
ok(
  "supervisor uses humanTypeText for bot typing",
  supervisor.includes("async function humanTypeText") &&
    supervisor.includes("humanTypeText(rec.page, text"),
);
ok(
  "options page exists (Claude options.html parity)",
  readFileSync("src/app/fleet/computers/options/page.tsx", "utf8").includes(
    "Claude in Chrome",
  ),
);


const supervisorSrc = readFileSync("src/lib/computer-supervisor.ts", "utf8");
ok(
  "computer supervisor BE-gates manual permissionMode",
  supervisorSrc.includes("manual_permission_mode") &&
    supervisorSrc.includes('permissionMode === "manual"'),
);
const channelSrc = readFileSync("src/lib/linkedin-channel.ts", "utf8");
ok(
  "linkedin-channel passes browserAgentPermissionMode into enqueue payload",
  channelSrc.includes("browserAgentPermissionMode") && channelSrc.includes("permissionMode"),
);

console.log(`browser-agent-permissions: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
