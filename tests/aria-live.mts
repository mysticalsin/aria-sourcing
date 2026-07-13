import { readFileSync } from "fs";
import { getAriaLiveRunPolicy } from "../src/lib/demo/aria-live-policy";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const demoPolicy = getAriaLiveRunPolicy(false);
ok("Aria Live is allowed for the isolated local demo", demoPolicy.ok === true);

const livePolicy = getAriaLiveRunPolicy(true);
ok("Aria Live is blocked for connected workspaces", livePolicy.ok === false);
ok("live-mode refusal explains the isolation requirement", !livePolicy.ok && /local demo|isolated/i.test(livePolicy.reason));

const director = readFileSync(new URL("../src/lib/demo/aria-live.ts", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../src/components/demo/aria-live-overlay.tsx", import.meta.url), "utf8");
const topbar = readFileSync(new URL("../src/components/app/topbar.tsx", import.meta.url), "utf8");
const settingsPage = readFileSync(new URL("../src/app/settings/page.tsx", import.meta.url), "utf8");
const specsRoute = readFileSync(new URL("../src/app/api/agents/specs/route.ts", import.meta.url), "utf8");
const specsRouteBanner = specsRoute.slice(0, specsRoute.indexOf("const ChannelEnum"));

ok("director applies the live-mode policy before starting a run", /getAriaLiveRunPolicy\(supabaseEnabled\)/.test(director));
ok("overlay uses a native dialog", overlay.includes("<dialog") && overlay.includes("ref={dialogRef}"));
ok("overlay opens the dialog modally", overlay.includes("showModal()"));
ok("overlay locks and unlocks document scrolling", overlay.includes("lockBodyScroll()") && overlay.includes("unlockBodyScroll()"));
ok("overlay owns Escape through the dialog cancel event", overlay.includes("onCancel"));
ok("overlay blocks pointer access through its stage", overlay.includes("pointer-events-auto"));
ok("overlay no longer exposes the cinematic as a non-modal region", !overlay.includes('role="region"'));
ok("overlay has no nested dialog role", !overlay.includes('role="dialog"'));
ok(
  "TopBar exposes Aria Live only as an explicit synthetic demo control outside live workspaces",
  topbar.includes("canRunSyntheticDemo") &&
    topbar.includes("!supabaseEnabled") &&
    topbar.includes("Synthetic demo") &&
    !topbar.includes(">Aria Live<"),
);
ok(
  "TopBar does not expose reset injection in live workspaces",
  topbar.includes("canResetSyntheticDemo") &&
    /canResetSyntheticDemo\s*&&\s*\(/s.test(topbar) &&
    !/toast\(\{\s*title:\s*"Reset to defaults"[^}]*variant:\s*"success"/s.test(topbar),
);
ok(
  "Settings does not expose reset injection in live workspaces",
  settingsPage.includes("canResetSyntheticDemo") &&
    settingsPage.includes("!supabaseEnabled") &&
    !settingsPage.includes("Reset to defaults"),
);
ok(
  "demo reset reports explicit synthetic demo behavior, not false success",
  topbar.includes("Synthetic demo reset") &&
    settingsPage.includes("Synthetic demo reset") &&
    !/variant:\s*"success"[^)]*Synthetic demo reset/s.test(`${topbar}\n${settingsPage}`),
);
ok(
  "agent specs route user-facing wording is queue-only human review, not autopilot/canary",
  specsRouteBanner.includes("queue-only") &&
    specsRouteBanner.includes("human review") &&
    !/autopilot|canary/i.test(specsRouteBanner),
);

console.log(`RESULT aria-live: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
