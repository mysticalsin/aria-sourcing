import { agentActivity, agentActivityWithComputers, floorRollup } from "../src/lib/floor";
import { pickResponderIndex, seatsToOfficeAgents } from "../src/lib/floor3d";
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
    "pulse falls back without seatId",
    typeof pickResponderIndex({ ...e, seatId: undefined }, ids.length, ids) === "number",
  );
}

{
  const agents = seatsToOfficeAgents(s.seats, s);
  ok("office agents = seat count", agents.length === s.seats.length);
  const hinted = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "help_requested" }]]),
  );
  const maya = hinted.find((a) => a.id === "seat_maya")!;
  ok("help_requested overlays error", maya.status === "error");
  ok("help_requested subtitle", maya.subtitle === "Needs Take control");

  const healthy = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "ready", sessionHealthy: true }]]),
  ).find((a) => a.id === "seat_maya")!;
  ok("ready+healthy overlays working", healthy.status === "working");
  ok("ready+healthy subtitle", healthy.subtitle === "LinkedIn session healthy");

  const unverified = seatsToOfficeAgents(
    s.seats,
    s,
    new Map([["seat_maya", { status: "ready", sessionHealthy: null }]]),
  ).find((a) => a.id === "seat_maya")!;
  ok("ready+null overlays idle unverified", unverified.status === "idle");
  ok(
    "ready+null subtitle asks Take control",
    unverified.subtitle.includes("unverified"),
  );

  const liSeat = s.seats.find((x) => x.provider === "LinkedIn Browser Computer");
  if (liSeat) {
    const missing = seatsToOfficeAgents(s.seats, s, new Map()).find((a) => a.id === liSeat.id)!;
    ok(
      "LinkedIn seat without VM row is idle",
      missing.status === "idle" && /Browser Computer|not on host/.test(missing.subtitle),
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

console.log(`RESULT floor: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
