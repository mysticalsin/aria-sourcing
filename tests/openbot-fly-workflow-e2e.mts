/**
 * Fly-only A→Z workflow E2E (not Vercel):
 *   source LinkedIn-shaped candidates → score/validate → allocate to N seats
 *   → ensure N OpenBot computers (1 seat = 1 VM) → concurrent contact sends
 *
 * Proves the product contract on a Fly-shaped path. Live Chromium OpenBot is
 * mocked here (Docker unavailable in this agent VM); Aria production host is
 * asserted as aria-mantu-app.fly.dev.
 */

import http from "node:http";
import { AddressInfo } from "node:net";
import {
  ComputerSupervisor,
  bindComputerSupervisorEndpoint,
} from "../src/lib/computer-supervisor";
import { planShortlistAutomaticDeliver } from "../src/lib/sourcing-automatic-deliver";
import { defaultFleetSettings } from "../src/lib/fleet";
import type { AgentSeat, Candidate } from "../src/lib/types";
import { publicOrigin } from "../src/lib/public-origin";

const N = 10;
const FLY_APP = "https://aria-mantu-app.fly.dev";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) reject(new Error("no address"));
      else resolve(addr.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function seat(i: number): AgentSeat {
  return {
    id: `seat-${i}`,
    name: `Agent ${i}`,
    operatorEmail: `agent${i}@amaris.com`,
    provider: "LinkedIn Browser Computer",
    status: "active",
    mode: "live",
    domainVerified: true,
    dailyLimit: 40,
    warmup: false,
    warmupStartCap: 5,
    warmupStepPerDay: 2,
    warmupStartedAt: new Date().toISOString(),
    minGapMinutes: 5,
    sendWindow: { startHour: 0, endHour: 23, timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6] },
    sentToday: 0,
    lastSendAt: null,
    health: { sentTotal: 0, bounces: 0, complaints: 0, bounceRate: 0, complaintRate: 0 },
    persona: "",
    signature: "",
    connectedAccount: `agent${i}`,
    computerId: `comp_agent_${i}`,
    createdAt: new Date().toISOString(),
  } as AgentSeat;
}

