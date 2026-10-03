import {
  createFailedWorkspaceSave,
  workspaceAllowsMutation,
  workspaceBlocksProduct,
  type PendingWorkspaceSave,
  type WorkspaceStatus,
} from "../src/lib/workspace-status.ts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const statuses: WorkspaceStatus[] = [
  { phase: "loading", mode: "live" },
  { phase: "signed_out", mode: "live" },
  { phase: "unavailable", mode: "live", dependency: "state", message: "State unavailable" },
  { phase: "unsaved", mode: "live", message: "Changes are not saved" },
];

for (const status of statuses) {
  ok(`${status.phase} blocks product UI`, workspaceBlocksProduct(status));
  ok(`${status.phase} blocks mutations`, !workspaceAllowsMutation(status));
}

const liveReady: WorkspaceStatus = { phase: "ready", mode: "live" };
const demoReady: WorkspaceStatus = { phase: "ready", mode: "demo" };
ok("ready live workspace enables product UI", !workspaceBlocksProduct(liveReady));
ok("ready live workspace enables mutations", workspaceAllowsMutation(liveReady));
ok("demo readiness is explicit and enables product UI", !workspaceBlocksProduct(demoReady));
ok("demo readiness is explicit and enables mutations", workspaceAllowsMutation(demoReady));

const snapshot = { campaigns: [{ id: "campaign-1" }] };
const pending: PendingWorkspaceSave<typeof snapshot> = {
  snapshot,
  workspaceId: "workspace-1",
  expectedUpdatedAt: "version-1",
  generation: 1,
};
const failed = createFailedWorkspaceSave(pending, "database unavailable");
ok("failed save keeps the exact pending snapshot", failed.pending.snapshot === snapshot);
ok("failed save keeps its optimistic-concurrency token", failed.pending.expectedUpdatedAt === "version-1");
ok("failed save exposes an unsaved workspace status", failed.status.phase === "unsaved");

console.log(`RESULT workspace-status: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
