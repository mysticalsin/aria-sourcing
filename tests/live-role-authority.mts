import { buildSeedState } from "../src/lib/seed";
import { applyAuthoritativeRole, stripSharedRole } from "../src/lib/live-role-authority";
import { readFileSync } from "node:fs";
import { can } from "../src/lib/rbac";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const sharedAdminState = { ...buildSeedState(), currentRole: "admin" as const };
ok(
  "viewer profile overrides shared admin JSON",
  applyAuthoritativeRole(sharedAdminState, "viewer").currentRole === "viewer",
);
ok(
  "member profile overrides shared admin JSON",
  applyAuthoritativeRole(sharedAdminState, "member").currentRole === "member",
);
ok(
  "live persistence strips user-specific role from shared JSON",
  !("currentRole" in stripSharedRole(sharedAdminState)),
);

const workspaceSource = readFileSync(new URL("../src/lib/supabase/workspace.ts", import.meta.url), "utf8");
ok("workspace load resolves current_profile_role", /rpc\("current_profile_role"\)/.test(workspaceSource));

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
ok("live hydration applies the profile role", /applyAuthoritativeRole/.test(storeSource));
const authNullViewer = storeSource.indexOf('applyAuthoritativeRole(buildSeedState(), "viewer")');
const demoLoad = storeSource.indexOf("setState(loadState())", authNullViewer);
ok("live auth-null hydration returns a viewer shell before demo loading", authNullViewer >= 0 && demoLoad > authNullViewer);
ok(
  "live role switching is rejected in the store boundary",
  /setCurrentRole[\s\S]{0,500}if \(supabaseEnabled\) return/.test(storeSource),
);
ok(
  "store fleet creation enforces authoritative manage_fleet permission",
  /const addSeat[\s\S]{0,450}stateRef\.current[\s\S]{0,180}!authorizedState/.test(storeSource),
);
ok("pre-hydration empty authority defaults to viewer", /const EMPTY:[\s\S]*?currentRole: "viewer"/.test(storeSource));
ok("pre-hydration deploy denies when current state is absent", /const deployAgents[\s\S]{0,300}if \(!s\) return \{ created: 0/.test(storeSource));
ok("viewer cannot manage fleet", !can("viewer", "manage_fleet"));
ok("member cannot manage fleet", !can("member", "manage_fleet"));

const panelSource = readFileSync(new URL("../src/components/settings/roles-panel.tsx", import.meta.url), "utf8");
ok("live roles panel is informational rather than switchable", /supabaseEnabled[\s\S]{0,1500}assigned to your signed-in profile/.test(panelSource));
ok("demo role switcher is explicitly labelled preview", /preview/i.test(panelSource));

const fleetSource = readFileSync(new URL("../src/app/fleet/page.tsx", import.meta.url), "utf8");
ok("fleet add controls are conditionally absent for non-admin profiles", /actions=\{canManage \?/.test(fleetSource) && /\{canManage && <div/.test(fleetSource));
ok("fleet management remains hidden until authority hydration", /const canManage = hydrated && can\(role, "manage_fleet"\)/.test(fleetSource));
ok("fleet add handler repeats the authorization check", /function handleAddAgent\(\)[\s\S]{0,180}if \(!canManage\)/.test(fleetSource));

console.log(`RESULT live-role-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