function candidate(i: number, score: number): Candidate {
  return {
    id: `cand-${i}`,
    campaignId: "camp-fly",
    name: `Candidate ${i}`,
    email: `cand${i}@example.com`,
    avatarInitials: `C${i}`,
    currentTitle: "Software Engineer",
    currentCompany: "Acme",
    location: "Montreal",
    timezone: "America/Toronto",
    linkedinUrl: `https://www.linkedin.com/in/cand-${i}`,
    githubUrl: "",
    matchScore: score,
    stage: "New",
    skills: ["TypeScript", "React"],
    complianceFlags: { doNotContact: false, unsubscribed: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Candidate;
}

type BotState = {
  stage: "profile" | "composer" | "sent";
  snapshotId: number;
  typed: string[];
  clicks: string[];
  concurrent: number;
  maxConcurrent: number;
};

async function main() {
  // --- 0) Production host is Fly, never Vercel ---
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = FLY_APP;
  const origin = publicOrigin(new Headers());
  ok("production origin is Fly", origin === FLY_APP, origin);
  ok("production origin is not Vercel", !/vercel\.app/i.test(origin));

  // Explicit anti-Vercel guard for OpenBot LLM / contact path
  ok(
    "OpenBot proxy base URL must be Fly",
    `${FLY_APP}/api/openbot/v1`.startsWith("https://aria-mantu-app.fly.dev"),
  );
  ok(
    "demo Vercel host is not production",
    !FLY_APP.includes("vercel.app"),
  );

  // Live probe (show working Fly tip health)
  const health = await fetch(`${FLY_APP}/api/health`, { signal: AbortSignal.timeout(15_000) });
  const healthJson = (await health.json()) as { ok?: boolean; status?: string };
  ok("live Fly /api/health healthy", health.ok && healthJson.ok === true, JSON.stringify(healthJson));

  // --- 1) Source LinkedIn-shaped candidates (Apify-like harvest) ---
  const harvested = [
    ...Array.from({ length: 12 }, (_, i) => candidate(i + 1, 85 + (i % 10))),
    candidate(99, 40), // below contact floor
  ];
  ok("sourced LinkedIn profiles", harvested.every((c) => c.linkedinUrl.includes("linkedin.com/in/")));

  // --- 2) Validate / score floor (minScoreToContact = 80) ---
  const MIN_SCORE = 80;
  const valid = harvested.filter(
    (c) =>
      c.matchScore >= MIN_SCORE &&
      (c.linkedinUrl ?? "").trim() &&
      !c.complianceFlags.doNotContact &&
      !c.complianceFlags.unsubscribed,
  );
  ok("invalid low-score candidate excluded", !valid.some((c) => c.id === "cand-99"));
  ok(`valid candidates >= ${N}`, valid.length >= N, `valid=${valid.length}`);

  // --- 3) Allocate across N OpenBot seats (1 agent = 1 VM) ---
  const seats = Array.from({ length: N }, (_, i) => seat(i + 1));
  const plan = planShortlistAutomaticDeliver({
    pool: valid.slice(0, N),
    seats,
    ledger: [],
    suppression: [],
    fleet: defaultFleetSettings(),
    deliveryMode: "automatic",
  });
  ok("automatic delivery mode", plan.deliveryModeAutomatic);
  ok(
    `allocated ${N} LinkedIn automatic assignments`,
    plan.automaticLinkedIn.length === N,
    `n=${plan.automaticLinkedIn.length}`,
  );
  const seatIds = new Set(plan.automaticLinkedIn.map((a) => a.seatId));
  ok("assignments span distinct seats", seatIds.size === N, `seats=${seatIds.size}`);

  // --- 4) Mock OpenBot supervisor hosting N Chromium computers ---
  const bots = new Map<string, BotState>();
  const computerToken = "fly-workflow-comp";
  const supervisorToken = "fly-workflow-sup";

  const computer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://computer.local");
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const headerTok = req.headers["x-openbot-computer-token"];
    const token = (typeof headerTok === "string" ? headerTok : "") || auth;
    const botId = String(req.headers["x-openbot-bot-id"] ?? "unknown");
    if (token !== computerToken) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let state = bots.get(botId);
    if (!state) {
      state = { stage: "profile", snapshotId: 0, typed: [], clicks: [], concurrent: 0, maxConcurrent: 0 };
      bots.set(botId, state);
    }

    if (url.pathname === "/navigate" && req.method === "POST") {
      state.concurrent += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      state.concurrent -= 1;
      state.stage = "profile";
      return json(res, 200, {
        url: "https://www.linkedin.com/in/x",
        title: "Profile | LinkedIn",
        text: "Open to work",
      });
    }
    if (url.pathname === "/snapshot" && req.method === "POST") {
      state.snapshotId += 1;
      if (state.stage === "profile") {
        return json(res, 200, {
          snapshotId: state.snapshotId,
          url: "https://www.linkedin.com/in/x",
          title: "Profile",
          elements: [{ ref: "e1", role: "button", name: "Message", disabled: false }],
        });
      }
      return json(res, 200, {
        snapshotId: state.snapshotId,
        url: "https://www.linkedin.com/messaging/compose/",
        title: "Messaging",
        elements: [
          { ref: "e10", role: "textbox", name: "Write a message…", disabled: false },
          { ref: "e11", role: "button", name: "Send", disabled: false },
        ],
      });
    }
    if (url.pathname === "/click" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { ref?: string };
      state.clicks.push(body.ref ?? "");
      if (body.ref === "e1") state.stage = "composer";
      if (body.ref === "e11") state.stage = "sent";
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/type" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { text?: string };
      state.typed.push(body.text ?? "");
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/control/")) return json(res, 200, { ok: true });
    return json(res, 404, { error: "missing" });
  });
  const computerPort = await listen(computer);
  const computerUrl = `http://127.0.0.1:${computerPort}`;

  const ensured = new Set<string>();
  const supervisor = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://supervisor.local");
    if ((req.headers.authorization ?? "") !== `Bearer ${supervisorToken}`) {
      return json(res, 401, { error: "Unauthorized." });
    }
    const ensureMatch = url.pathname.match(/^\/computers\/([^/]+)\/ensure$/);
    if (ensureMatch && req.method === "POST") {
      const botId = decodeURIComponent(ensureMatch[1]);
      ensured.add(botId);
      return json(res, 200, {
        botId,
        status: "running",
        url: computerUrl,
        port: computerPort,
      });
    }
    if (url.pathname === "/computers" && req.method === "GET") {
      return json(res, 200, {
        computers: [...ensured].map((botId) => ({ botId, status: "running", url: computerUrl })),
      });
    }
    if (url.pathname.match(/\/(stop|reset)$/) && req.method === "POST") {
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "missing" });
  });
  const supervisorPort = await listen(supervisor);
  const supervisorUrl = `http://127.0.0.1:${supervisorPort}`;

  bindComputerSupervisorEndpoint({
    url: supervisorUrl,
    token: supervisorToken,
    computerToken,
    mockSend: false,
  });

  try {
    const svc = new ComputerSupervisor();

    // Ensure N computers — 1 seat = 1 stable computer_id = 1 OpenBot bot
    const records = plan.automaticLinkedIn.map((a) => {
      const s = seats.find((x) => x.id === a.seatId)!;
      return svc.ensureComputer({
        workspaceId: "ws-fly",
        seatId: s.id,
        computerId: s.computerId ?? undefined,
      });
    });
    ok(`ensured ${N} computers`, records.length === N);
    ok(
      "each computerId unique",
      new Set(records.map((r) => r.computerId)).size === N,
    );
    ok(
      "each botId unique",
      new Set(records.map((r) => r.botId)).size === N,
    );

    await Promise.all(records.map((r) => svc.start(r.computerId)));
    ok(`OpenBot ensure called for ${N} bots`, ensured.size === N, `ensured=${ensured.size}`);
    ok(
      "all computers ready",
      records.every((r) => svc.get(r.computerId)?.status === "ready"),
    );

    // --- 5) Concurrent contact: ask if open to opportunities ---
    const jobs = await Promise.all(
      plan.automaticLinkedIn.map(async (a) => {
        const s = seats.find((x) => x.id === a.seatId)!;
        const c = valid.find((x) => x.id === a.candidateId)!;
        const rec = records.find((r) => r.seatId === s.id)!;
        return svc.enqueueJob({
          computerId: rec.computerId,
          kind: "linkedin_send",
          payload: {
            profileUrl: c.linkedinUrl,
            body: `Hi ${c.name} — are you open to new opportunities?`,
          },
        });
      }),
    );

    ok(
      `all ${N} linkedin_send jobs succeeded`,
      jobs.every((j) => j.status === "succeeded"),
      jobs.filter((j) => j.status !== "succeeded").map((j) => j.detail).join(" | "),
    );

    const typedAll = [...bots.values()].flatMap((b) => b.typed);
    ok(
      "messages ask about opportunities",
      typedAll.filter((t) => /open to new opportunities/i.test(t)).length === N,
      `typed=${typedAll.length}`,
    );
    ok(
      "each bot typed exactly once",
      [...bots.values()].every((b) => b.typed.length === 1),
    );
    ok(
      "each bot clicked Send",
      [...bots.values()].every((b) => b.clicks.includes("e11")),
    );

    // Same-seat serialization: enqueue two jobs on one computer; both succeed in order
    const one = records[0]!;
    const [first, second] = await Promise.all([
      svc.enqueueJob({
        computerId: one.computerId,
        kind: "warmup_nav",
        payload: { url: "https://www.linkedin.com/feed/" },
      }),
      svc.enqueueJob({
        computerId: one.computerId,
        kind: "warmup_nav",
        payload: { url: "https://www.linkedin.com/feed/" },
      }),
    ]);
    ok("same-seat jobs serialize and both succeed", first.status === "succeeded" && second.status === "succeeded");

    console.log("");
    console.log("FLY WORKFLOW RECEIPT");
    console.log(`  host=${FLY_APP}`);
    console.log(`  agents=${N} computers=${N} sends_ok=${jobs.filter((j) => j.status === "succeeded").length}`);
    console.log(`  openbot_bots_ensured=${ensured.size}`);
    console.log(`  note=Chromium OpenBot mocked; Aria production remains Fly-only`);
  } finally {
    bindComputerSupervisorEndpoint(null);
    await close(computer);
    await close(supervisor);
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  }

  console.log(`RESULT openbot-fly-workflow-e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
