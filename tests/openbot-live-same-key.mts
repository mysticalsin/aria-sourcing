/**
 * Live-shaped E2E using Aria's real Fly KIMI_API_KEY bytes as the OpenBot Bearer,
 * with a local mock upstream that asserts the SAME key is spent.
 * Also runs LinkedIn Browser Computer send (mock OpenBot) with LLM element assist.
 *
 * Requires /tmp/aria-e2e/kimi.key (+ optional kimi.base). Skips when absent.
 * Never prints the secret.
 *
 * Run: npx tsx tests/openbot-live-same-key.mts
 */

import http from "node:http";
import { AddressInfo } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { NextRequest } from "next/server";

const KEY_PATH = "/tmp/aria-e2e/kimi.key";
if (!existsSync(KEY_PATH)) {
  console.log("SKIP openbot-live-same-key: no /tmp/aria-e2e/kimi.key (Fly capture)");
  process.exit(0);
}
const KEY = readFileSync(KEY_PATH, "utf8").trim();
if (KEY.length < 20) {
  console.log("SKIP openbot-live-same-key: kimi.key too short");
  process.exit(0);
}

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

async function main() {
  let lastUpstreamAuth = "";
  let upstreamHits = 0;

  const kimiUpstream = http.createServer(async (req, res) => {
    lastUpstreamAuth = String(req.headers.authorization ?? "");
    upstreamHits += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}") as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const last = parsed.messages?.at(-1)?.content ?? "";
    const reply =
      last.includes("Goal:") && last.includes("Elements:")
        ? JSON.stringify({ ref: "e1" })
        : "OPENBOT_OK from mock kimi";
    json(res, 200, {
      id: "chatcmpl-kimi-mock",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
    });
  });
  const kimiPort = await listen(kimiUpstream);
  const kimiBase = `http://127.0.0.1:${kimiPort}`;

  // Env BEFORE importing provider/routes (CLOUD_ENDPOINT is module-load).
  process.env.KIMI_API_KEY = KEY;
  process.env.KIMI_BASE_URL = kimiBase;
  process.env.OPENBOT_LLM_PROVIDER = "kimi";
  process.env.OPENBOT_LLM_MODEL = "moonshot-v1-8k";
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENBOT_LLM_PROXY_TOKEN;
  delete process.env.ARIA_OPENBOT_LLM_TOKEN;
  delete process.env.OPENBOT_LLM_PICK; // enable LLM pick

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    // Provider builds `${KIMI_BASE}/chat/completions` — already our mock.
    // Also catch any accidental moonshot/kimi.com hosts.
    if (/api\.kimi\.com|api\.moonshot\.(ai|cn)|127\.0\.0\.1:\d+/.test(url) && url.includes("chat/completions")) {
      return realFetch(`http://127.0.0.1:${kimiPort}/chat/completions`, init);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const { authorizeOpenBotLlm, resolveAriaLlmProvider } = await import(
      "../src/lib/openbot/llm-auth"
    );
    const chatRoute = await import("../src/app/api/openbot/v1/chat/completions/route");
    const modelsRoute = await import("../src/app/api/openbot/v1/models/route");
    const { CLOUD_ENDPOINT } = await import("../src/lib/ai/provider");
    const {
      ComputerSupervisor,
      bindComputerSupervisorEndpoint,
    } = await import("../src/lib/computer-supervisor");
    const { openBotLinkedInSend } = await import("../src/lib/openbot/linkedin-send");
    const { pickOpenBotElementWithAriaLlm } = await import(
      "../src/lib/openbot/llm-pick-element"
    );

    ok("provider resolves kimi (prod shape)", resolveAriaLlmProvider()?.slug === "kimi");
    ok("CLOUD_ENDPOINT.kimi uses mock base", CLOUD_ENDPOINT.kimi.includes(String(kimiPort)));

    const auth = authorizeOpenBotLlm(`Bearer ${KEY}`);
    ok("OpenBot Bearer = Aria Fly KIMI_API_KEY accepted", auth.ok && auth.auth === "aria_api_key");
    ok(
      "matched key is identical to Aria key",
      auth.ok && auth.provider.key === KEY,
    );

    lastUpstreamAuth = "";
    const completion = await chatRoute.POST(
      new NextRequest("http://localhost/api/openbot/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "moonshot-v1-8k",
          messages: [{ role: "user", content: "Say OPENBOT_OK" }],
        }),
      }),
    );
    const completionJson = (await completion.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    ok("chat completions 200", completion.status === 200, completionJson.error?.message ?? "");
    ok(
      "assistant text returned",
      Boolean(completionJson.choices?.[0]?.message?.content?.includes("OPENBOT_OK")),
    );
    ok(
      "upstream Authorization is Aria's same Kimi key",
      lastUpstreamAuth === `Bearer ${KEY}`,
      `auth_len=${lastUpstreamAuth.length}`,
    );

    const models = await modelsRoute.GET(
      new NextRequest("http://localhost/api/openbot/v1/models", {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    const modelsJson = (await models.json()) as { data?: Array<{ owned_by?: string }> };
    ok("models with same key", models.status === 200);
    ok("owned_by aria:kimi", modelsJson.data?.[0]?.owned_by === "aria:kimi");

    // LLM element pick spends same key
    lastUpstreamAuth = "";
    const picked = await pickOpenBotElementWithAriaLlm(
      [
        { ref: "e9", role: "button", name: "Connect", disabled: false },
        { ref: "e1", role: "button", name: "Send a note to Ada", disabled: false },
        { ref: "e2", role: "button", name: "More", disabled: false },
      ],
      "Click the control that opens a LinkedIn direct message composer on this profile.",
    );
    ok("LLM pick returns e1", picked?.ref === "e1", picked?.ref ?? "none");
    ok(
      "LLM pick spent Aria Kimi key",
      lastUpstreamAuth === `Bearer ${KEY}`,
    );

    // LinkedIn OpenBot computer — ambiguous Message control forces LLM assist
    let stage: "profile" | "composer" | "sent" = "profile";
    let snapshotId = 0;
    const typed: string[] = [];
    const clicks: string[] = [];
    const computerToken = "e2e-comp";
    const supervisorToken = "e2e-sup";

    const computer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://computer.local");
      const authHdr = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const headerTok = req.headers["x-openbot-computer-token"];
      const token = (typeof headerTok === "string" ? headerTok : "") || authHdr;
      if (token !== computerToken) return json(res, 401, { error: "unauthorized" });

      if (url.pathname === "/navigate" && req.method === "POST") {
        return json(res, 200, {
          url: "https://www.linkedin.com/in/ada",
          title: "Ada | LinkedIn",
          text: "Ada Lovelace",
        });
      }
      if (url.pathname === "/snapshot" && req.method === "POST") {
        snapshotId += 1;
        if (stage === "profile") {
          return json(res, 200, {
            snapshotId,
            url: "https://www.linkedin.com/in/ada",
            title: "Ada | LinkedIn",
            elements: [
              { ref: "e9", role: "button", name: "Connect", disabled: false },
              // Ambiguous — heuristics miss; LLM must pick e1
              { ref: "e1", role: "button", name: "Send a note to Ada", disabled: false },
              { ref: "e2", role: "button", name: "More", disabled: false },
            ],
          });
        }
        return json(res, 200, {
          snapshotId,
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
        clicks.push(body.ref ?? "");
        if (body.ref === "e1") stage = "composer";
        if (body.ref === "e11") stage = "sent";
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/type" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}") as { text?: string };
        typed.push(body.text ?? "");
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "missing" });
    });
    const computerPort = await listen(computer);
    const computerUrl = `http://127.0.0.1:${computerPort}`;

    const supervisor = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://supervisor.local");
      if ((req.headers.authorization ?? "") !== `Bearer ${supervisorToken}`) {
        return json(res, 401, { error: "Unauthorized." });
      }
      const ensureMatch = url.pathname.match(/^\/computers\/([^/]+)\/ensure$/);
      if (ensureMatch && req.method === "POST") {
        return json(res, 200, {
          botId: decodeURIComponent(ensureMatch[1]),
          status: "running",
          url: computerUrl,
          port: computerPort,
        });
      }
      if (url.pathname.match(/\/stop$/) && req.method === "POST") {
        return json(res, 200, { stopped: true });
      }
      if (url.pathname === "/computers") return json(res, 200, { computers: [] });
      return json(res, 404, { error: "missing" });
    });
    const supervisorPort = await listen(supervisor);
    const supervisorUrl = `http://127.0.0.1:${supervisorPort}`;

    try {
      const send = await openBotLinkedInSend(
        { baseUrl: computerUrl, computerToken, botId: "bot-ada" },
        {
          profileUrl: "https://www.linkedin.com/in/ada",
          messageBody: "E2E LinkedIn via OpenBot + Aria Kimi key.",
        },
      );
      ok("LinkedIn send ok with LLM-assisted Message click", send.ok, send.detail);
      ok("clicked LLM-picked message control", clicks.includes("e1"));
      ok("clicked Send", clicks.includes("e11"));
      ok(
        "typed outreach",
        typed.some((t) => t.includes("E2E LinkedIn via OpenBot")),
      );

      bindComputerSupervisorEndpoint({
        url: supervisorUrl,
        token: supervisorToken,
        computerToken,
        mockSend: false,
      });
      const svc = new ComputerSupervisor();
      const rec = svc.ensureComputer({ workspaceId: "ws", seatId: "seat-kimi" });
      await svc.start(rec.computerId);
      stage = "profile";
      snapshotId = 0;
      typed.length = 0;
      clicks.length = 0;
      const job = await svc.enqueueJob({
        computerId: rec.computerId,
        kind: "linkedin_send",
        payload: {
          profileUrl: "https://www.linkedin.com/in/ada",
          body: "Supervisor LinkedIn send same Aria key.",
        },
      });
      ok("ComputerSupervisor linkedin_send succeeded", job.status === "succeeded", job.detail);
      ok("supervisor path used LLM message click", clicks.includes("e1"));
      ok(
        "supervisor path typed body",
        typed.some((t) => t.includes("Supervisor LinkedIn send")),
      );
      ok("upstream received Aria key at least once", upstreamHits >= 1);
    } finally {
      bindComputerSupervisorEndpoint(null);
      await close(computer);
      await close(supervisor);
    }
  } finally {
    globalThis.fetch = realFetch;
    await close(kimiUpstream);
  }

  console.log(`RESULT openbot-live-same-key: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
