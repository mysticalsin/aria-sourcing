import { agentActivity, agentActivityWithComputers, floorBrowserVmTruth, floorRollup } from "../src/lib/floor";
import { agentCortexTrace } from "../src/lib/cortex";
import { pickResponderIndex, preferBrowserComputerAgents, seatsToOfficeAgents } from "../src/lib/floor3d";
import { buildSeedState } from "../src/lib/seed";
import { SEED_NOW } from "../src/lib/utils";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const s = buildSeedState();
const seat = (id: string) => s.seats.find((x) => x.id === id)!;
// Pin "now" to the seed reference time so warmup-stage assertions stay deterministic
// and do not drift as the real calendar advances past SEED_NOW.
const NOW = SEED_NOW.getTime();

const maya = agentActivity(seat("seat_maya"), s, NOW);
ok("warmed active agent is working", ["sourcing", "outreach", "booking"].includes(maya.state));
ok("working agent has a label", maya.label.length > 0);
ok("working agent is busy (animates)", maya.busy === true);
ok("contacted count is a number", typeof maya.contacted === "number" && maya.contacted >= 0);

const aisha = agentActivity(seat("seat_aisha"), s, NOW); // warmup day ~5
ok("warming agent state = warming", aisha.state === "warming");

const lucas = agentActivity(seat("seat_lucas"), s, NOW); // bounce 0.068 > 5% → auto-pause
ok("high-bounce agent is paused", lucas.state === "paused");

// determinism: same inputs → same activity
const maya2 = agentActivity(seat("seat_maya"), s, NOW);
ok("activity is deterministic", maya.label === maya2.label && maya.detail === maya2.detail);

const roll = floorRollup(s.seats, s);
ok("rollup total = seat count", roll.total === s.seats.length);
ok("rollup buckets within total", roll.working + roll.warming + roll.paused <= roll.total);
ok("contactedToday = sum of sentToday", roll.contactedToday === s.seats.reduce((a, x) => a + x.sentToday, 0));
ok("at least one paused (lucas)", roll.paused >= 1);


// Assigned-campaign preference (not a hash lottery across the whole fleet).
{
  const clone = structuredClone(s);
  const mayaSeat = clone.seats.find((x) => x.id === "seat_maya")!;
  mayaSeat.assignedCampaignIds = ["camp_seed_design"];
  const act = agentActivity(mayaSeat, clone, NOW);
  const design = clone.campaigns.find((c) => c.id === "camp_seed_design")!;
  ok("assigned campaign title surfaces", act.detail === design.title);
}

{
  const e = {
    kind: "send" as const,
    candidateName: "Ada",
    campaignId: "camp_seed_backend",
    seatId: "seat_diego",
    at: NOW,
  };
  const ids = ["seat_maya", "seat_diego", "seat_aisha"];
  ok("pulse prefers event seatId", pickResponderIndex(e, ids.length, ids) === 1);
  ok(
    "pulse fails closed without seatId",
    pickResponderIndex({ ...e, seatId: undefined }, ids.length, ids) === -1,
  );
  ok(
    "pulse fails closed when seatId not in roster",
    pickResponderIndex({ ...e, seatId: "seat_ghost" }, ids.length, ids) === -1,
  );
}

