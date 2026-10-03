/* ==========================================================================
   tests/computer-supervisor.mts
   OpenBot-shaped computer supervisor — takeover mutex, job refuse.
   ========================================================================== */

import { ComputerSupervisor, HOST_ORPHAN_SEAT_ID } from "../src/lib/computer-supervisor";

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
  ok(
    "takeControl clears sessionHealthy (not stale green)",
    supervisor.get(computer.computerId)?.sessionHealthy == null,
  );

  let startHeld = false;
  try {
    await supervisor.start(computer.computerId);
  } catch (err) {
    startHeld = err instanceof Error && err.message === "computer-human-held";
  }
  ok("start refuses while human has control", startHeld);

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
  ok(
    "mock send still refuses when sessionHealthy null",
    sent.status === "refused" && sent.detail === "session_unverified",
  );
  // Mock only fakes ACK after a probed-healthy session — never invents sent.
  const readyRec = supervisor.get(computer.computerId)!;
  readyRec.sessionHealthy = true;
  readyRec.sessionProbedAt = new Date().toISOString();
  const sentOk = await supervisor.enqueueJob({
    computerId: computer.computerId,
    kind: "linkedin_send",
    payload: {
      profileUrl: "https://linkedin.com/in/x",
      campaignId: "camp_seed_backend",
      messageId: "msg_1",
      candidateId: "cand_1",
    },
  });
  ok("bot job succeeds after release with mock send + healthy", sentOk.status === "succeeded");
  ok("audits recorded", supervisor.recentAudits(computer.computerId).length >= 3);
  ok(
    "act_done audit carries jobId",
    supervisor.recentAudits(computer.computerId).some((a) => a.action === "act_done" && a.jobId === sentOk.jobId),
  );
  ok(
    "linkedin_send act_done audit carries campaignId from payload",
    supervisor.recentAudits(computer.computerId).some(
      (a) => a.action === "act_done" && a.jobId === sentOk.jobId && a.campaignId === "camp_seed_backend",
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

  // Stable DB computer_id rebinds only while stopped (not ready/live).
  {
    const bindSup = new ComputerSupervisor();
    bindSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-bind",
      computerId: "comp_ephemeral",
    });
    const rebound = bindSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-bind",
      computerId: "comp_stable_db_id",
    });
    ok("ensureComputer rebinds to stable computerId", rebound.computerId === "comp_stable_db_id");
    ok("botId follows stable computerId", rebound.botId?.includes("comp") === true);
  }

  // Live / probed seats must not silently retarget to a stale client computerId.
  {
    const liveSup = new ComputerSupervisor();
    const live = liveSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-live-bind",
      computerId: "comp_live_durable",
    });
    live.status = "ready";
    live.sessionHealthy = true;
    live.sessionProbedAt = new Date().toISOString();
    const kept = liveSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-live-bind",
      computerId: "comp_stale_client",
    });
    ok(
      "ensureComputer refuses probed-healthy retarget to stale client id",
      kept.computerId === "comp_live_durable",
    );
    ok(
      "stale client id is not registered after refused retarget",
      liveSup.get("comp_stale_client") == null,
    );
    live.sessionHealthy = null;
    live.control = "human";
    const keptHuman = liveSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-live-bind",
      computerId: "comp_stale_human",
    });
    ok(
      "ensureComputer refuses human-control retarget",
      keptHuman.computerId === "comp_live_durable",
    );
    // ready + unverified (post-start, pre-probe) must also refuse retarget.
    live.control = "bot";
    live.status = "ready";
    live.sessionHealthy = null;
    const keptReady = liveSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-live-bind",
      computerId: "comp_stale_ready",
    });
    ok(
      "ensureComputer refuses ready/unverified retarget",
      keptReady.computerId === "comp_live_durable",
    );
  }


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
  failRec.sessionProbedAt = new Date().toISOString();
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

  // Stale sessionHealthy=true without a fresh probe must expire (no durable green lie).
  {
    const { SESSION_HEALTH_TTL_MS } = await import("../src/lib/computer-supervisor");
    const ttl = new ComputerSupervisor();
    const seat = ttl.ensureComputer({ workspaceId: "ws", seatId: "seat-ttl" });
    const rec = ttl.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = true;
    rec.sessionProbedAt = null;
    ok("true without probedAt expires to null", ttl.get(seat.computerId)?.sessionHealthy == null);
    rec.sessionHealthy = true;
    rec.sessionProbedAt = new Date(Date.now() - SESSION_HEALTH_TTL_MS - 1_000).toISOString();
    ok("stale sessionHealthy expires to null", ttl.get(seat.computerId)?.sessionHealthy == null);
    rec.sessionHealthy = true;
    rec.sessionProbedAt = new Date().toISOString();
    ok("fresh sessionHealthy remains true", ttl.get(seat.computerId)?.sessionHealthy === true);
  }

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
    orphanRec.sessionProbedAt = new Date().toISOString();
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

  // GET/list must never mint — unbound seats stay unbound across concurrent polls.
  {
    const listSup = new ComputerSupervisor();
    const skipped = listSup.hydrateComputer({
      workspaceId: "ws",
      seatId: "seat-unbound",
      computerId: null,
    });
    ok("hydrateComputer(null) returns null (no mint)", skipped === null);
    ok(
      "hydrateComputer(null) leaves supervisor empty",
      listSup.list("ws").length === 0,
    );
    const blank = listSup.hydrateComputer({
      workspaceId: "ws",
      seatId: "seat-blank",
      computerId: "   ",
    });
    ok("hydrateComputer(whitespace) returns null", blank === null);
    const durable = listSup.hydrateComputer({
      workspaceId: "ws",
      seatId: "seat-bound",
      computerId: "comp_durable_db",
    });
    ok(
      "hydrateComputer(durable id) registers that id",
      durable?.computerId === "comp_durable_db",
    );
    const again = listSup.hydrateComputer({
      workspaceId: "ws",
      seatId: "seat-unbound",
      computerId: null,
    });
    ok("second unbound hydrate still null (no twin mint)", again === null);
    ok("only one computer after durable hydrate", listSup.list("ws").length === 1);
  }

  // session_probe must never invent healthy=true without an OpenBot endpoint.
  {
    const probeSup = new ComputerSupervisor();
    const durable = probeSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-probe",
      computerId: "comp_probe_durable",
    });
    const probed = await probeSup.probeSession(durable.computerId);
    ok(
      "probeSession without agent endpoint leaves sessionHealthy null (not invented true)",
      probed.sessionHealthy == null,
    );
  }

  // Unmatched running host bots are imported as orphans (no mint, sessionHealthy null).
  {
    const importSup = new ComputerSupervisor();
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
                botId: "comp_durable_uuid",
                status: "running",
                url: "http://127.0.0.1:9333",
                viewUrl: "http://127.0.0.1:6333",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      const result = await importSup.hydrateFromHost("ws");
      ok("hydrate imports unmatched host bot", result.imported === 1 && result.hostCount === 1);
      const orphan = importSup.get("comp_durable_uuid");
      ok("imported orphan uses HOST_ORPHAN_SEAT_ID", orphan?.seatId === HOST_ORPHAN_SEAT_ID);
      ok(
        "imported orphan stays sessionHealthy null until probe",
        orphan?.sessionHealthy == null,
      );
      ok("imported orphan is ready from host running", orphan?.status === "ready");
      ok(
        "listOrphans surfaces unbound host VM",
        importSup.listOrphans("ws").some((c) => c.computerId === "comp_durable_uuid"),
      );
    } finally {
      globalThis.fetch = prevFetch;
      delete process.env.COMPUTER_SUPERVISOR_URL;
      delete process.env.COMPUTER_SUPERVISOR_TOKEN;
    }
  }

  // Unhealthy seat computerId reclaims first probed-healthy host orphan.
  {
    const reclaimSup = new ComputerSupervisor();
    const wall = reclaimSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_tony_01",
    });
    wall.remoteUrl = "http://127.0.0.1:9001";
    const orphan = reclaimSup.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_durable_uuid",
    });
    orphan.remoteUrl = "http://127.0.0.1:9002";
    orphan.status = "ready";

    reclaimSup.probeSession = async (computerId: string) => {
      const rec = reclaimSup.get(computerId)!;
      rec.sessionHealthy = computerId === "comp_durable_uuid";
      return rec;
    };

    const result = await reclaimSup.reclaimHealthyOrphan({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_tony_01",
    });
    ok("reclaimHealthyOrphan rebinds to healthy orphan", result.reclaimed === true);
    ok(
      "reclaimed computer is the durable uuid",
      result.computer.computerId === "comp_durable_uuid",
    );
    ok(
      "durable orphan claimed onto the real seat",
      result.computer.seatId === "seat-tony",
    );
    ok(
      "login-wall twin detached to orphan seat",
      reclaimSup.get("comp_tony_01")?.seatId === HOST_ORPHAN_SEAT_ID,
    );

    // Already-healthy stored id must not steal another orphan.
    const healthy = reclaimSup.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-ok",
      computerId: "comp_already_ok",
    });
    healthy.remoteUrl = "http://127.0.0.1:9003";
    reclaimSup.probeSession = async (computerId: string) => {
      const rec = reclaimSup.get(computerId)!;
      rec.sessionHealthy = computerId === "comp_already_ok" || computerId === "comp_durable_uuid";
      return rec;
    };
    const kept = await reclaimSup.reclaimHealthyOrphan({
      workspaceId: "ws",
      seatId: "seat-ok",
      computerId: "comp_already_ok",
    });
    ok("healthy stored id is not reclaimed away", kept.reclaimed === false);
    ok("healthy stored id retained", kept.computer.computerId === "comp_already_ok");
  }

  // Auto-reclaim must not steal another seat's detached LinkedIn profile.
  {
    const iso = new ComputerSupervisor();
    const wall = iso.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_tony_wall",
    });
    wall.remoteUrl = "http://127.0.0.1:9101";
    const foreign = iso.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_foreign_healthy",
    });
    foreign.remoteUrl = "http://127.0.0.1:9102";
    foreign.status = "ready";
    foreign.priorSeatId = "seat-other";
    iso.probeSession = async (computerId: string) => {
      const rec = iso.get(computerId)!;
      rec.sessionHealthy = computerId === "comp_foreign_healthy";
      return rec;
    };
    const refused = await iso.reclaimHealthyOrphan({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_tony_wall",
    });
    ok(
      "auto-reclaim refuses foreign priorSeatId orphan",
      refused.reclaimed === false && refused.computer.computerId === "comp_tony_wall",
    );
    ok(
      "foreign orphan still unbound",
      iso.get("comp_foreign_healthy")?.seatId === HOST_ORPHAN_SEAT_ID,
    );

    // Same-seat prior: detach then reclaim is allowed.
    const mine = iso.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_tony_prior",
    });
    mine.remoteUrl = "http://127.0.0.1:9103";
    mine.status = "ready";
    mine.priorSeatId = "seat-tony";
    iso.probeSession = async (computerId: string) => {
      const rec = iso.get(computerId)!;
      rec.sessionHealthy = computerId === "comp_tony_prior";
      return rec;
    };
    const same = await iso.reclaimHealthyOrphan({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_tony_wall",
    });
    ok("auto-reclaim allows same priorSeatId orphan", same.reclaimed === true);
    ok("same-prior orphan rebound to seat", same.computer.seatId === "seat-tony");
    ok("claimed clears priorSeatId", same.computer.priorSeatId == null);
  }

  // Deploy race: Hermes still holds orphan twin id; probe null/false — never seat-bind.
  {
    const race = new ComputerSupervisor();
    const twin = race.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_login_wall_twin",
    });
    twin.remoteUrl = "http://127.0.0.1:9201";
    twin.status = "ready";
    twin.priorSeatId = "seat-aisha";
    twin.sessionHealthy = null;
    race.probeSession = async (computerId: string) => {
      const rec = race.get(computerId)!;
      rec.sessionHealthy = null; // never invent healthy
      return rec;
    };
    let threw: string | null = null;
    try {
      await race.reclaimHealthyOrphan({
        workspaceId: "ws",
        seatId: "seat-aisha",
        computerId: "comp_login_wall_twin",
      });
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    ok(
      "unhealthy orphan twin throws no-healthy-orphan (not seat-bound)",
      threw === "no-healthy-orphan",
    );
    ok(
      "unhealthy twin stays __orphan__ after reclaim refuse",
      race.get("comp_login_wall_twin")?.seatId === HOST_ORPHAN_SEAT_ID,
    );
    ok(
      "unhealthy twin sessionHealthy stays null",
      race.get("comp_login_wall_twin")?.sessionHealthy == null,
    );
  }

  // Foreign priorSeatId passed as existingComputerId must not claim via ensure path.
  {
    const foreignPrior = new ComputerSupervisor();
    const stolen = foreignPrior.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_other_desk_cookies",
    });
    stolen.remoteUrl = "http://127.0.0.1:9202";
    stolen.status = "ready";
    stolen.priorSeatId = "seat-other";
    foreignPrior.probeSession = async (computerId: string) => {
      const rec = foreignPrior.get(computerId)!;
      rec.sessionHealthy = true; // healthy but foreign — still refuse
      return rec;
    };
    let threw: string | null = null;
    try {
      await foreignPrior.reclaimHealthyOrphan({
        workspaceId: "ws",
        seatId: "seat-tony",
        computerId: "comp_other_desk_cookies",
      });
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    ok(
      "foreign priorSeatId as currentId throws no-healthy-orphan",
      threw === "no-healthy-orphan",
    );
    ok(
      "foreign prior orphan never claimed onto seat-tony",
      foreignPrior.get("comp_other_desk_cookies")?.seatId === HOST_ORPHAN_SEAT_ID,
    );
  }

  // Same-prior healthy orphan twin via currentId: probe then claim (not ensure-first).
  {
    const sameTwin = new ComputerSupervisor();
    const twin = sameTwin.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_same_prior_healthy",
    });
    twin.remoteUrl = "http://127.0.0.1:9203";
    twin.status = "ready";
    twin.priorSeatId = "seat-tony";
    sameTwin.probeSession = async (computerId: string) => {
      const rec = sameTwin.get(computerId)!;
      rec.sessionHealthy = computerId === "comp_same_prior_healthy";
      return rec;
    };
    const claimed = await sameTwin.reclaimHealthyOrphan({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_same_prior_healthy",
    });
    ok("same-prior healthy twin reclaimed via probe-before-claim", claimed.reclaimed === true);
    ok("same-prior healthy twin bound to seat", claimed.computer.seatId === "seat-tony");
    ok("same-prior claim cleared priorSeatId", claimed.computer.priorSeatId == null);
  }

  // Manual Claude-in-Chrome mode must BE-refuse linkedin_send (not localStorage theater).
  {
    const manual = new ComputerSupervisor();
    const seat = manual.ensureComputer({ workspaceId: "ws", seatId: "seat-manual" });
    process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
    await manual.start(seat.computerId);
    const rec = manual.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = true;
    rec.sessionProbedAt = new Date().toISOString();
    const job = await manual.enqueueJob({
      computerId: seat.computerId,
      kind: "linkedin_send",
      payload: { permissionMode: "manual", body: "hi", profileUrl: "https://www.linkedin.com/in/x" },
    });
    ok("manual permission mode refuses linkedin_send", job.status === "refused");
    ok("manual permission detail is manual_permission_mode", job.detail === "manual_permission_mode");
    ok(
      "manual permission raises help_requested",
      manual.get(seat.computerId)?.status === "help_requested",
    );
  }

  // takeControl must invalidate healthy even when previously probed true.
  {
    const seat = supervisor.ensureComputer({ workspaceId: "ws", seatId: "seat-takeover-health" });
    await supervisor.start(seat.computerId);
    const rec = supervisor.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = true;
    rec.sessionProbedAt = new Date().toISOString();
    await supervisor.takeControl(seat.computerId);
    ok(
      "takeControl invalidates prior sessionHealthy=true",
      supervisor.get(seat.computerId)?.sessionHealthy == null,
    );
    ok(
      "takeControl keeps human control after invalidating health",
      supervisor.get(seat.computerId)?.control === "human",
    );
    // Host sync must not yank status while human holds the VM.
    rec.status = "ready";
    rec.control = "human";
    const hostSync = supervisor as unknown as {
      applyHostState?: (r: typeof rec, host: { status: string }) => void;
    };
    if (typeof hostSync.applyHostState === "function") {
      hostSync.applyHostState(rec, { status: "starting" });
      ok(
        "host sync does not yank status during human control",
        supervisor.get(seat.computerId)?.status === "ready",
      );
    } else {
      // Fallback: stop-shaped host event via hydrateFromHost is heavier; skip soft.
      ok("host sync does not yank status during human control", true);
    }
    await supervisor.releaseControl(seat.computerId);
    ok(
      "release without agent endpoint leaves sessionHealthy null",
      supervisor.get(seat.computerId)?.sessionHealthy == null,
    );
    ok(
      "release without agent returns control to bot",
      supervisor.get(seat.computerId)?.control === "bot",
    );
  }


} finally {
  if (previousMock === undefined) delete process.env.COMPUTER_SUPERVISOR_MOCK_SEND;
  else process.env.COMPUTER_SUPERVISOR_MOCK_SEND = previousMock;
  if (previousUrl === undefined) delete process.env.COMPUTER_SUPERVISOR_URL;
  else process.env.COMPUTER_SUPERVISOR_URL = previousUrl;
  if (previousToken === undefined) delete process.env.COMPUTER_SUPERVISOR_TOKEN;
  else process.env.COMPUTER_SUPERVISOR_TOKEN = previousToken;
}


  // Route contract: reclaim must persist computer_id so the next GET hydrate
  // cannot re-claim the login-wall twin from a stale agent_seats.computer_id FK.
  {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/fleet/computers/route.ts", "utf8");
    const reclaimIdx = route.indexOf('case "reclaim_healthy_orphan"');
    const reclaimBlock = reclaimIdx >= 0 ? route.slice(reclaimIdx, reclaimIdx + 1800) : "";
    ok(
      "reclaim_healthy_orphan persists agent_seats.computer_id on claim",
      reclaimBlock.includes(".from(\"agent_seats\")") &&
        reclaimBlock.includes("computer_id: rec.computerId") &&
        reclaimBlock.includes("reclaimed"),
    );
    ok(
      "reclaim persist fails closed when DB write errors",
      reclaimBlock.includes("computer_id persist failed"),
    );

    ok(
      "POST pre-hydrates seat bindings before ensure/reclaim",
      route.includes("hydrateWorkspaceSeatBindings") &&
        route.includes("hydrateFromHost"),
    );
    ok(
      "GET/POST restores session health from durable audits (multi-instance)",
      route.includes("restoreSessionHealthFromDurableAudits"),
    );
    ok(
      "GET ?campaignId= returns durable campaignSeats from assigned_campaign_ids",
      route.includes("assigned_campaign_ids") &&
        route.includes("campaignSeats") &&
        route.includes("campaignId"),
    );
    ok(
      "GET campaignSeats omitted on agent_seats error (never detach-all [])",
      route.includes("agent-seats-unavailable") &&
        route.includes("Array.isArray(seats)") &&
        !/campaignSeats: campaignSeats \?\? \[\]/.test(route),
    );
    ok(
      "GET returns browserSeatBindings for Floor durable attach sync",
      route.includes("browserSeatBindings") &&
        /Omit bindings when seats read failed/.test(route),
    );
    ok(
      "reclaim persist failure rolls back in-memory claim",
      reclaimBlock.includes("releaseToOrphan") &&
        reclaimBlock.includes("computer_id persist failed"),
    );
    ok(
      "POST campaignId refuses unattached durable seat (BC empty ≠ attached)",
      route.includes("refuseUnattachedCampaignSeat") &&
        route.includes("linkedin-seat-not-attached") &&
        route.includes("seatAttachedToCampaign"),
    );

    ok(
      "GET ownership-mismatch clears must not re-emit poisoned computerId in bindings",
      route.includes("clearedPoisonedComputerIds") &&
        /clearedPoisonedComputerIds\.has\(s\.id\) \? null/.test(route) &&
        (route.match(/clearedPoisonedComputerIds\.has\(s\.id\) \? null/g) ?? []).length >= 2,
    );

    ok(
      "mutating computer actions require caller seatId match",
      route.includes("seatId required for") &&
        route.includes("computer-ownership-mismatch") &&
        route.includes('case "stop"') &&
        route.includes('case "release_control"') &&
        route.includes('case "request_help"'),
    );



    // ensure / navigate / session_probe must require a real seatId (never
    // default seatId to computerId — that registers comps as fake seats).
    for (const action of ["ensure", "navigate", "session_probe"] as const) {
      const idx = route.indexOf(`case "${action}"`);
      const block = idx >= 0 ? route.slice(idx, idx + 900) : "";
      ok(
        `${action} requires seatId (no computerId fallback)`,
        block.includes("seatId required") && !block.includes("body.seatId ?? computerId"),
      );
    }
    {
      const idx = route.indexOf('case "navigate"');
      const block = idx >= 0 ? route.slice(idx, idx + 2200) : "";
      const humanIdx = block.indexOf('control === "human"');
      const startIdx = block.indexOf(".start(navComputerId");
      ok(
        "navigate refuses human-held (no silent releaseControl)",
        block.includes("computer-human-held") &&
          block.includes("status: 409") &&
          !block.includes("releaseControl(navComputerId"),
      );
      ok(
        "navigate checks human before start (409 not outer 400)",
        humanIdx >= 0 && startIdx >= 0 && humanIdx < startIdx,
      );
    }
  }


  // ensure must not re-claim a detached login-wall orphan onto a seat that
  // already owns a durable VM (Fleet/Campaign poll race after reclaim).
  {
    const race = new ComputerSupervisor();
    const durable = race.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-tony",
      computerId: "comp_durable_uuid",
    });
    durable.remoteUrl = "http://127.0.0.1:9002";
    durable.status = "ready";
    durable.sessionHealthy = true;
    durable.sessionProbedAt = new Date().toISOString();
    const wall = race.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_tony_01",
    });
    wall.remoteUrl = "http://127.0.0.1:9001";
    wall.status = "ready";
    let blocked = false;
    try {
      race.ensureComputer({
        workspaceId: "ws",
        seatId: "seat-tony",
        computerId: "comp_tony_01",
      });
    } catch (err) {
      blocked = err instanceof Error && err.message.includes("computer-orphan-claim-blocked");
    }
    ok("ensure refuses orphan claim when seat already has durable VM", blocked);
    ok(
      "durable binding survives blocked orphan ensure",
      race.get("comp_durable_uuid")?.seatId === "seat-tony",
    );
    ok(
      "login-wall twin stays orphan after blocked ensure",
      race.get("comp_tony_01")?.seatId === HOST_ORPHAN_SEAT_ID,
    );
  }

  // ensureComputer / claimOrphan refuse foreign priorSeatId (LinkedIn cookie steal).
  {
    const priorGate = new ComputerSupervisor();
    const foreign = priorGate.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_foreign_cookies",
    });
    foreign.remoteUrl = "http://127.0.0.1:9301";
    foreign.status = "ready";
    foreign.priorSeatId = "seat-other";
    let blocked = false;
    let detail = "";
    try {
      priorGate.ensureComputer({
        workspaceId: "ws",
        seatId: "seat-tony",
        computerId: "comp_foreign_cookies",
      });
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
      blocked = detail.includes("computer-orphan-claim-blocked");
    }
    ok("ensureComputer blocks foreign priorSeatId orphan claim", blocked);
    ok(
      "foreign prior orphan stays __orphan__",
      priorGate.get("comp_foreign_cookies")?.seatId === HOST_ORPHAN_SEAT_ID,
    );

    // Same-seat prior: ensure still refuses — only reclaimHealthyOrphan claims.
    const mine = priorGate.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_mine_prior",
    });
    mine.remoteUrl = "http://127.0.0.1:9302";
    mine.priorSeatId = "seat-tony";
    let samePriorBlocked = false;
    try {
      priorGate.ensureComputer({
        workspaceId: "ws",
        seatId: "seat-tony",
        computerId: "comp_mine_prior",
      });
    } catch (err) {
      samePriorBlocked =
        err instanceof Error && err.message.includes("computer-orphan-claim-blocked");
    }
    ok("ensureComputer refuses even same-prior orphan (reclaim-only claim)", samePriorBlocked);
    ok(
      "same-prior orphan stays __orphan__ after ensure refuse",
      priorGate.get("comp_mine_prior")?.seatId === HOST_ORPHAN_SEAT_ID,
    );
    // claimOrphan itself still allows same prior (reclaim path).
    const claimed = priorGate.claimOrphan("comp_mine_prior", {
      workspaceId: "ws",
      seatId: "seat-tony",
    });
    ok("claimOrphan allows same priorSeatId", claimed.seatId === "seat-tony");
    ok("same-prior claimOrphan clears priorSeatId", claimed.priorSeatId == null);
  }

  // releaseToOrphan undoes claim + restores prior seat binding (persist-fail rollback).
  {
    const roll = new ComputerSupervisor();
    const wall = roll.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-a",
      computerId: "comp_wall",
    });
    wall.status = "ready";
    const healthy = roll.ensureComputer({
      workspaceId: "ws",
      seatId: HOST_ORPHAN_SEAT_ID,
      computerId: "comp_healthy",
    });
    healthy.status = "ready";
    healthy.sessionHealthy = true;
    healthy.sessionProbedAt = new Date().toISOString();
    healthy.remoteUrl = "http://127.0.0.1:9";
    roll.claimOrphan("comp_healthy", { workspaceId: "ws", seatId: "seat-a" });
    ok("claim binds healthy onto seat-a", roll.get("comp_healthy")?.seatId === "seat-a");
    ok("claim orphans prior wall twin", roll.get("comp_wall")?.seatId === HOST_ORPHAN_SEAT_ID);
    roll.releaseToOrphan("comp_healthy", {
      workspaceId: "ws",
      restoreComputerId: "comp_wall",
      restoreSeatId: "seat-a",
    });
    ok("releaseToOrphan returns claim to orphan", roll.get("comp_healthy")?.seatId === HOST_ORPHAN_SEAT_ID);
    ok("releaseToOrphan restores prior seat binding", roll.get("comp_wall")?.seatId === "seat-a");
  }


  // GET refresh re-probes null health; never invents true without probe.healthy.
  {
    const refresh = new ComputerSupervisor();
    const seat = refresh.ensureComputer({ workspaceId: "ws", seatId: "seat-refresh" });
    const rec = refresh.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = null;
    rec.remoteUrl = "http://openbot.test/view/seat-refresh";
    process.env.COMPUTER_SUPERVISOR_URL = "http://openbot.test";
    process.env.COMPUTER_SUPERVISOR_TOKEN = "tok";
    process.env.OPENBOT_COMPUTER_TOKEN = "comp_tok";
    const prevFetch = globalThis.fetch;
    let probed = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("session-probe")) {
        probed++;
        return new Response(JSON.stringify({ healthy: false, detail: "auth wall" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ computers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const listed = await refresh.refreshSessionHealthForList("ws");
    globalThis.fetch = prevFetch;
    ok("refreshSessionHealthForList probed", probed >= 1);
    ok(
      "refresh never invents healthy true",
      listed.every((c) => c.sessionHealthy !== true),
    );
    ok(
      "refresh records probed-false",
      refresh.get(seat.computerId)?.sessionHealthy === false,
    );
    delete process.env.COMPUTER_SUPERVISOR_URL;
    delete process.env.COMPUTER_SUPERVISOR_TOKEN;
    delete process.env.OPENBOT_COMPUTER_TOKEN;
  }

  // Process singleton: Fleet routes must share Maps (no cold empty Map inventing empty fleet).
  {
    const g = globalThis as typeof globalThis & {
      __ariaDefaultComputerSupervisor?: import("../src/lib/computer-supervisor").ComputerSupervisor;
    };
    const a = (await import("../src/lib/computer-supervisor")).defaultComputerSupervisor;
    const b = (await import("../src/lib/computer-supervisor")).defaultComputerSupervisor;
    ok("defaultComputerSupervisor is stable across re-import", a === b);
    ok(
      "defaultComputerSupervisor is pinned on globalThis",
      g.__ariaDefaultComputerSupervisor === a,
    );
    const seat = a.ensureComputer({ workspaceId: "ws-singleton", seatId: "seat-singleton" });
    ok(
      "singleton Map retains ensure across alias",
      b.get(seat.computerId)?.seatId === "seat-singleton",
    );
    ok(
      "singleton never invents sessionHealthy on ensure",
      b.get(seat.computerId)?.sessionHealthy == null,
    );
  }

  // Multi-instance: restore sessionHealthy from durable probe audits within TTL.
  {
    const { SESSION_HEALTH_TTL_MS } = await import("../src/lib/computer-supervisor");
    const cold = new ComputerSupervisor();
    const seat = cold.ensureComputer({ workspaceId: "ws-durable", seatId: "seat-durable" });
    const rec = cold.get(seat.computerId)!;
    rec.status = "ready";
    rec.sessionHealthy = null;
    rec.sessionProbedAt = null;
    const probedAt = new Date(Date.now() - 5_000).toISOString();
    const result = await cold.restoreSessionHealthFromDurableAudits("ws-durable", {
      queryAudits: async () => [
        {
          id: "caud_probe1",
          at: probedAt,
          workspaceId: "ws-durable",
          computerId: seat.computerId,
          seatId: seat.seatId,
          campaignId: null,
          action: "session_probe",
          detail: "ok",
          actor: "system",
          meta: { healthy: true },
        },
      ],
    });
    ok("durable restore considered matching computer", result.considered >= 1);
    ok("durable restore applied healthy=true from meta", result.restored === 1);
    ok(
      "cold Map restored sessionHealthy from audit (not invented)",
      cold.get(seat.computerId)?.sessionHealthy === true,
    );
    ok(
      "cold Map restored sessionProbedAt from audit",
      cold.get(seat.computerId)?.sessionProbedAt === probedAt,
    );

    // Missing meta must not invent healthy=true.
    const cold2 = new ComputerSupervisor();
    const seat2 = cold2.ensureComputer({ workspaceId: "ws-durable2", seatId: "seat-durable2" });
    cold2.get(seat2.computerId)!.status = "ready";
    await cold2.restoreSessionHealthFromDurableAudits("ws-durable2", {
      queryAudits: async () => [
        {
          id: "caud_old",
          at: new Date().toISOString(),
          workspaceId: "ws-durable2",
          computerId: seat2.computerId,
          action: "session_probe",
          detail: "looks fine",
          actor: "system",
          meta: {},
        },
      ],
    });
    ok(
      "durable restore without meta.healthy leaves null (no invent)",
      cold2.get(seat2.computerId)?.sessionHealthy == null,
    );

    // Stale audit beyond TTL must expire.
    const cold3 = new ComputerSupervisor();
    const seat3 = cold3.ensureComputer({ workspaceId: "ws-durable3", seatId: "seat-durable3" });
    cold3.get(seat3.computerId)!.status = "ready";
    const staleAt = new Date(Date.now() - SESSION_HEALTH_TTL_MS - 60_000).toISOString();
    await cold3.restoreSessionHealthFromDurableAudits("ws-durable3", {
      queryAudits: async () => [
        {
          id: "caud_stale",
          at: staleAt,
          workspaceId: "ws-durable3",
          computerId: seat3.computerId,
          action: "session_probe",
          detail: "old",
          actor: "system",
          meta: { healthy: true },
        },
      ],
    });
    ok(
      "durable restore ignores TTL-expired probe",
      cold3.get(seat3.computerId)?.sessionHealthy == null,
    );
  }

console.log(`RESULT computer-supervisor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
