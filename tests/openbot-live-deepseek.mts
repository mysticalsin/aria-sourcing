/**
 * LIVE E2E with a real DeepSeek key as Aria's PROVIDER_ENV key.
 * OpenBot presents the same key to /api/openbot/v1; Aria spends it upstream.
 * LinkedIn Browser Computer path uses mock OpenBot + real DeepSeek for LLM assist.
 *
 * Reads /tmp/aria-e2e/deepseek.key — never prints the secret.
 * Run: npx tsx tests/openbot-live-deepseek.mts
 */

import http from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const KEY_PATH = "/tmp/aria-e2e/deepseek.key";
if (!existsSync(KEY_PATH)) {
  console.log("SKIP openbot-live-deepseek: missing /tmp/aria-e2e/deepseek.key");
  process.exit(0);
}
const KEY = readFileSync(KEY_PATH, "utf8").trim();
if (KEY.length < 20) {
  console.log("SKIP openbot-live-deepseek: key too short");
  process.exit(0);
}

// BEFORE importing provider/routes (CLOUD_ENDPOINT is module-load).
process.env.DEEPSEEK_API_KEY = KEY;
process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
process.env.OPENBOT_LLM_PROVIDER = "deepseek";
process.env.OPENBOT_LLM_MODEL = "deepseek-chat";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.KIMI_API_KEY;
delete process.env.OPENBOT_LLM_PROXY_TOKEN;
delete process.env.ARIA_OPENBOT_LLM_TOKEN;
delete process.env.OPENBOT_LLM_PICK;

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

  ok("provider resolves deepseek", resolveAriaLlmProvider()?.slug === "deepseek");
  ok(
    "CLOUD_ENDPOINT.deepseek points at api.deepseek.com",
    CLOUD_ENDPOINT.deepseek.includes("api.deepseek.com"),
  );

  const auth = authorizeOpenBotLlm(`Bearer ${KEY}`);
  ok("OpenBot Bearer = Aria DEEPSEEK_API_KEY accepted", auth.ok && auth.auth === "aria_api_key");
  ok("matched key identical to Aria key", auth.ok && auth.provider.key === KEY);

  const denied = await chatRoute.POST(
    new NextRequest("http://localhost/api/openbot/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "nope" }],
      }),
    }),
  );
  ok("proxy rejects foreign key", denied.status === 401);

  const completion = await chatRoute.POST(
    new NextRequest("http://localhost/api/openbot/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 48,
        messages: [
          { role: "system", content: "You are Aria OpenBot proxy." },
          { role: "user", content: "Reply with exactly: OPENBOT_DEEPSEEK_OK" },
        ],
      }),
    }),
  );
  const completionJson = (await completion.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  const text = completionJson.choices?.[0]?.message?.content ?? "";
  ok(
    "live proxy completions 200 via DeepSeek",
    completion.status === 200,
    completionJson.error?.message ?? `status=${completion.status}`,
  );
  ok(
    "live proxy returns DeepSeek text",
    text.length > 0,
    text.slice(0, 80),
  );
  ok(
    "reply mentions OPENBOT_DEEPSEEK_OK (or close)",
    /OPENBOT_DEEPSEEK_OK|DEEPSEEK_OK|OPENBOT/i.test(text),
    text.slice(0, 120),
  );

  const models = await modelsRoute.GET(
    new NextRequest("http://localhost/api/openbot/v1/models", {
      headers: { authorization: `Bearer ${KEY}` },
    }),
  );
  const modelsJson = (await models.json()) as {
    data?: Array<{ id?: string; owned_by?: string }>;
  };
  ok("models authorized with DeepSeek key", models.status === 200);
  ok("owned_by aria:deepseek", modelsJson.data?.[0]?.owned_by === "aria:deepseek");
  ok(
    "model id is deepseek-chat",
    modelsJson.data?.[0]?.id === "deepseek-chat",
    modelsJson.data?.[0]?.id ?? "",
  );

  // Real DeepSeek picks a LinkedIn element
  const picked = await pickOpenBotElementWithAriaLlm(
    [
      { ref: "e9", role: "button", name: "Connect", disabled: false },
      { ref: "e1", role: "button", name: "Send a note to Ada", disabled: false },
      { ref: "e2", role: "button", name: "More", disabled: false },
    ],
    "Click the control that opens a LinkedIn direct message composer on this profile.",
  );
  ok(
    "live DeepSeek element pick returns a ref",
    Boolean(picked?.ref),
    picked?.ref ?? "none",
  );
  ok(
    "live DeepSeek prefers message-ish control e1",
    picked?.ref === "e1",
    picked?.ref ?? "none",
  );

  // LinkedIn OpenBot computer (mock) + live DeepSeek LLM assist
  let stage: "profile" | "composer" | "sent" = "profile";
  let snapshotId = 0;
  const typed: string[] = [];
  const clicks: string[] = [];
  const computerToken = "ds-e2e-comp";
  const supervisorToken = "ds-e2e-sup";

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
      if (body.ref === "e1" || body.ref === "e9" || body.ref === "e2") stage = "composer";
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
      { baseUrl: computerUrl, computerToken, botId: "bot-ada-ds" },
      {
        profileUrl: "https://www.linkedin.com/in/ada",
        messageBody: "E2E LinkedIn via OpenBot + Aria DeepSeek key.",
      },
    );
    ok("LinkedIn send ok with live DeepSeek LLM assist", send.ok, send.detail);
    ok("clicked a profile control", clicks.length >= 1, clicks.join(","));
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
    const rec = svc.ensureComputer({
      workspaceId: "ws",
      seatId: "seat-ds",
      computerId: "comp_deepseek_e2e",
    });
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
        body: "Supervisor path same Aria DeepSeek key.",
      },
    });
    ok("ComputerSupervisor linkedin_send succeeded", job.status === "succeeded", job.detail);
    ok("supervisor path typed body", typed.some((t) => t.includes("Supervisor path same Aria")));
    ok("stable computerId preserved", rec.computerId === "comp_deepseek_e2e");
  } finally {
    bindComputerSupervisorEndpoint(null);
    await close(computer);
    await close(supervisor);
  }

  console.log(`RESULT openbot-live-deepseek: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