{
  const liSeat = s.seats.find((x) => x.provider === "LinkedIn Browser Computer")!;
  const agents = seatsToOfficeAgents(s.seats, s);
  ok("office agents = seat count", agents.length === s.seats.length);
  const hinted = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([[liSeat.id, { status: "help_requested", seatId: liSeat.id }]]),
  );
  const helped = hinted.find((a) => a.id === liSeat.id)!;
  ok("help_requested overlays error", helped.status === "error");
  ok("help_requested subtitle", /Needs Take control/i.test(helped.subtitle ?? ""));

  const healthy = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([[liSeat.id, { status: "ready", sessionHealthy: true, seatId: liSeat.id }]]),
  ).find((a) => a.id === liSeat.id)!;
  // Seed LI seats are theatrically busy — healthy overlay must not invent a
  // different lane; it only stamps the healthy label.
  ok(
    "ready+healthy keeps theatrical base as working (not inventing a new lane)",
    healthy.status === "working",
  );
  ok("ready+healthy subtitle", /LinkedIn session healthy/i.test(healthy.subtitle ?? ""));

  // Truly idle desk + healthy session must stay idle (no sourcing theater).
  const idleSeat = { ...liSeat, id: "seat_idle_li_healthy", status: "disabled" as const };
  const idleHealthy = seatsToOfficeAgents(
    [idleSeat],
    s,
    new Map([[idleSeat.id, { status: "ready", sessionHealthy: true, seatId: idleSeat.id }]]),
  ).find((a) => a.id === idleSeat.id)!;
  ok(
    "ready+healthy on idle desk stays idle (no invent working)",
    idleHealthy.status === "idle",
  );
  ok(
    "idle+healthy still shows session healthy label",
    /LinkedIn session healthy/i.test(idleHealthy.subtitle ?? ""),
  );

  const unverified = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([[liSeat.id, { status: "ready", sessionHealthy: null, seatId: liSeat.id }]]),
  ).find((a) => a.id === liSeat.id)!;
  ok("ready+null overlays idle unverified", unverified.status === "idle");
  ok(
    "ready+null subtitle asks Take control",
    (unverified.subtitle ?? "").includes("unverified"),
  );

  {
    const missing = seatsToOfficeAgents(s.seats, s, new Map()).find((a) => a.id === liSeat.id)!;
    ok(
      "LinkedIn seat without VM row is idle",
      missing.status === "idle" &&
        /Browser Computer|not on host/.test(missing.subtitle ?? ""),
    );

    const theatrical = floorRollup(s.seats, s, NOW);
    const withEmptyHints = floorRollup(s.seats, s, NOW, new Map());
    ok(
      "rollup with empty computer map does not invent Browser Computer working",
      withEmptyHints.working <= theatrical.working,
    );
    const readyMap = new Map([[liSeat.id, { status: "ready", sessionHealthy: true }]]);
    const withReady = floorRollup([liSeat], s, NOW, readyMap);
    const busyAlone = agentActivity(liSeat, s, NOW);
    if (busyAlone.state !== "idle" && busyAlone.state !== "paused" && busyAlone.state !== "warming") {
      ok("rollup counts ready+healthy Browser Computer as working", withReady.working === 1);
      const readyUnverified = floorRollup(
        [liSeat],
        s,
        NOW,
        new Map([[liSeat.id, { status: "ready", sessionHealthy: null }]]),
      );
      ok("rollup ignores ready without sessionHealthy", readyUnverified.working === 0);
    }
    const stoppedMap = new Map([[liSeat.id, { status: "stopped" }]]);
    const withStopped = floorRollup([liSeat], s, NOW, stoppedMap);
    if (busyAlone.state !== "idle" && busyAlone.state !== "paused" && busyAlone.state !== "warming") {
      ok("rollup ignores theatrical busy when VM stopped", withStopped.working === 0);
    }
  }
}


{
  const li = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (li) {
    const theatrical = agentActivity(li, s, NOW);
    const stopped = agentActivityWithComputers(
      li,
      s,
      NOW,
      new Map([[li.id, { status: "stopped" }]]),
    );
    ok("2D overlay: stopped VM is not busy", stopped.busy === false);
    ok(
      "2D overlay: stopped VM label mentions VM",
      /VM stopped|not on host|Browser Computer/i.test(stopped.label),
    );
    if (theatrical.busy) {
      const healthy = agentActivityWithComputers(
        li,
        s,
        NOW,
        new Map([[li.id, { status: "ready", sessionHealthy: true }]]),
      );
      ok("2D overlay: ready+healthy stays busy", healthy.busy === true);
    }
    const busyVm = agentActivityWithComputers(
      li,
      s,
      NOW,
      new Map([[li.id, { status: "busy", sessionHealthy: null, computerId: "comp_busy_x" }]]),
    );
    ok("2D overlay: busy VM stays busy (warming)", busyVm.busy === true);
    ok(
      "2D overlay: busy VM drops theatrical sourcing label",
      /session unverified/i.test(busyVm.label) && !/Sourcing|Outreach|Booking/i.test(busyVm.label),
    );
  }
}


