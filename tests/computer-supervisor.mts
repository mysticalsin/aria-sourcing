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
    "start leaves sessionHealthy unverified (not invented)",
    supervisor.get(computer.computerId)?.sessionHealthy == null,
  );
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

  // Release after help_requested must not invent a healthy LinkedIn session.
  const needsHelp = supervisor.ensureComputer({ workspaceId: "ws", seatId: "seat-help" });
  await supervisor.start(needsHelp.computerId);
  supervisor.requestHelp(needsHelp.computerId, "login wall");
  ok("requestHelp marks unhealthy", supervisor.get(needsHelp.computerId)?.sessionHealthy === false);
  await supervisor.takeControl(needsHelp.computerId);
  await supervisor.releaseControl(needsHelp.computerId);
  ok(
    "release after help leaves sessionHealthy unknown (not assumed true)",
    supervisor.get(needsHelp.computerId)?.sessionHealthy == null,
  );
  ok(
    "release after help clears help_requested to ready",
    supervisor.get(needsHelp.computerId)?.status === "ready",
  );

  // Production gate: without mock, ready+null session must refuse linkedin_send.
  {
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "0";
    const gate = new ComputerSupervisor();
    const seat = gate.ensureComputer({ workspaceId: "ws", seatId: "seat-gate" });
    // Bypass start (needs OpenBot when mock off) — stamp ready + unverified session.
    const rec = gate.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = null;
    const blocked = await gate.enqueueJob({
      computerId: seat.computerId,
      kind: "linkedin_send",
      payload: { profileUrl: "https://linkedin.com/in/z" },
    });
    ok("linkedin_send refused when session unverified (no mock)", blocked.status === "refused");
    ok(
      "refuse detail is session_unverified",
      blocked.detail === "session_unverified",
    );
    rec.sessionHealthy = false;
    const unhealthy = await gate.enqueueJob({
      computerId: seat.computerId,
      kind: "linkedin_send",
      payload: { profileUrl: "https://linkedin.com/in/z" },
    });
    ok("linkedin_send refused when session unhealthy", unhealthy.status === "refused");
    ok("refuse detail is session_unhealthy", unhealthy.detail === "session_unhealthy");
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
  }

  // Fly hard-refuse: COMPUTER_SUPERVISOR_MOCK_SEND must not theatrical-send on Fly
  // unless ALLOW_COMPUTER_SUPERVISOR_MOCK_SEND=1 (N agents stay fail-closed).
  {
    process.env.FLY_APP_NAME = "aria-mantu-app";
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
    delete process.env.ALLOW_COMPUTER_SUPERVISOR_MOCK_SEND;
    const flyGate = new ComputerSupervisor();
    const seat = flyGate.ensureComputer({ workspaceId: "ws", seatId: "seat-fly-mock" });
    const rec = flyGate.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = null;
    const blocked = await flyGate.enqueueJob({
      computerId: seat.computerId,
      kind: "linkedin_send",
      payload: { profileUrl: "https://linkedin.com/in/z" },
    });
    ok(
      "Fly ignores COMPUTER_SUPERVISOR_MOCK_SEND without ALLOW_… (session unverified refuses)",
      blocked.status === "refused" && blocked.detail === "session_unverified",
    );
    delete process.env.FLY_APP_NAME;
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
  }

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

  // Ownership: one computerId must not be claimed by a second seat.
  {
    const ownSup = new ComputerSupervisor();
    ownSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-owner",
      computerId: "comp_owned",
    });
    let threw = false;
    try {
      ownSup.ensureComputer({
        workspaceId: "ws",
        seatId: "seat-thief",
        computerId: "comp_owned",
      });
    } catch (err) {
      threw = err instanceof Error && err.message.includes("computer-ownership-mismatch");
    }
    ok("ensureComputer rejects cross-seat computerId", threw);
  }

  // Without OpenBot + without mock, start must not invent ready.
  {
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "0";
    delete process.env.COMPUTER_SUPERVISOR_URL;
    delete process.env.COMPUTER_SUPERVISOR_TOKEN;
    const bare = new ComputerSupervisor();
    const seat = bare.ensureComputer({ workspaceId: "ws", seatId: "seat-bare" });
    const started = await bare.start(seat.computerId);
    ok("start without OpenBot does not invent ready", started.status === "error");
    ok(
      "start without OpenBot explains supervisor unset",
      /supervisor unset|COMPUTER_SUPERVISOR/i.test(started.lastError ?? ""),
    );
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
  }


  // Fail-closed path audits act_failed with jobId when mock send is off
  // (session must be healthy so we exercise the act path, not the session gate).
  process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "0";
  const failSup = new ComputerSupervisor();
  const failComp = failSup.ensureComputer({ workspaceId: "ws", seatId: "seat-fail" });
  const failRec = failSup.get(failComp.computerId)!;
  failRec.status = "ready";
  failRec.sessionHealthy = true;
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

  // Cold-start hydrate: when OpenBot reports running, in-memory stopped → ready.
  {
    const hydrateSup = new ComputerSupervisor();
    const seat = hydrateSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-hydrate",
      computerId: "comp_hydrate_1",
    });
    ok("pre-hydrate status stopped", seat.status === "stopped");
    const botId = seat.botId || seat.computerId;
    process.env.COMPUTER_SUPERVISOR_URL = "http://openbot.test";
    process.env.COMPUTER_SUPERVISOR_TOKEN = "tok_test";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/computers") && !url.includes("/ensure")) {
        return new Response(
          JSON.stringify({
            computers: [
              {
                botId,
                status: "running",
                url: "http://127.0.0.1:9222",
                viewUrl: "http://127.0.0.1:6080",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      const result = await hydrateSup.hydrateFromHost("ws");
      ok("hydrate matched one host computer", result.matched === 1 && result.hostCount === 1);
      ok(
        "hydrate flips stopped → ready from host running",
        hydrateSup.get(seat.computerId)?.status === "ready",
      );
      ok(
        "hydrate copies remoteUrl from host",
        hydrateSup.get(seat.computerId)?.remoteUrl === "http://127.0.0.1:9222",
      );
    } finally {
      globalThis.fetch = prevFetch;
      delete process.env.COMPUTER_SUPERVISOR_URL;
      delete process.env.COMPUTER_SUPERVISOR_TOKEN;
    }
    // Orphan: in-memory ready but absent from host listing → stopped.
    const orphan = hydrateSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-orphan",
      computerId: "comp_orphan_1",
    });
    const orphanRec = hydrateSup.get(orphan.computerId)!;
    orphanRec.status = "ready";
    orphanRec.sessionHealthy = true;
    orphanRec.remoteUrl = "http://127.0.0.1:9999";
    process.env.COMPUTER_SUPERVISOR_URL = "http://openbot.test";
    process.env.COMPUTER_SUPERVISOR_TOKEN = "tok_test";
    const prevFetchOrphan = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/computers") && !url.includes("/ensure")) {
        // Host lists only the first seat's bot — orphan is absent.
        return new Response(
          JSON.stringify({
            computers: [
              {
                botId: seat.botId || seat.computerId,
                status: "running",
                url: "http://127.0.0.1:9222",
                viewUrl: "http://127.0.0.1:6080",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      await hydrateSup.hydrateFromHost("ws");
      ok(
        "hydrate marks absent host bot stopped",
        hydrateSup.get(orphan.computerId)?.status === "stopped",
      );
      ok(
        "hydrate clears stale sessionHealthy for absent bot",
        hydrateSup.get(orphan.computerId)?.sessionHealthy == null,
      );
    } finally {
      globalThis.fetch = prevFetchOrphan;
      delete process.env.COMPUTER_SUPERVISOR_URL;
      delete process.env.COMPUTER_SUPERVISOR_TOKEN;
    }

    const noHost = await hydrateSup.hydrateFromHost("ws");
    ok("hydrate without host config is a no-op", noHost.matched === 0 && noHost.hostCount === 0);
  }
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
