/* ==========================================================================
   tests/openbot-e2e.mts
   End-to-end: Aria ComputerSupervisor ↔ mock OpenBot supervisor + agent-computer
   + Aria OpenAI-compatible LLM proxy.
   ========================================================================== */

import http from "node:http";
import { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import {
  ComputerSupervisor,
  bindComputerSupervisorEndpoint,
} from "../src/lib/computer-supervisor";
import {
  openBotEnsureComputer,
  openBotStopComputer,
} from "../src/lib/openbot/supervisor-client";
import {
  openBotNavigate,
  openBotSnapshot,
  openBotClick,
  openBotType,
} from "../src/lib/openbot/agent-computer-client";
import { openBotLinkedInSend } from "../src/lib/openbot/linkedin-send";
import * as chatRoute from "../src/app/api/openbot/v1/chat/completions/route";
import * as modelsRoute from "../src/app/api/openbot/v1/models/route";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, detail);
  }
}

type MockState = {
  supervisorToken: string;
  computerToken: string;
  ensured: Set<string>;
  pageUrl: string;
  stage: "profile" | "composer" | "sent" | "login";
  typed: string[];
  clicks: string[];
  navigations: string[];
  snapshotId: number;
};

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

function profileElements(snapshotId: number) {
  return {
    snapshotId,
    url: "https://www.linkedin.com/in/jane-doe",
    title: "Jane Doe | LinkedIn",
    elements: [
      { ref: "e1", role: "button", name: "Message" },
      { ref: "e2", role: "button", name: "More" },
      { ref: "e3", role: "link", name: "Experience" },
    ],
  };
}

function composerElements(snapshotId: number) {
  return {
    snapshotId,
    url: "https://www.linkedin.com/messaging/compose",
    title: "Messaging | LinkedIn",
    elements: [
      { ref: "e10", role: "textbox", name: "Write a message…" },
      { ref: "e11", role: "button", name: "Send" },
      { ref: "e12", role: "button", name: "Emoji" },
    ],
  };
}

function loginElements(snapshotId: number) {
  return {
    snapshotId,
    url: "https://www.linkedin.com/login",
    title: "Sign in | LinkedIn",
    elements: [
      { ref: "e20", role: "textbox", name: "Email" },
      { ref: "e21", role: "button", name: "Sign in" },
    ],
  };
}

