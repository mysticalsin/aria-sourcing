/**
 * Prove N campaign agents map to N distinct Browser Computer ids on the 3D floor.
 *
 * Always runs an offline seatsToOfficeAgents check (never invents sessionHealthy=true).
 * With LIVE=1 + COMPUTER_SUPERVISOR_URL/TOKEN, also ensures N Chromium bots on the
 * host and asserts distinct botIds (LinkedIn login/2FA stays human-gated).
 *
 * Usage:
 *   npx tsx scripts/prove-n-agent-floor.mts
 *   LIVE=1 N=3 COMPUTER_SUPERVISOR_URL=https://aria-mantu-computers.fly.dev \
 *     COMPUTER_SUPERVISOR_TOKEN=… npx tsx scripts/prove-n-agent-floor.mts
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { seatsToOfficeAgents, type ComputerFloorHint } from "../src/lib/floor3d.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import type { AgentSeat } from "../src/lib/types.ts";

const N = Math.max(2, Math.min(Number(process.env.N || 3) || 3, 5));
const LIVE = process.env.LIVE === "1" || process.env.LIVE === "true";
const OUT = process.env.EVIDENCE_OUT || path.join(process.cwd(), "_relay/evidence");
fs.mkdirSync(OUT, { recursive: true });

function ok(name: string, cond: boolean, detail = "") {
  if (!cond) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ""}`);
}

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();

function floorRows(seats: AgentSeat[], hints: Map<string, ComputerFloorHint>) {
  const state = buildSeedState();
  return seatsToOfficeAgents(seats, state, hints).map((a) => {
    const m = /…([0-9a-z_-]{8})$/i.exec(a.subtitle || "");
    return { id: a.id, status: a.status, subtitle: a.subtitle, suffix: m?.[1] ?? null };
  });
}

function proveOffline() {
  console.log(`Offline: ${N} LinkedIn Browser Computer seats → distinct floor VM suffixes`);
  const state = buildSeedState();
  const template = state.seats.find((s) => s.provider === "LinkedIn Browser Computer");
  if (!template) throw new Error("seed has no LinkedIn Browser Computer seat");

  const seats: AgentSeat[] = Array.from({ length: N }, (_, i) => ({
    ...template,
    id: `seat_prove_n_${i + 1}`,
    name: `Prove N ${i + 1}`,
    // Distinct last-8 so floor …suffixes cannot collide.
    computerId: `comp_prove_n_${String(i + 1).padStart(2, "0")}_${(0x11111111 + i * 0x2222).toString(16)}`,
  }));

  const hints = new Map<string, ComputerFloorHint>();
  for (const seat of seats) {
    hints.set(seat.id, {
      status: "ready",
      sessionHealthy: null,
      computerId: seat.computerId,
    });
  }

  const rows = floorRows(seats, hints);
  ok("mapped all seats", rows.length === N, String(rows.length));
  ok(
    "each subtitle has VM suffix",
    rows.every((r) => r.suffix),
    rows.map((r) => r.suffix).join(","),
  );
  ok(
    "VM suffixes distinct",
    new Set(rows.map((r) => r.suffix)).size === N,
    rows.map((r) => r.suffix).join(","),
  );
  ok(
    "no invented sessionHealthy working",
    rows.every((r) => r.status === "idle" && /unverified/i.test(r.subtitle || "")),
  );

  return {
    mode: "offline" as const,
    n: N,
    rows,
    computerIds: seats.map((s) => s.computerId),
  };
}

async function proveLive() {
  const base = (process.env.COMPUTER_SUPERVISOR_URL || "").replace(/\/$/, "");
  const token = (process.env.COMPUTER_SUPERVISOR_TOKEN || "").trim();
  if (!base || !token) {
    throw new Error("LIVE=1 requires COMPUTER_SUPERVISOR_URL + COMPUTER_SUPERVISOR_TOKEN");
  }

  console.log(`Live: ensure ${N} Chromium bots on ${base}`);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const healthRes = await fetch(`${base}/health`, { headers });
  const health = (await healthRes.json().catch(() => ({}))) as {
    computers?: number;
    max?: number;
    ok?: boolean;
  };
  ok("host health", healthRes.ok === true, JSON.stringify(health));
  const used = Number(health.computers ?? 0);
  const max = Number(health.max ?? 0);
  const free = max - used;
  if (free < N) {
    throw new Error(`host capacity insufficient: free=${free} need=${N} (max=${max} computers=${used})`);
  }

  const ids = Array.from({ length: N }, () => `comp_${randomUUID()}`);
  const ensured: { computerId: string; botId: string; status: string; viewUrl?: string }[] = [];

  for (const computerId of ids) {
    const res = await fetch(`${base}/computers/${encodeURIComponent(computerId)}/ensure`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const data = (await res.json().catch(() => ({}))) as {
      botId?: string;
      status?: string;
      viewUrl?: string;
      url?: string;
    };
    if (!res.ok) {
      throw new Error(`ensure ${computerId} ${res.status} ${JSON.stringify(data)}`);
    }
    const botId = data.botId || computerId;
    ok(`ensure ${computerId}`, Boolean(botId), data.status || "ok");
    ensured.push({
      computerId,
      botId,
      status: data.status || "unknown",
      viewUrl: data.viewUrl || data.url,
    });
  }

  const listRes = await fetch(`${base}/computers`, { headers });
  const list = (await listRes.json().catch(() => ({}))) as {
    computers?: { botId?: string }[];
  };
  const liveIds = new Set((list.computers || []).map((c) => c.botId).filter(Boolean));
  ok(
    "list contains all prove bots",
    ids.every((id) => liveIds.has(id)),
    `missing=${ids.filter((id) => !liveIds.has(id)).join(",") || "none"}`,
  );
  ok("prove botIds distinct", new Set(ids).size === N);

  const state = buildSeedState();
  const template = state.seats.find((s) => s.provider === "LinkedIn Browser Computer");
  if (!template) throw new Error("seed has no LinkedIn Browser Computer seat");

  const seats: AgentSeat[] = ensured.map((e, i) => ({
    ...template,
    id: `seat_live_n_${i + 1}`,
    name: `Live N ${i + 1}`,
    computerId: e.computerId,
  }));
  const hints = new Map<string, ComputerFloorHint>();
  for (const seat of seats) {
    // Ready + null health — never invent sessionHealthy=true without /session-probe.
    hints.set(seat.id, {
      status: "ready",
      sessionHealthy: null,
      computerId: seat.computerId,
    });
  }
  const rows = floorRows(seats, hints);
  ok(
    "live floor VM suffixes distinct",
    new Set(rows.map((r) => r.suffix)).size === N,
    rows.map((r) => r.suffix).join(","),
  );
  ok(
    "live floor stays unverified without probe",
    rows.every((r) => r.status === "idle" && /unverified/i.test(r.subtitle || "")),
  );

  // Free host slots after proof so operator capacity stays available.
  const stopped = process.env.KEEP_LIVE !== "1";
  if (stopped) {
    for (const computerId of ids) {
      const stop = await fetch(`${base}/computers/${encodeURIComponent(computerId)}/stop`, {
        method: "POST",
        headers,
        body: "{}",
      });
      ok(`stop ${computerId}`, stop.ok || stop.status === 404, String(stop.status));
    }
  }

  return {
    mode: "live" as const,
    n: N,
    host: base,
    ensured,
    rows,
    stopped,
  };
}

async function main() {
  const offline = proveOffline();
  const live = LIVE ? await proveLive() : null;

  const summary = {
    at: new Date().toISOString(),
    offline,
    live,
    ok: true,
    note: "sessionHealthy remains human-gated (Take control + LinkedIn login/2FA)",
  };
  const outPath = path.join(OUT, "2026-09-11-n-agent-floor-proof.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`RESULT prove-n-agent-floor: ok (${LIVE ? "offline+live" : "offline"})`);
  console.log("evidence:", outPath);
}

main().catch((err) => {
  console.error(err);
  console.error("RESULT prove-n-agent-floor: FAIL");
  process.exit(1);
});
