/* ==========================================================================
   tests/computer-supervisor.mts
   OpenBot-shaped computer supervisor — takeover mutex, job refuse.
   ========================================================================== */

import { ComputerSupervisor } from "../src/lib/computer-supervisor";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const previousMock = process.env.COMPUTER_SUPERVISOR_MOCK_SEND;
const previousUrl = process.env.COMPUTER_SUPERVISOR_URL;
const previousToken = process.env.COMPUTER_SUPERVISOR_TOKEN;
process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
delete process.env.COMPUTER_SUPERVISOR_URL;
delete process.env.COMPUTER_SUPERVISOR_TOKEN;

try {
  const supervisor = new ComputerSupervisor();
  const computer = supervisor.ensureComputer({ workspaceId: "ws", seatId: "seat-1" });
  ok("ensureComputer registers stopped computer", computer.status === "stopped");
  ok("default control is bot", computer.control === "bot");

  await supervisor.start(computer.computerId);
  ok("start flips to ready", supervisor.get(computer.computerId)?.status === "ready");
  ok(
    "start without remote OpenBot sets Aria viewport remoteUrl",
    Boolean(supervisor.get(computer.computerId)?.remoteUrl?.includes("/viewport")),
  );

  await supervisor.takeControl(computer.computerId);
  ok("takeControl sets human", supervisor.get(computer.computerId)?.control === "human");
  ok(
    "takeControl keeps viewport remoteUrl",
    Boolean(supervisor.get(computer.computerId)?.remoteUrl?.includes("/viewport")),
  );

  const refused = await supervisor.enqueueJob({
    computerId: computer.computerId,
    kind: "linkedin_send",
    payload: { profileUrl: "https://linkedin.com/in/x" },
  });
  ok("bot job refused while human has control", refused.status === "refused");

  await supervisor.releaseControl(computer.computerId);
  ok("releaseControl returns bot", supervisor.get(computer.computerId)?.control === "bot");

  const sent = await supervisor.enqueueJob({
    computerId: computer.computerId,
    kind: "linkedin_send",
    payload: { profileUrl: "https://linkedin.com/in/x" },
  });
  ok("bot job succeeds after release with mock send", sent.status === "succeeded");
  ok("audits recorded", supervisor.recentAudits(computer.computerId).length >= 3);

  // Stable DB computer_id rebinds in-process seat mapping
  const rebound = supervisor.ensureComputer({
    workspaceId: "ws",
    seatId: "seat-1",
    computerId: "comp_stable_db_id",
  });
  ok("ensureComputer rebinds to stable computerId", rebound.computerId === "comp_stable_db_id");
  ok("botId follows stable computerId", rebound.botId?.includes("comp") === true);
} finally {
  if (previousMock === undefined) delete process.env.COMPUTER_SUPERVISOR_MOCK_SEND;
  else process.env.COMPUTER_SUPERVISOR_MOCK_SEND = previousMock;
  if (previousUrl === undefined) delete process.env.COMPUTER_SUPERVISOR_URL;
  else process.env.COMPUTER_SUPERVISOR_URL = previousUrl;
  if (previousToken === undefined) delete process.env.COMPUTER_SUPERVISOR_TOKEN;
  else process.env.COMPUTER_SUPERVISOR_TOKEN = previousToken;
}

console.log(`RESULT computer-supervisor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