async function main() {
  const state: MockState = {
    supervisorToken: "sup-secret",
    computerToken: "comp-secret",
    ensured: new Set(),
    pageUrl: "about:blank",
    stage: "profile",
    typed: [],
    clicks: [],
    navigations: [],
    snapshotId: 0,
  };

  // ---- Fake upstream OpenAI for Aria LLM proxy ----
  const openaiUpstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}") as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const last = parsed.messages?.at(-1)?.content ?? "";
    // Element picker asks for JSON {"ref":"..."}
    const refMatch = /ref=([a-z0-9]+)/i.exec(last);
    const reply =
      last.includes("Goal:") && last.includes("Elements:")
        ? JSON.stringify({ ref: refMatch?.[1] ?? "e1" })
        : "hello from aria llm proxy";
    json(res, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
    });
  });
  const openaiPort = await listen(openaiUpstream);
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevOpenAiBase = process.env.OPENAI_BASE_URL;
  // Provider uses fixed CLOUD_ENDPOINT.openai — we can't redirect that without
  // patching fetch. For proxy route tests we stub global fetch for api.openai.com.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.includes("api.openai.com")) {
      return realFetch(`http://127.0.0.1:${openaiPort}/v1/chat/completions`, init);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  // ---- Mock agent-computer ----
  const computer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://computer.local");
    const auth = req.headers.authorization ?? "";
    const headerTok = req.headers["x-openbot-computer-token"];
    const token =
      (typeof headerTok === "string" ? headerTok : "") ||
      auth.replace(/^Bearer\s+/i, "");
    if (url.pathname !== "/health" && token !== state.computerToken) {
      return json(res, 401, { error: "Not authorised." });
    }

    if (url.pathname === "/navigate" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { url?: string };
      state.pageUrl = body.url ?? state.pageUrl;
      state.navigations.push(state.pageUrl);
      if (/\/login|authwall|checkpoint/i.test(state.pageUrl)) {
        state.stage = "login";
      } else if (state.stage !== "composer" && state.stage !== "sent") {
        state.stage = "profile";
      }
      return json(res, 200, {
        url: state.pageUrl,
        title:
          state.stage === "login"
            ? "Sign in | LinkedIn"
            : "Jane Doe | LinkedIn",
        text:
          state.stage === "login"
            ? "Sign in to LinkedIn"
            : "Jane Doe · Software Engineer",
      });
    }

    if (url.pathname === "/snapshot" && req.method === "POST") {
      state.snapshotId += 1;
      const payload =
        state.stage === "login"
          ? loginElements(state.snapshotId)
          : state.stage === "composer" || state.stage === "sent"
            ? composerElements(state.snapshotId)
            : profileElements(state.snapshotId);
      return json(res, 200, payload);
    }

    if (url.pathname === "/click" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        ref?: string;
        snapshotId?: number;
      };
      if (typeof body.snapshotId !== "number" || body.snapshotId !== state.snapshotId) {
        return json(res, 409, { error: "stale snapshot", stale: true });
      }
      state.clicks.push(body.ref ?? "");
      if (body.ref === "e1") state.stage = "composer";
      if (body.ref === "e11") state.stage = "sent";
      return json(res, 200, { action: "click", ref: body.ref, url: state.pageUrl });
    }

    if (url.pathname === "/type" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        ref?: string;
        snapshotId?: number;
        text?: string;
      };
      if (typeof body.snapshotId !== "number" || body.snapshotId !== state.snapshotId) {
        return json(res, 409, { error: "stale snapshot", stale: true });
      }
      state.typed.push(body.text ?? "");
      return json(res, 200, {
        action: "type",
        ref: body.ref,
        characters: (body.text ?? "").length,
      });
    }

    if (url.pathname === "/control/take" && req.method === "POST") {
      return json(res, 200, { control: "human" });
    }
    if (url.pathname === "/control/release" && req.method === "POST") {
      return json(res, 200, { control: "bot" });
    }
    if (url.pathname === "/read" && req.method === "GET") {
      return json(res, 200, {
        url: state.pageUrl,
        title: "page",
        text: "readable",
      });
    }

    return json(res, 404, { error: "not found" });
  });
  const computerPort = await listen(computer);
  const computerUrl = `http://127.0.0.1:${computerPort}`;

  // ---- Mock supervisor ----
  const supervisor = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://supervisor.local");
    const auth = req.headers.authorization ?? "";
    if (url.pathname !== "/health" && auth !== `Bearer ${state.supervisorToken}`) {
      return json(res, 401, { error: "Unauthorized." });
    }

    const ensureMatch = url.pathname.match(/^\/computers\/([^/]+)\/ensure$/);
    if (ensureMatch && req.method === "POST") {
      const botId = decodeURIComponent(ensureMatch[1]);
      state.ensured.add(botId);
      return json(res, 200, {
        botId,
        container: `openbot-computer-${botId}`,
        status: "running",
        port: computerPort,
        url: computerUrl,
      });
    }

    const stopMatch = url.pathname.match(/^\/computers\/([^/]+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      state.ensured.delete(decodeURIComponent(stopMatch[1]));
      return json(res, 200, { stopped: true });
    }

    const resetMatch = url.pathname.match(/^\/computers\/([^/]+)\/reset$/);
    if (resetMatch && req.method === "POST") {
      return json(res, 200, { reset: true });
    }

    if (url.pathname === "/computers" && req.method === "GET") {
      return json(res, 200, {
        computers: [...state.ensured].map((botId) => ({
          botId,
          status: "running",
          url: computerUrl,
          port: computerPort,
        })),
      });
    }

    return json(res, 404, { error: "not found" });
  });
  const supervisorPort = await listen(supervisor);
  const supervisorUrl = `http://127.0.0.1:${supervisorPort}`;

  try {
    // 1) Direct supervisor client
    const ensured = await openBotEnsureComputer(
      { baseUrl: supervisorUrl, token: state.supervisorToken },
      "seat_abc",
    );
    ok("ensure returns botId", ensured.botId === "seat_abc");
    ok("ensure returns computer url", ensured.url === computerUrl);

    // 2) Direct agent-computer client
    const agentCfg = {
      baseUrl: computerUrl,
      computerToken: state.computerToken,
      botId: "seat_abc",
    };
    const nav = await openBotNavigate(agentCfg, "https://www.linkedin.com/in/jane-doe");
    ok("navigate ok", nav.url.includes("linkedin.com/in/jane-doe"));
    const snap = await openBotSnapshot(agentCfg);
    ok("snapshot has Message button", snap.elements.some((e) => e.name === "Message"));
    ok("snapshotId > 0", snap.snapshotId > 0);
    const msg = snap.elements.find((e) => e.name === "Message")!;
    await openBotClick(agentCfg, msg.ref, snap.snapshotId);
    const snap2 = await openBotSnapshot(agentCfg);
    const box = snap2.elements.find((e) => e.role === "textbox")!;
    await openBotType(agentCfg, box.ref, snap2.snapshotId, "Hello Jane", false);
    const snap3 = await openBotSnapshot(agentCfg);
    const send = snap3.elements.find((e) => e.name === "Send")!;
    await openBotClick(agentCfg, send.ref, snap3.snapshotId);
    ok("typed outreach body", state.typed.includes("Hello Jane"));
    ok("clicked Send", state.clicks.includes("e11"));

    // 3) LinkedIn send helper (happy path)
    state.stage = "profile";
    state.typed = [];
    state.clicks = [];
    const sendResult = await openBotLinkedInSend(agentCfg, {
      profileUrl: "https://www.linkedin.com/in/jane-doe",
      messageBody: "Saw your work on distributed systems — would love to chat.",
      subject: "Quick note",
    });
    ok("linkedin send ok", sendResult.ok === true, sendResult.detail);
    ok(
      "linkedin send typed subject+body",
      state.typed.some((t) => t.includes("Quick note") && t.includes("distributed systems")),
    );

    // 4) Login wall → helpRequested
    state.stage = "login";
    const loginResult = await openBotLinkedInSend(agentCfg, {
      profileUrl: "https://www.linkedin.com/login",
      messageBody: "hi",
    });
    ok("login wall fails closed", loginResult.ok === false);
    ok("login wall asks for help", loginResult.helpRequested === true);

    // 5) ComputerSupervisor remote E2E (ensure + linkedin_send)
    state.stage = "profile";
    state.typed = [];
    state.clicks = [];
    state.navigations = [];
    bindComputerSupervisorEndpoint({
      url: supervisorUrl,
      token: state.supervisorToken,
      computerToken: state.computerToken,
      mockSend: false,
    });
    const supervisorSvc = new ComputerSupervisor();
    const computerRec = supervisorSvc.ensureComputer({
      workspaceId: "ws1",
      seatId: "seat-e2e-1",
    });
    const started = await supervisorSvc.start(computerRec.computerId);
    ok("supervisor start → ready", started.status === "ready", started.lastError ?? "");
    ok("supervisor stored remoteUrl", Boolean(started.remoteUrl), String(started.remoteUrl));
    ok("supervisor ensure called openbot", state.ensured.size >= 1);

    const job = await supervisorSvc.enqueueJob({
      computerId: computerRec.computerId,
      kind: "linkedin_send",
      payload: {
        profileUrl: "https://www.linkedin.com/in/jane-doe",
        body: "E2E automatic send through OpenBot.",
      },
    });
    ok("remote linkedin_send succeeded", job.status === "succeeded", job.detail);
    ok(
      "remote path navigated to profile",
      state.navigations.some((u) => u.includes("/in/jane-doe")),
    );
    ok("remote path typed message", state.typed.some((t) => t.includes("E2E automatic send")));
    ok("remote path clicked send", state.clicks.includes("e11"));

    // Human mutex still refuses
    supervisorSvc.takeControl(computerRec.computerId);
    const refused = await supervisorSvc.enqueueJob({
      computerId: computerRec.computerId,
      kind: "linkedin_send",
      payload: { profileUrl: "https://www.linkedin.com/in/x", body: "nope" },
    });
    ok("human mutex refuses remote job", refused.status === "refused");
    supervisorSvc.releaseControl(computerRec.computerId);

    // warmup_nav
    const warmup = await supervisorSvc.enqueueJob({
      computerId: computerRec.computerId,
      kind: "warmup_nav",
      payload: { url: "https://www.linkedin.com/feed/" },
    });
    ok("warmup_nav succeeded", warmup.status === "succeeded", warmup.detail);

    await openBotStopComputer(
      { baseUrl: supervisorUrl, token: state.supervisorToken },
      computerRec.botId || computerRec.computerId,
    );

    // 6) Aria LLM proxy (auth + completions via stubbed OpenAI)
    process.env.OPENBOT_LLM_PROXY_TOKEN = "proxy-secret";
    process.env.OPENAI_API_KEY = "sk-test-aria";
    process.env.OPENBOT_LLM_PROVIDER = "openai";

    const unauthorized = await chatRoute.POST(
      new NextRequest("http://localhost/api/openbot/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );
    ok("llm proxy rejects bad token", unauthorized.status === 401);

    const completion = await chatRoute.POST(
      new NextRequest("http://localhost/api/openbot/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer proxy-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are Aria." },
            { role: "user", content: "Say hi" },
          ],
        }),
      }),
    );
    const completionJson = (await completion.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    ok("llm proxy returns 200", completion.status === 200, completionJson.error?.message ?? "");
    ok(
      "llm proxy returns assistant text",
      Boolean(completionJson.choices?.[0]?.message?.content),
      JSON.stringify(completionJson).slice(0, 200),
    );

    const models = await modelsRoute.GET(
      new NextRequest("http://localhost/api/openbot/v1/models", {
        headers: { authorization: "Bearer proxy-secret" },
      }),
    );
    const modelsJson = (await models.json()) as { data?: Array<{ id?: string }> };
    ok("models lists aria model", models.status === 200 && (modelsJson.data?.length ?? 0) > 0);

    // Missing computer token fails closed when remote supervisor is bound
    bindComputerSupervisorEndpoint({
      url: supervisorUrl,
      token: state.supervisorToken,
      computerToken: "",
      mockSend: false,
    });
    // Clear env fallbacks for this check
    const prevComp = process.env.COMPUTER_TOKEN;
    const prevObComp = process.env.OPENBOT_COMPUTER_TOKEN;
    delete process.env.COMPUTER_TOKEN;
    delete process.env.OPENBOT_COMPUTER_TOKEN;
    const noTok = new ComputerSupervisor();
    const c2 = noTok.ensureComputer({ workspaceId: "ws", seatId: "seat-notoken" });
    await noTok.start(c2.computerId);
    // After start, remoteUrl is set but computer token is empty and supervisor
    // token is still present — resolveComputerToken falls back to supervisor token.
    // Force empty by binding token "" AND supervisor token that won't auth computer.
    bindComputerSupervisorEndpoint({
      url: supervisorUrl,
      token: state.supervisorToken,
      computerToken: "wrong-computer-token",
      mockSend: false,
    });
    const badTokJob = await noTok.enqueueJob({
      computerId: c2.computerId,
      kind: "linkedin_send",
      payload: { profileUrl: "https://www.linkedin.com/in/x", body: "x" },
    });
    ok(
      "wrong computer token fails closed",
      badTokJob.status === "failed",
      badTokJob.detail,
    );
    if (prevComp !== undefined) process.env.COMPUTER_TOKEN = prevComp;
    if (prevObComp !== undefined) process.env.OPENBOT_COMPUTER_TOKEN = prevObComp;
  } finally {
    bindComputerSupervisorEndpoint(null);
    globalThis.fetch = realFetch;
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    if (prevOpenAiBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = prevOpenAiBase;
    delete process.env.OPENBOT_LLM_PROXY_TOKEN;
    delete process.env.OPENBOT_LLM_PROVIDER;
    await close(supervisor);
    await close(computer);
    await close(openaiUpstream);
  }

  console.log(`RESULT openbot-e2e: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
