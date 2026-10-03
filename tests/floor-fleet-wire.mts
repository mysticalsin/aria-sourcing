/* ==========================================================================
   tests/floor-fleet-wire.mts
   Prove FE floor paints N agents from the same /api/fleet/computers shape
   Fleet uses — no invented sessionHealthy working.
   ========================================================================== */

import { seatsToOfficeAgents } from "../src/lib/floor3d";
import { HOST_ORPHAN_SEAT_ID } from "../src/lib/computer-constants";
import { buildSeedState } from "../src/lib/seed";
import type { AgentSeat } from "../src/lib/types";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

type ApiComputer = {
  computerId: string;
  seatId: string;
  status: string;
  control?: "bot" | "human";
  sessionHealthy?: boolean | null;
};

/** Same mapping floor/page.tsx uses after GET /api/fleet/computers. */
function computerHintsFromFleetApi(rows: ApiComputer[]) {
  const map = new Map<
    string,
    {
      status: string;
      sessionHealthy?: boolean | null;
      control?: "bot" | "human";
      computerId?: string;
      seatId?: string;
    }
  >();
  for (const c of rows) {
    if (!c.seatId || c.seatId === HOST_ORPHAN_SEAT_ID) continue;
    const hint = {
      status: c.status,
      sessionHealthy: c.sessionHealthy,
      control: c.control ?? "bot",
      computerId: c.computerId,
      seatId: c.seatId,
    };
    map.set(c.seatId, hint);
    map.set(c.computerId, hint);
  }
  return map;
}

const s = buildSeedState();
const template = s.seats.find((x) => x.provider === "LinkedIn Browser Computer") ?? s.seats[0];

{
  const seats: AgentSeat[] = [
    {
      ...template,
      id: "seat_a",
      name: "A",
      computerId: "comp_aaaa1111",
      provider: "LinkedIn Browser Computer",
      sentToday: 0,
    },
    {
      ...template,
      id: "seat_b",
      name: "B",
      computerId: "comp_bbbb2222",
      provider: "LinkedIn Browser Computer",
      sentToday: 0,
    },
    {
      ...template,
      id: "seat_c",
      name: "C",
      computerId: "comp_cccc3333",
      provider: "LinkedIn Browser Computer",
      sentToday: 0,
    },
  ];
  const apiRows: ApiComputer[] = [
    {
      computerId: "comp_aaaa1111",
      seatId: "seat_a",
      status: "ready",
      sessionHealthy: true,
      control: "bot",
    },
    {
      computerId: "comp_bbbb2222",
      seatId: "seat_b",
      status: "ready",
      sessionHealthy: null,
      control: "bot",
    },
    {
      computerId: "comp_cccc3333",
      seatId: "seat_c",
      status: "ready",
      sessionHealthy: false,
      control: "bot",
    },
    {
      computerId: "comp_orphan",
      seatId: HOST_ORPHAN_SEAT_ID,
      status: "ready",
      sessionHealthy: true,
      control: "bot",
    },
  ];
  const hints = computerHintsFromFleetApi(apiRows);
  const agents = seatsToOfficeAgents(seats, s, hints);

  ok("N seats → N floor agents", agents.length === 3);
  ok(
    "ready+healthy idle; unverified idle; unhealthy error (no invent working)",
    agents.find((a) => a.id === "seat_a")?.status === "idle" &&
      agents.find((a) => a.id === "seat_b")?.status === "idle" &&
      agents.find((a) => a.id === "seat_c")?.status === "error",
  );
  ok(
    "orphan healthy VM does not paint any seat working",
    !agents.some((a) => a.status === "working"),
  );
  ok(
    "probed-healthy subtitle stamps session healthy without working theater",
    /session healthy/i.test(agents.find((a) => a.id === "seat_a")?.subtitle || ""),
  );
  const suffixes = agents.map((a) => /…([0-9a-zA-Z_-]{4,})/.exec(a.subtitle || "")?.[1] ?? "");
  ok(
    "N distinct VM suffixes from fleet computerIds",
    new Set(suffixes.filter(Boolean)).size === 3,
  );
  ok(
    "healthy seat subtitle carries its own computer suffix",
    (agents.find((a) => a.id === "seat_a")?.subtitle || "").includes("aaaa1111"),
  );
}

