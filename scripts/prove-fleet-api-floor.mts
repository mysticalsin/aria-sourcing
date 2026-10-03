/**
 * Full FE↔BE prove without inventing sessionHealthy:
 * POST /api/fleet/computers (ensure+start) → GET list → floor mapping.
 *
 * Prefers APP_BASE (Next) + local OpenBot already bound via env on the Next process.
 *
 *   APP_BASE=http://127.0.0.1:3000 N=3 npx tsx scripts/prove-fleet-api-floor.mts
 */
import fs from "node:fs";
import path from "node:path";
import { seatsToOfficeAgents, type ComputerFloorHint } from "../src/lib/floor3d.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import { HOST_ORPHAN_SEAT_ID } from "../src/lib/computer-constants.ts";
import type { AgentSeat } from "../src/lib/types.ts";

const N = Math.max(2, Math.min(Number(process.env.N || 3) || 3, 5));
const APP = (process.env.APP_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = process.env.EVIDENCE_OUT || path.join(process.cwd(), "_relay/evidence");
fs.mkdirSync(OUT, { recursive: true });

function ok(name: string, cond: boolean, detail = "") {
  if (!cond) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function postComputer(body: Record<string, unknown>) {
  const res = await fetch(`${APP}/api/fleet/computers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  console.log(`Fleet API→floor prove against ${APP} (N=${N})`);

  const get0 = await fetch(`${APP}/api/fleet/computers`);
  ok("GET fleet computers reachable", get0.ok, String(get0.status));

  const started: { seatId: string; computerId: string; status: string; sessionHealthy: unknown }[] =
    [];

  for (let i = 0; i < N; i++) {
    const seatId = `seat_api_n_${i + 1}`;
    const ensure = await postComputer({ action: "ensure", seatId });
    ok(`ensure ${seatId}`, ensure.res.ok, JSON.stringify(ensure.json?.error || ensure.json?.computer?.computerId));
    const computerId = String(ensure.json?.computer?.computerId || "").trim();
    ok(`ensure returned computerId ${seatId}`, Boolean(computerId));

    const start = await postComputer({ action: "start", seatId, computerId });
    ok(
      `start ${seatId}`,
      start.res.ok && (start.json?.computer?.status === "ready" || start.json?.computer?.status === "busy"),
      start.json?.error || start.json?.computer?.status,
    );
    ok(
      `start did not invent healthy ${seatId}`,
      start.json?.sessionHealthy !== true && start.json?.computer?.sessionHealthy !== true,
    );
    started.push({
      seatId,
      computerId: String(start.json?.computer?.computerId || computerId),
      status: String(start.json?.computer?.status || ""),
      sessionHealthy: start.json?.computer?.sessionHealthy ?? start.json?.sessionHealthy ?? null,
    });
  }

  const get1 = await fetch(`${APP}/api/fleet/computers`);
  const list = (await get1.json()) as {
    computers?: Array<{
      computerId: string;
      seatId: string;
      status: string;
      control?: "bot" | "human";
      sessionHealthy?: boolean | null;
    }>;
    hostCapacity?: { computers?: number; max?: number };
  };
  ok("GET after start ok", get1.ok);
  const rows = (list.computers || []).filter(
    (c) => c.seatId && c.seatId !== HOST_ORPHAN_SEAT_ID && c.seatId.startsWith("seat_api_n_"),
  );
  const ours = started.map((s) => rows.find((r) => r.seatId === s.seatId)).filter(Boolean);
  ok("GET lists each started seat computer", ours.length === N, String(ours.length));
  ok(
    "GET computerIds distinct for started seats",
    new Set(ours.map((c) => c!.computerId)).size === N,
  );
  ok(
    "GET never invents sessionHealthy true",
    ours.every((c) => c!.sessionHealthy !== true),
  );

  // Same mapping floor/page.tsx uses after polling GET /api/fleet/computers
  const hints = new Map<string, ComputerFloorHint>();
  for (const c of ours) {
    const hint: ComputerFloorHint = {
      status: c!.status,
      sessionHealthy: c!.sessionHealthy,
      control: c!.control ?? "bot",
      computerId: c!.computerId,
      seatId: c!.seatId,
    };
    hints.set(c!.seatId, hint);
    hints.set(c!.computerId, hint);
  }

  const state = buildSeedState();
  const template = state.seats.find((s) => s.provider === "LinkedIn Browser Computer");
  if (!template) throw new Error("seed missing LI Browser Computer");
  const seats: AgentSeat[] = started.map((s, i) => ({
    ...template,
    id: s.seatId,
    name: `API N ${i + 1}`,
    computerId: s.computerId,
    provider: "LinkedIn Browser Computer",
    sentToday: 0,
  }));
  const agents = seatsToOfficeAgents(seats, state, hints);
  const suffixes = agents.map((a) => /…([0-9a-zA-Z_-]{4,})/.exec(a.subtitle || "")?.[1] ?? null);
  ok("floor maps N agents", agents.length === N);
  ok("floor suffixes distinct", new Set(suffixes.filter(Boolean)).size === N, suffixes.join(","));
  ok(
    "floor no invented working",
    agents.every((a) => a.status !== "working"),
    agents.map((a) => `${a.id}:${a.status}`).join(","),
  );

  // Cleanup
  for (const s of started) {
    await postComputer({ action: "stop", seatId: s.seatId, computerId: s.computerId }).catch(() => null);
  }

  const evidence = {
    at: new Date().toISOString(),
    mode: "fleet-api-floor",
    app: APP,
    n: N,
    hostCapacity: list.hostCapacity ?? null,
    started,
    getRows: ours,
    floor: agents.map((a, i) => ({
      id: a.id,
      status: a.status,
      subtitle: a.subtitle,
      suffix: suffixes[i],
    })),
    ok: true,
    note: "FE API wire proven locally; LinkedIn sessionHealthy remains human-gated",
  };
  const outPath = path.join(OUT, "2026-10-02-fleet-api-floor-prove.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`RESULT prove-fleet-api-floor: ok`);
  console.log(`evidence: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