{
  const li = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (li) {
    const withId = { ...li, computerId: "comp_floor_visible_abc12345" };
    const agents = seatsToOfficeAgents(
      [withId],
      s,
      new Map([[withId.id, { status: "ready", sessionHealthy: true }]]),
    );
    const agent = agents.find((a) => a.id === withId.id);
    ok(
      "3D subtitle includes short VM id",
      typeof agent?.subtitle === "string" && agent.subtitle.includes("…abc12345"),
    );
    ok(
      "3D subtitle keeps session health when VM id shown",
      typeof agent?.subtitle === "string" && /session healthy/i.test(agent.subtitle),
    );
  }
}

// N LinkedIn Browser Computer seats → N distinct floor VM suffixes (no collapse).
{
  const template = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (template) {
    const n = 5;
    const seats = Array.from({ length: n }, (_, i) => ({
      ...template,
      id: `seat_n_agent_${i + 1}`,
      name: `N-Agent ${i + 1}`,
      // Last 8 chars must be unique — floor subtitles show …${computerId.slice(-8)}.
      computerId: `comp_n_agent_${String(i + 1).padStart(2, "0")}_${(0x10000000 + i).toString(16)}`,
    }));
    const hints = new Map(
      seats.map((seat) => [
        seat.id,
        {
          status: "ready" as const,
          sessionHealthy: null as boolean | null,
          computerId: seat.computerId,
        },
      ]),
    );
    const agents = seatsToOfficeAgents(seats, s, hints);
    ok("N-agent floor maps every seat", agents.length === n);
    const suffixes = agents.map((a) => {
      const m = /…([0-9a-f]{8})$/i.exec(a.subtitle || "");
      return m?.[1] ?? null;
    });
    ok(
      "N-agent floor subtitles each carry a VM suffix",
      suffixes.every((x) => typeof x === "string" && x.length === 8),
    );
    ok(
      "N-agent floor VM suffixes are distinct",
      new Set(suffixes).size === n,
    );
    ok(
      "N-agent floor does not invent sessionHealthy working",
      agents.every((a) => a.status === "idle" && /unverified/i.test(a.subtitle || "")),
    );
    // Hint keyed only by computerId (fleet lag / seatId remap) still labels each agent.
    const byCompOnly = new Map(
      seats.map((seat) => [
        seat.computerId!,
        {
          status: "ready" as const,
          sessionHealthy: null as boolean | null,
          computerId: seat.computerId,
        },
      ]),
    );
    const viaComp = seatsToOfficeAgents(seats, s, byCompOnly);
    ok(
      "N-agent floor resolves hints by computerId",
      viaComp.every((a) => /…[0-9a-f]{8}/i.test(a.subtitle || "")),
    );
    ok(
      "N-agent floor computerId hints stay distinct",
      new Set(viaComp.map((a) => /…([0-9a-f]{8})/i.exec(a.subtitle || "")?.[1])).size === n,
    );
  }
}

// Empty computer map (floor pre-poll / fetch fail) must not invent Browser Computer working.
{
  const li = s.seats.filter((x) => x.provider === "LinkedIn Browser Computer");
  if (li.length > 0) {
    const theatrical = floorRollup(li, s, NOW);
    const emptyHints = floorRollup(li, s, NOW, new Map());
    ok(
      "empty computer map never invents Browser Computer working above theatrical baseline check",
      emptyHints.working === 0 || emptyHints.working <= theatrical.working,
    );
    ok(
      "empty computer map keeps Browser Computer seats out of working when hints are loaded",
      emptyHints.working === 0,
    );
    const agents = seatsToOfficeAgents(li, s, new Map());
    ok(
      "empty computer map leaves Browser Computer agents idle (not theatrical working)",
      agents.every((a) => a.status === "idle"),
    );
  }
}


