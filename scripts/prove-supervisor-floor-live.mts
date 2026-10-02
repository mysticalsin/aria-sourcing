/**
 * Prove ComputerSupervisor → OpenBot host → seatsToOfficeAgents for N seats.
 * Never invents sessionHealthy=true. Requires a running local/remote supervisor.
 *
 *   COMPUTER_SUPERVISOR_URL=http://127.0.0.1:18765 \
 *   COMPUTER_SUPERVISOR_TOKEN=aria-supervisor-dev \
 *   npx tsx scripts/prove-supervisor-floor-live.mts
 */
import fs from "node:fs";
import path from "node:path";
import { ComputerSupervisor } from "../src/lib/computer-supervisor.ts";
import { seatsToOfficeAgents, type ComputerFloorHint } from "../src/lib/floor3d.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import type { AgentSeat } from "../src/lib/types.ts";

const N = Math.max(2, Math.min(Number(process.env.N || 3) || 3, 5));
const OUT = process.env.EVIDENCE_OUT || path.join(process.cwd(), "_relay/evidence");
const PROFILE_ROOT = process.env.OPENBOT_PROFILE_ROOT || "/tmp/aria-openbot/profiles";
fs.mkdirSync(OUT, { recursive: true });

function ok(name: string, cond: boolean, detail = "") {
  if (!cond) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const base = (process.env.COMPUTER_SUPERVISOR_URL || "").replace(/\/$/, "");
  const token = (process.env.COMPUTER_SUPERVISOR_TOKEN || "").trim();
  if (!base || !token) {
    throw new Error("Requires COMPUTER_SUPERVISOR_URL + COMPUTER_SUPERVISOR_TOKEN");
  }
  process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "0";

  const healthRes = await fetch(`${base}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const health = await healthRes.json().catch(() => ({}));
  ok("host health", healthRes.ok === true, JSON.stringify(health));

  const sup = new ComputerSupervisor();
  const state = buildSeedState();
  const template = state.seats.find((s) => s.provider === "LinkedIn Browser Computer");
  if (!template) throw new Error("seed missing LinkedIn Browser Computer seat");

  const workspaceId = "ws_supervisor_floor_prove";
  const seats: AgentSeat[] = [];
  const hints = new Map<string, ComputerFloorHint>();

  console.log(`Supervisor→floor: start ${N} seats on ${base}`);
  for (let i = 0; i < N; i++) {
    const seatId = `seat_sup_n_${i + 1}`;
    const ensured = await sup.ensureComputer({ workspaceId, seatId });
    const started = await sup.start(ensured.computerId);
    ok(`start ${seatId}`, started.status === "ready" || started.status === "busy", started.status);
    ok(`no invent healthy on start ${seatId}`, started.sessionHealthy !== true);
    seats.push({
      ...template,
      id: seatId,
      name: `Sup N ${i + 1}`,
      computerId: started.computerId,
      provider: "LinkedIn Browser Computer",
      sentToday: 0,
    });
    hints.set(seatId, {
      status: started.status,
      sessionHealthy: started.sessionHealthy ?? null,
      computerId: started.computerId,
      control: started.control,
    });
    hints.set(started.computerId, hints.get(seatId)!);
  }

  const agents = seatsToOfficeAgents(seats, state, hints);
  const suffixes = agents.map((a) => /…([0-9a-zA-Z_-]{4,})/.exec(a.subtitle || "")?.[1] ?? null);
  ok("mapped N agents", agents.length === N);
  ok("suffixes distinct", new Set(suffixes.filter(Boolean)).size === N, suffixes.join(","));
  ok(
    "no invented working",
    agents.every((a) => a.status !== "working"),
    agents.map((a) => a.status).join(","),
  );

  const profileDirs = seats
    .map((s) => path.join(PROFILE_ROOT, s.computerId!))
    .filter((p) => fs.existsSync(p));
  ok("N distinct Chromium profile dirs", profileDirs.length === N, profileDirs.join(","));

  // Cleanup — leave host capacity free.
  for (const seat of seats) {
    try {
      await sup.stop(seat.computerId!);
    } catch {
      /* best-effort */
    }
  }

  const evidence = {
    at: new Date().toISOString(),
    mode: "supervisor-floor-live",
    n: N,
    host: base,
    computerIds: seats.map((s) => s.computerId),
    suffixes,
    statuses: agents.map((a) => ({ id: a.id, status: a.status, subtitle: a.subtitle })),
    profileDirs,
    inventedWorking: false,
    ok: true,
    note: "sessionHealthy remains human-gated; VMs real + floor wired",
  };
  const outPath = path.join(OUT, "2026-10-02-local-n-agent-supervisor-floor.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`RESULT prove-supervisor-floor-live: ok`);
  console.log(`evidence: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