{
  const floorPage = readFileSync("src/app/floor/page.tsx", "utf8");
  ok(
    "floor polls /api/fleet/computers",
    floorPage.includes('fetch("/api/fleet/computers"'),
  );
  ok(
    "floor skips __orphan__ when building hints",
    floorPage.includes('seatId === "__orphan__"') &&
      floorPage.includes("continue") &&
      !/if \(c\.computerId\) map\.set\(c\.computerId/.test(floorPage),
  );
  ok(
    "floor never invents sessionHealthy true",
    !/sessionHealthy:\s*true/.test(floorPage),
  );
  const floorLib = readFileSync("src/lib/floor.ts", "utf8");
  ok(
    "busy+healthy with zero sends is idle not sourcing theater",
    /hint\.status === "busy" && healthyBusy/.test(floorLib) &&
      /zero sends ⇒ idle/.test(floorLib) &&
      !/state: realSends && base\.state !== "idle" \? base\.state : "sourcing"/.test(floorLib),
  );
  ok(
    "ready+healthy never upgrades idle base to sourcing",
    /Never upgrade idle bases/.test(floorLib) &&
      !/state: base\.state === "idle" \? "sourcing"/.test(floorLib),
  );
  ok(
    "floor caption includes bound count from floorBrowserVmTruth",
    floorPage.includes("floorBrowserVmTruth") && floorPage.includes("${t.bound} bound"),
  );
  ok(
    "attributed pulse may walk idle healthy BC (never invent sessionHealthy)",
    floorPage.includes("pulsingSeatIds") &&
      floorPage.includes("sessionHealthy !== true") &&
      !/Idle \/ warming \/ error stay put/.test(floorPage) &&
      floorPage.includes('status: "working" as const'),
  );
  ok(
    "floor ActivityTicker filters LI events without campaign attach",
    /ActivityTicker/.test(floorPage) &&
      /seatAttachedToCampaign\(seat, e\.campaignId\)/.test(floorPage),
  );
  const packetFx = readFileSync(
    "src/components/floor3d/retro/scene/PacketFX.tsx",
    "utf8",
  );
  ok(
    "PacketFX gates LI packets on campaign attach",
    packetFx.includes("seatAttachedToCampaign") &&
      packetFx.includes("isBrowserComputerSeat"),
  );
  ok(
    "floor syncs durable browserSeatBindings into Hermes",
    floorPage.includes("browserSeatBindings") &&
      floorPage.includes("ingestDurableBrowserBindings") &&
      floorPage.includes("seatAttachedToCampaign"),
  );
  ok(
    "floor LI pulse requires campaign attach on event",
    /seatAttachedToCampaign\(seat, e\.campaignId\)/.test(floorPage),
  );
}

{
  const route = readFileSync("src/app/api/fleet/computers/route.ts", "utf8");
  const ensureIdx = route.indexOf('case "ensure"');
  const ensureBlock = ensureIdx >= 0 ? route.slice(ensureIdx, ensureIdx + 1200) : "";
  ok(
    "ensure persists agent_seats.computer_id",
    ensureBlock.includes('.from("agent_seats")') &&
      ensureBlock.includes("computer_id: rec.computerId") &&
      ensureBlock.includes("ensure computer_id persist failed"),
  );
}


{
  const route = readFileSync("src/app/api/fleet/computers/route.ts", "utf8");
  const refine = route.slice(route.indexOf("superRefine"), route.indexOf("hydrateWorkspaceSeatBindings"));
  ok(
    "ensure may omit computerId (server mint)",
    refine.includes('body.action === "ensure"') &&
      refine.includes("server makeId"),
  );
}


{
  const route = readFileSync("src/app/api/fleet/computers/route.ts", "utf8");
  ok(
    "GET refreshes session health for floor polls",
    route.includes("refreshSessionHealthForList"),
  );
  const supervisor = readFileSync("src/lib/computer-supervisor.ts", "utf8");
  ok(
    "refreshSessionHealthForList never invents true",
    supervisor.includes("Never invents healthy=true") &&
      supervisor.includes("refreshSessionHealthForList"),
  );
}

{
  const agentsPanel = readFileSync(
    "src/components/campaigns/campaign-agents-panel.tsx",
    "utf8",
  );
  ok(
    "campaign agents clear computers paint on fleet GET fail",
    agentsPanel.includes("setComputers([])") &&
      agentsPanel.includes("Fleet computers unavailable"),
  );
  const healthStrip = readFileSync("src/components/fleet/fleet-health-strip.tsx", "utf8");
  ok(
    "fleet health strip clears LI healthy map on fleet GET fail",
    healthStrip.includes("setLiHealthyBySeat(new Map())") &&
      healthStrip.includes("!res.ok"),
  );
  ok(
    "fleet health strip seats churn must not remount poll / ingest after cancel",
    /\}, \[actions\]\)/.test(healthStrip) &&
      !/\}, \[actions, seats\]\)/.test(healthStrip) &&
      /if \(cancelled\) return/.test(healthStrip),
  );
  const floorPage = readFileSync("src/app/floor/page.tsx", "utf8");
  ok(
    "floor fleet poll seatsRef — cancel before Hermes write; deps [actions] only",
    floorPage.includes("seatsRef") &&
      /do not write stale Hermes patches after cancel/.test(floorPage) &&
      /\}, \[actions\]\);/.test(floorPage) &&
      !/\}, \[actions, seats\.length\]\)/.test(floorPage),
  );
  ok(
    "floor poll applies fleetHermes patches locally — never updateSeat computerId",
    floorPage.includes("applyFleetHermesComputerPatches") &&
      !/updateSeat\(patch\.seatId, \{ computerId: patch\.computerId \}\)/.test(floorPage),
  );
  const fleetPage = readFileSync("src/app/fleet/page.tsx", "utf8");
  ok(
    "fleet page clears computers on GET fail",
    fleetPage.includes("if (!res.ok)") &&
      fleetPage.includes("setComputers([])"),
  );
  ok(
    "fleet page clears computers on poll throw (not only !res.ok)",
    /catch \{[\s\S]*setComputers\(\[\]\)[\s\S]*setOpsSummary\(null\)/.test(fleetPage),
  );
  ok(
    "fleet page syncs durable browserSeatBindings",
    fleetPage.includes("ingestDurableBrowserBindings") &&
      fleetPage.includes("browserSeatBindings"),
  );
  ok(
    "fleet health strip headline uses send-ready (not domain liveSeats theater)",
    healthStrip.includes("send-ready") &&
      healthStrip.includes("ingestDurableBrowserBindings") &&
      !/\$\{s\.liveSeats\} live/.test(healthStrip),
  );
  const fleetLib = readFileSync("src/lib/fleet.ts", "utf8");
  ok(
    "fleetSummary liveSeats excludes Browser Computer (sessionHealthy path)",
    fleetLib.includes("isBrowserComputerSeat") &&
      fleetLib.includes("never count domainVerified theater") &&
      /liveSeats: seats\.filter/.test(fleetLib),
  );
}

console.log(`floor-fleet-wire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