// Poisoned/stale computerId must not let seat A display seat B's VM after FK clear.
{
  const a = {
    ...s.seats.find((x) => x.provider === "LinkedIn Browser Computer")!,
    id: "seat_poison_a",
    computerId: "comp_seat_b_unique",
  };
  const b = {
    ...a,
    id: "seat_poison_b",
    computerId: "comp_seat_b_unique",
    name: "Seat B",
  };
  const hints = new Map([
    [
      b.id,
      {
        status: "ready" as const,
        sessionHealthy: true as boolean | null,
        computerId: "comp_seat_b_unique",
        seatId: b.id,
      },
    ],
    [
      "comp_seat_b_unique",
      {
        status: "ready" as const,
        sessionHealthy: true as boolean | null,
        computerId: "comp_seat_b_unique",
        seatId: b.id,
      },
    ],
  ]);
  const agents = seatsToOfficeAgents([a, b], s, hints);
  const agentA = agents.find((x) => x.id === a.id)!;
  const agentB = agents.find((x) => x.id === b.id)!;
  ok(
    "poisoned computerId cannot inherit another seat's healthy VM (status)",
    agentA.status === "idle" && agentB.status === "working",
  );
  ok(
    "poisoned computerId cannot inherit another seat's VM suffix",
    !/…b_unique/i.test(agentA.subtitle || "") && /…b_unique/i.test(agentB.subtitle || ""),
  );
  ok(
    "poisoned seat shows unbound host copy, not healthy session",
    /VM not on host|No Browser Computer/i.test(agentA.subtitle || "") &&
      !/session healthy/i.test(agentA.subtitle || ""),
  );
  ok(
    "owned ready+healthy seat shows healthy label",
    /session healthy/i.test(agentB.subtitle || ""),
  );

{
  const seat = { ...s.seats.find((x) => x.provider === "LinkedIn Browser Computer")!, id: "seat_vm_sfx", computerId: "comp_abcd1234" };
  const hints = new Map([
    ["seat_vm_sfx", { status: "ready" as const, sessionHealthy: null, computerId: "comp_abcd1234" }],
  ]);
  const act = agentActivityWithComputers(seat, s, Date.now(), hints);
  ok("2D activity label includes VM suffix", /…abcd1234/.test(act.label));
}

  const actA = agentActivityWithComputers(a, s, Date.now(), hints);
  ok(
    "poisoned computerId cannot inherit another seat's activity",
    actA.state === "idle" && /No Browser Computer|VM not on host/i.test(actA.label),
  );
}

// Live computer map: non-LI theatrical busy with zero sends is not "Working now".
{
  const email = s.seats.find(
    (x) => x.provider !== "LinkedIn Browser Computer" && x.sentToday === 0,
  );
  if (email) {
    const theatrical = floorRollup([email], s, NOW);
    const withHints = floorRollup([email], s, NOW, new Map());
    if (theatrical.working > 0) {
      ok(
        "rollup suppresses non-LI theatrical working when computers map loaded",
        withHints.working === 0,
      );
    }
    const agents = seatsToOfficeAgents([email], s, new Map());
    const agent = agents[0]!;
    if (agent.status === "working") {
      ok("non-LI theatrical working suppressed on 3D when computers map loaded", false);
    } else {
      ok("non-LI theatrical working suppressed on 3D when computers map loaded", true);
    }
  }
}

// Booting/busy VM is not probed-healthy — warming status (matches rollup), never working.
{
  const li = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (li) {
    const starting = seatsToOfficeAgents(
      [{ ...li, computerId: "comp_boot_abc12345" }],
      s,
      new Map([
        [
          li.id,
          {
            status: "starting" as const,
            computerId: "comp_boot_abc12345",
            seatId: li.id,
          },
        ],
      ]),
    )[0]!;
    ok("starting VM overlays warming (not working)", starting.status === "warming");
    ok(
      "starting VM subtitle is Booting VM",
      (starting.subtitle ?? "").includes("Booting VM"),
    );
    const busy = seatsToOfficeAgents(
      [{ ...li, computerId: "comp_busy_abc12345" }],
      s,
      new Map([
        [
          li.id,
          {
            status: "busy" as const,
            computerId: "comp_busy_abc12345",
            seatId: li.id,
          },
        ],
      ]),
    )[0]!;
    ok("busy VM overlays warming (not working)", busy.status === "warming");
    ok(
      "busy VM subtitle stays unverified",
      /unverified|busy/i.test(busy.subtitle ?? ""),
    );
    const rollBusy = floorRollup(
      [{ ...li, computerId: "comp_busy_abc12345" }],
      s,
      NOW,
      new Map([
        [
          li.id,
          {
            status: "busy" as const,
            computerId: "comp_busy_abc12345",
            seatId: li.id,
          },
        ],
      ]),
    );
    ok(
      "3D warming status matches floorRollup warming count",
      busy.status === "warming" && rollBusy.warming === 1 && rollBusy.working === 0,
    );
  }
}

