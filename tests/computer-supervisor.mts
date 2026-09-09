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
  ok(
    "refused job leaves act_refused audit with jobId",
    supervisor.recentAudits(computer.computerId).some((a) => a.action === "act_refused" && a.jobId === refused.jobId),
  );

  await supervisor.releaseControl(computer.computerId);
  ok("releaseControl returns bot", supervisor.get(computer.computerId)?.control === "bot");

  const sent = await supervisor.enqueueJob({
    computerId: computer.computerId,
    kind: "linkedin_send",
    payload: {
      profileUrl: "https://linkedin.com/in/x",
      campaignId: "camp_seed_backend",
      messageId: "msg_1",
      candidateId: "cand_1",
    },
  });
  ok("bot job succeeds after release with mock send", sent.status === "succeeded");
  ok("audits recorded", supervisor.recentAudits(computer.computerId).length >= 3);
  ok(
    "act_done audit carries jobId",
    supervisor.recentAudits(computer.computerId).some((a) => a.action === "act_done" && a.jobId === sent.jobId),
  );
  ok(
    "linkedin_send act_done audit carries campaignId from payload",
    supervisor.recentAudits(computer.computerId).some(
      (a) => a.action === "act_done" && a.jobId === sent.jobId && a.campaignId === "camp_seed_backend",
    ),
  );
  ok(
    "campaign-tagged ensure stores campaignId",
    (() => {
      const tagged = supervisor.ensureComputer({
        workspaceId: "ws",
        seatId: "seat-camp",
        computerId: "comp_camp",
        campaignId: "camp_seed_backend",
      });
      return tagged.campaignId === "camp_seed_backend";
    })(),
  );
  const takeover = await supervisor.takeControl("comp_camp", { campaignId: "camp_seed_backend" });
  ok("takeControl with campaign keeps ready/human", takeover.control === "human");
  ok(
    "takeover audit includes campaignId",
    supervisor.recentAudits("comp_camp").some((a) => a.action === "takeover" && a.campaignId === "camp_seed_backend"),
  );

  // Stable DB computer_id rebinds in-process seat mapping
  const rebound = supervisor.ensureComputer({
    workspaceId: "ws",
    seatId: "seat-1",
    computerId: "comp_stable_db_id",
  });
  ok("ensureComputer rebinds to stable computerId", rebound.computerId === "comp_stable_db_id");
  ok("botId follows stable computerId", rebound.botId?.includes("comp") === true);

  // Fail-closed path audits act_failed with jobId when mock send is off
  process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "0";
  const failSup = new ComputerSupervisor();
  const failComp = failSup.ensureComputer({ workspaceId: "ws", seatId: "seat-fail" });
  await failSup.start(failComp.computerId);
  const failed = await failSup.enqueueJob({
    computerId: failComp.computerId,
    kind: "linkedin_send",
    payload: { profileUrl: "https://linkedin.com/in/y", campaignId: "camp_x" },
  });
  ok("unconfigured supervisor fails closed", failed.status === "failed");
  ok(
    "act_failed audit includes jobId",
    failSup.recentAudits(failComp.computerId).some((a) => a.action === "act_failed" && a.jobId === failed.jobId),
  );
  process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
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
