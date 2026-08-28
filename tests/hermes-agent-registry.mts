import {
  HERMES_QUALITY_CRITICS,
  HERMES_RECRUITING_AGENTS,
  MANTU_SOURCING_MISSION,
  resolveHermesAgentForTask,
} from "../src/lib/agents/hermes-agent-registry";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

ok("shared Mantu sourcing mission is defined", MANTU_SOURCING_MISSION.includes("qualified candidates"));
ok("four loop agents registered", HERMES_RECRUITING_AGENTS.length === 4);
ok("three quality critics registered", HERMES_QUALITY_CRITICS.length === 3);

for (const task of ["outreach", "classify", "sourcing", "chat"] as const) {
  const agent = resolveHermesAgentForTask(task);
  ok(`task ${task} resolves to an agent`, Boolean(agent?.id));
  ok(`task ${task} agent shares mission`, agent?.mission === MANTU_SOURCING_MISSION);
}

ok(
  "outreach agent uses candidate-thread memory",
  resolveHermesAgentForTask("outreach")?.memoryScope === "candidate-thread",
);
ok(
  "critics are stateless peers",
  HERMES_QUALITY_CRITICS.every((critic) => critic.memoryScope === "stateless"),
);

console.log(`RESULT hermes-agent-registry: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