// 3D cap ranking keeps bound LinkedIn Browser Computers ahead of email theater.
{
  const ranked = preferBrowserComputerAgents(
    [
      { id: "email-1", provider: "Google", position: "employee" as const, subtitle: "Outreach" },
      {
        id: "li-bound",
        provider: "LinkedIn Browser Computer",
        position: "employee" as const,
        subtitle: "LinkedIn session healthy · …abc12345",
      },
      { id: "ceo", provider: "ARIA", position: "ceo" as const, subtitle: "Lead" },
      {
        id: "li-unbound",
        provider: "LinkedIn Browser Computer",
        position: "employee" as const,
        subtitle: "No Browser Computer",
      },
    ],
    null,
  );
  ok("3D prefer keeps CEO first", ranked[0]?.id === "ceo");
  ok("3D prefer ranks bound LI before unbound LI", ranked[1]?.id === "li-bound");
  ok("3D prefer ranks unbound LI before email", ranked[2]?.id === "li-unbound");
  ok("3D prefer ranks email last", ranked[3]?.id === "email-1");
}

// Seed LinkedIn Browser Computers leave computerId null until Deploy/Login.
{
  const li = s.seats.filter((x) => x.provider === "LinkedIn Browser Computer");
  ok(
    "seed LI seats start unbound (computerId null)",
    li.length > 0 && li.every((x) => x.computerId == null),
  );
}


// Human Take control must not leave the desk green-working.
{
  const li = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (li) {
    const hints = new Map([
      [
        li.id,
        {
          status: "ready" as const,
          sessionHealthy: true as boolean | null,
          computerId: "comp_human_ctrl_1",
          seatId: li.id,
          control: "human" as const,
        },
      ],
    ]);
    const agent = seatsToOfficeAgents([{ ...li, computerId: "comp_human_ctrl_1" }], s, hints)[0]!;
    ok(
      "human control overlays idle even when sessionHealthy true",
      agent.status === "idle",
    );
    ok(
      "human control subtitle says Operator",
      /operator/i.test(agent.subtitle ?? ""),
    );
    const roll = floorRollup([{ ...li, computerId: "comp_human_ctrl_1" }], s, NOW, hints);
    ok("human control is not counted as working in rollup", roll.working === 0);
    const act = agentActivityWithComputers(
      { ...li, computerId: "comp_human_ctrl_1" },
      s,
      NOW,
      hints,
    );
    ok("2D overlay: human control is not busy", act.busy === false);
    ok(
      "2D overlay: human control label mentions Operator",
      /operator/i.test(act.label),
    );
  }
}

// preferBrowserComputerAgents must rank base36-bound LI seats (not hex-only).
{
  const ranked = preferBrowserComputerAgents(
    [
      { id: "email-2", provider: "Google", position: "employee" as const, subtitle: "Outreach" },
      {
        id: "li-base36",
        provider: "LinkedIn Browser Computer",
        position: "employee" as const,
        subtitle: "LinkedIn session healthy · …z9k2m4p1",
      },
      {
        id: "li-unbound-2",
        provider: "LinkedIn Browser Computer",
        position: "employee" as const,
        subtitle: "No Browser Computer",
      },
    ],
    null,
  );
  ok("3D prefer ranks base36-bound LI before unbound", ranked[0]?.id === "li-base36");
  ok("3D prefer ranks unbound LI before email (base36 case)", ranked[1]?.id === "li-unbound-2");
  ok("3D prefer ranks email last (base36 case)", ranked[2]?.id === "email-2");
}

// Cortex must prefer assignedCampaignIds — same pool as floor.ts (no fleet-wide hash bleed).
{
  const clone = structuredClone(s);
  const mayaSeat = clone.seats.find((x) => x.id === "seat_maya")!;
  mayaSeat.assignedCampaignIds = ["camp_seed_design"];
  const floorAct = agentActivity(mayaSeat, clone, NOW);
  const cortex = agentCortexTrace(mayaSeat, clone, NOW);
  const design = clone.campaigns.find((c) => c.id === "camp_seed_design")!;
  ok("cortex assigned campaign matches floor detail", floorAct.detail === design.title);
  ok(
    "cortex narrates assigned campaign (not foreign hash pick)",
    cortex.lines.some((line) => line.includes(design.title)),
  );
}

