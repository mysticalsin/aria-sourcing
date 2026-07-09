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

ok("director applies the live-mode policy before starting a run", /getAriaLiveRunPolicy\(supabaseEnabled\)/.test(director));
ok("overlay uses a native dialog", overlay.includes("<dialog") && overlay.includes("ref={dialogRef}"));
ok("overlay opens the dialog modally", overlay.includes("showModal()"));
ok("overlay locks and unlocks document scrolling", overlay.includes("lockBodyScroll()") && overlay.includes("unlockBodyScroll()"));
ok("overlay owns Escape through the dialog cancel event", overlay.includes("onCancel"));
ok("overlay blocks pointer access through its stage", overlay.includes("pointer-events-auto"));
ok("overlay no longer exposes the cinematic as a non-modal region", !overlay.includes('role="region"'));
ok("overlay has no nested dialog role", !overlay.includes('role="dialog"'));

console.log(`RESULT aria-live: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
