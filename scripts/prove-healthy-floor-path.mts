import { seatsToOfficeAgents } from "../src/lib/floor3d.ts";
import { agentActivityWithComputers } from "../src/lib/floor.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import type { AgentSeat } from "../src/lib/types.ts";
import fs from "node:fs";

const s = buildSeedState();
const template = s.seats.find((x) => x.provider === "LinkedIn Browser Computer")!;
const seats: AgentSeat[] = [1, 2, 3].map((i) => ({
  ...template,
  id: `seat_healthy_${i}`,
  name: `Healthy ${i}`,
  computerId: `comp_health_${i}aabbcc`,
  provider: "LinkedIn Browser Computer",
  sentToday: 0,
}));
const hints = new Map(
  seats.map((seat) => [
    seat.id,
    {
      status: "ready" as const,
      sessionHealthy: true as const,
      computerId: seat.computerId!,
      control: "bot" as const,
    },
  ]),
);
const agents = seatsToOfficeAgents(seats, s, hints);
const acts = seats.map((seat) => agentActivityWithComputers(seat, s, Date.now(), hints));
// ready+healthy with zero sends stays idle — never invent working theater.
const ok =
  agents.length === 3 &&
  agents.every((a) => a.status === "idle") &&
  agents.every((a) => /session healthy/i.test(a.subtitle || "")) &&
  new Set(agents.map((a) => /…([0-9a-zA-Z_-]+)/.exec(a.subtitle || "")?.[1]).filter(Boolean)).size ===
    3 &&
  acts.every((a) => a.state === "idle" && /healthy/i.test(a.label) && /…/.test(a.label));
const evidence = {
  at: new Date().toISOString(),
  mode: "healthy-floor-path-unit",
  agents: agents.map((a) => ({ id: a.id, status: a.status, subtitle: a.subtitle })),
  labels: acts.map((a) => a.label),
  ok,
  note: "When probe returns healthy=true with zero sends, floor paints idle + healthy label + VM suffixes (never invent working)",
};
fs.mkdirSync("_relay/evidence", { recursive: true });
fs.writeFileSync("_relay/evidence/2026-10-02-healthy-floor-path.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!ok) process.exit(1);
console.log("RESULT healthy-floor-path: ok");