// Rollup must match overlay — theatrical warmup + unverified VM is not "Warming up" theater.
{
  const baseLi = s.seats.find((x) => x.provider === "LinkedIn Browser Computer")!;
  const warmLi = {
    ...baseLi,
    id: "seat_warm_li_rollup",
    warmup: true,
    warmupStartCap: 5,
    warmupStepPerDay: 2,
    dailyLimit: 40,
    warmupStartedAt: new Date(NOW - 2 * 86_400_000).toISOString(),
    sentToday: 0,
    computerId: "comp_warm_li",
    status: "active" as const,
  };
  ok("fixture warm LI seat is theatrical warming", agentActivity(warmLi, s, NOW).state === "warming");
  const unverifiedMap = new Map([
    [
      warmLi.id,
      {
        status: "ready" as const,
        sessionHealthy: null as boolean | null,
        computerId: "comp_warm_li",
        seatId: warmLi.id,
      },
    ],
  ]);
  const rollUnverified = floorRollup([warmLi], s, NOW, unverifiedMap);
  const overlayUnverified = agentActivityWithComputers(warmLi, s, NOW, unverifiedMap);
  ok(
    "rollup: warmup-day + ready/unverified is not warming",
    rollUnverified.warming === 0 && overlayUnverified.state === "idle",
  );
  ok(
    "rollup: warmup-day + ready/unverified is not working",
    rollUnverified.working === 0,
  );

  const busyMap = new Map([
    [
      warmLi.id,
      {
        status: "busy" as const,
        sessionHealthy: null as boolean | null,
        computerId: "comp_warm_li_busy",
        seatId: warmLi.id,
      },
    ],
  ]);
  const rollBusy = floorRollup([warmLi], s, NOW, busyMap);
  const overlayBusy = agentActivityWithComputers(warmLi, s, NOW, busyMap);
  ok("rollup: busy VM counts warming like overlay", rollBusy.warming === 1 && overlayBusy.state === "warming");
  ok("rollup: busy VM is not working", rollBusy.working === 0);

  const healthyMap = new Map([
    [
      warmLi.id,
      {
        status: "ready" as const,
        sessionHealthy: true as boolean | null,
        computerId: "comp_warm_li_ok",
        seatId: warmLi.id,
      },
    ],
  ]);
  // ready+healthy keeps theatrical warming state in overlay — rollup must match, not invent working.
  const rollHealthyWarm = floorRollup([warmLi], s, NOW, healthyMap);
  const overlayHealthyWarm = agentActivityWithComputers(warmLi, s, NOW, healthyMap);
  ok(
    "rollup buckets match overlay for healthy warmup seat",
    rollHealthyWarm.warming === (overlayHealthyWarm.state === "warming" ? 1 : 0) &&
      rollHealthyWarm.working ===
        (["sourcing", "outreach", "booking"].includes(overlayHealthyWarm.state) ? 1 : 0) &&
      rollHealthyWarm.paused === (overlayHealthyWarm.state === "paused" ? 1 : 0),
  );

  const twinId = "seat_warm_li_healthy_twin";
  const truth = floorBrowserVmTruth(
    [
      warmLi,
      { ...warmLi, id: twinId, computerId: "comp_ok" },
    ],
    new Map([
      [
        warmLi.id,
        {
          status: "ready" as const,
          sessionHealthy: null as boolean | null,
          computerId: "comp_warm_li",
          seatId: warmLi.id,
        },
      ],
      [
        twinId,
        {
          status: "ready" as const,
          sessionHealthy: true as boolean | null,
          computerId: "comp_ok",
          seatId: twinId,
        },
      ],
    ]),
  );
  ok("floorBrowserVmTruth: bound=2", truth.bound === 2);
  ok("floorBrowserVmTruth: healthy=1 (never invent from computerId)", truth.healthy === 1);
  ok("floorBrowserVmTruth: unverified=1", truth.unverified === 1);
}

console.log(`RESULT floor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
