import { z } from "zod";
import { listDustAgents, runDustAgent } from "../src/lib/dust/client";
import { DUST_TASKS } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(status: number, body: unknown, url = "https://dust.tt/api/v1/w/ws_1/x"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

/** Minimal-but-schema-valid Dust agent configuration (every required field the
 *  SDK's zod schema demands — verified against the installed @dust-tt/client's
 *  actual runtime schema, not guessed from the .d.ts). */
function mkAgentConfig(over: { sId: string; name: string; description: string }) {
  return {
    id: 1,
    versionCreatedAt: null,
    sId: over.sId,
    version: 1,
    versionAuthorId: null,
    instructions: null,
    model: { providerId: "anthropic", modelId: "claude-3-5-sonnet-20241022", temperature: 0.7 },
    status: "active",
    scope: "workspace",
    userFavorite: false,
    name: over.name,
    description: over.description,
    pictureUrl: "https://dust.tt/static/agent.png",
    maxStepsPerRun: 10,
    templateId: null,
  };
}

function mkConversation(over: { sId: string; content?: unknown[] }) {
  return {
    id: 1,
    created: Date.now(),
    unread: false,
    actionRequired: false,
    owner: {
      id: 1,
      sId: "ws_1",
      name: "Acme",
      role: "admin",
      segmentation: null,
      whiteListedProviders: null,
      defaultEmbeddingProvider: null,
    },
    sId: over.sId,
    title: null,
    visibility: "unlisted",
    content: over.content ?? [],
    url: `https://dust.tt/w/ws_1/assistant/${over.sId}`,
  };
}

function mkAgentMessage(over: {
  sId: string;
  status: "created" | "succeeded" | "failed" | "cancelled";
  content?: string | null;
  error?: { code: string; message: string; metadata?: Record<string, unknown> | null } | null;
}) {
  return {
    id: 1,
    agentMessageId: 1,
    created: Date.now(),
    type: "agent_message",
    sId: over.sId,
    visibility: "visible",
    version: 0,
    parentMessageId: null,
    parentAgentMessageId: null,
    configuration: mkAgentConfig({ sId: "agent_1", name: "Agent", description: "d" }),
    status: over.status,
    actions: [],
    content: over.content ?? null,
    chainOfThought: null,
    rawContents: [],
    error: over.error ? { metadata: null, ...over.error } : null,
  };
}

const apiErrorBody = (type: string, message: string) => ({ error: { type, message } });

/* ---- listDustAgents: success ------------------------------------------- */
async function testListSuccess() {
  const seen: { url: string; auth: string | undefined }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return jsonResponse(200, {
      agentConfigurations: [
        mkAgentConfig({ sId: "agent_jd", name: "JD Analyst", description: "Analyzes job descriptions" }),
        mkAgentConfig({ sId: "agent_research", name: "Company Researcher", description: "Researches companies" }),
      ],
    });
  }) as typeof fetch;

  const agents = await listDustAgents("ws_1", "sk-dust-test-key");
  restoreFetch();

  ok("listDustAgents: returns both agents", agents.length === 2);
  ok("listDustAgents: maps sId/name/description", agents[0]?.sId === "agent_jd" && agents[0]?.name === "JD Analyst");
  ok("listDustAgents: hits the documented endpoint", seen[0]?.url.includes("/api/v1/w/ws_1/assistant/agent_configurations"));
  ok("listDustAgents: view=all + withAuthors=true", (seen[0]?.url ?? "").includes("view=all") && (seen[0]?.url ?? "").includes("withAuthors=true"));
  ok("listDustAgents: sends Bearer auth with the given key", seen[0]?.auth === "Bearer sk-dust-test-key");
}

/* ---- listDustAgents: region routes to the correct regional host --------- */
async function testListRegion() {
  const seen: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    seen.push(String(url));
    return jsonResponse(200, { agentConfigurations: [] });
  }) as typeof fetch;

  await listDustAgents("ws_1", "sk-dust-test-key"); // no region -> default
  await listDustAgents("ws_1", "sk-dust-test-key", "us");
  await listDustAgents("ws_1", "sk-dust-test-key", "eu");
  restoreFetch();

  ok("listDustAgents: no region arg defaults to the US host", (seen[0] ?? "").startsWith("https://dust.tt/"));
  ok("listDustAgents: region 'us' hits the US host", (seen[1] ?? "").startsWith("https://dust.tt/"));
  ok("listDustAgents: region 'eu' hits the EU host, not dust.tt", (seen[2] ?? "").startsWith("https://eu.dust.tt/"));
}

/* ---- listDustAgents: 401 -> throws (route turns this into {ok:false}) --- */
async function testListUnauthorized() {
  globalThis.fetch = (async () => jsonResponse(401, apiErrorBody("invalid_api_key_error", "The API key is invalid."))) as typeof fetch;

  let threw = false;
  let message = "";
  try {
    await listDustAgents("ws_1", "bad-key");
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  restoreFetch();

  ok("listDustAgents: 401 throws", threw);
  ok("listDustAgents: 401 surfaces the Dust error message", message === "The API key is invalid.");
}

/* ---- runDustAgent: success (create + poll to succeeded) ---------------- */
async function testRunSuccess() {
  let getCalls = 0;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u.includes("/assistant/conversations") && !u.match(/conversations\/[^/?]+(\?|$)/)) {
      // POST create
      return jsonResponse(200, { conversation: mkConversation({ sId: "conv_1" }) });
    }
    // GET poll
    getCalls++;
    return jsonResponse(200, {
      conversation: mkConversation({
        sId: "conv_1",
        content: [[mkAgentMessage({ sId: "am_1", status: "succeeded", content: "Here is the JD analysis." })]],
      }),
    });
  }) as typeof fetch;

  const result = await runDustAgent("ws_1", "sk-dust-test-key", "agent_jd", "Analyze this JD", 5_000);
  restoreFetch();

  ok("runDustAgent: success returns ok:true", result.ok === true);
  ok("runDustAgent: returns the agent's text", result.ok === true && result.text === "Here is the JD analysis.");
  ok("runDustAgent: polled at least once", getCalls >= 1);
}

/* ---- runDustAgent: 401 on conversation create -> {ok:false}, never throws */
async function testRunUnauthorized() {
  globalThis.fetch = (async () => jsonResponse(401, apiErrorBody("invalid_api_key_error", "The API key is invalid."))) as typeof fetch;

  let threw = false;
  const result = await runDustAgent("ws_1", "bad-key", "agent_jd", "hello").catch(() => {
    threw = true;
    return { ok: false as const, error: "threw" };
  });
  restoreFetch();

  ok("runDustAgent: 401 never throws", !threw);
  ok("runDustAgent: 401 returns ok:false", result.ok === false);
  ok("runDustAgent: 401 surfaces the Dust error message", !result.ok && result.error === "The API key is invalid.");
}

/* ---- runDustAgent: agent never finishes -> times out, never throws ----- */
async function testRunTimeout() {
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u.includes("/assistant/conversations") && !u.match(/conversations\/[^/?]+(\?|$)/)) {
      return jsonResponse(200, { conversation: mkConversation({ sId: "conv_2" }) });
    }
    // Always still running — never settles within the timeout window.
    return jsonResponse(200, {
      conversation: mkConversation({
        sId: "conv_2",
        content: [[mkAgentMessage({ sId: "am_2", status: "created" })]],
      }),
    });
  }) as typeof fetch;

  const start = Date.now();
  const result = await runDustAgent("ws_1", "sk-dust-test-key", "agent_jd", "hello", 300);
  const elapsed = Date.now() - start;
  restoreFetch();

  ok("runDustAgent: timeout returns ok:false", result.ok === false);
  ok("runDustAgent: timeout has a clear message", !result.ok && /timed out/i.test(result.error));
  ok("runDustAgent: timeout is bounded (didn't hang)", elapsed < 5_000);
}

/* ---- runDustAgent: timeoutMs (5th arg) AND region (6th arg) both still land
   in the right slot -- regression test for a real bug where region was first
   inserted BEFORE timeoutMs, silently breaking every existing positional call
   (the 300ms timeout above would have landed in the region slot instead). --- */
async function testRunTimeoutAndRegion() {
  const seen: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    seen.push(String(url));
    return jsonResponse(200, {
      conversation: mkConversation({
        sId: "conv_3",
        content: [[mkAgentMessage({ sId: "am_3", status: "created" })]],
      }),
    });
  }) as typeof fetch;

  const start = Date.now();
  const result = await runDustAgent("ws_1", "sk-dust-test-key", "agent_jd", "hello", 300, "eu");
  const elapsed = Date.now() - start;
  restoreFetch();

  ok("runDustAgent: explicit timeoutMs (5th arg) still bounds the wait", elapsed < 5_000);
  ok("runDustAgent: timed out (proves timeoutMs, not region, was used as the number)", result.ok === false);
  ok("runDustAgent: region (6th arg) routed to the EU host", seen.every((u) => u.startsWith("https://eu.dust.tt/")));
}

/* ---- runDustAgent: agent fails -> ok:false with the Dust error --------- */
async function testRunAgentFailed() {
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u.includes("/assistant/conversations") && !u.match(/conversations\/[^/?]+(\?|$)/)) {
      return jsonResponse(200, { conversation: mkConversation({ sId: "conv_3" }) });
    }
    return jsonResponse(200, {
      conversation: mkConversation({
        sId: "conv_3",
        content: [[mkAgentMessage({ sId: "am_3", status: "failed", error: { code: "x", message: "Model provider error." } })]],
      }),
    });
  }) as typeof fetch;

  const result = await runDustAgent("ws_1", "sk-dust-test-key", "agent_jd", "hello", 5_000);
  restoreFetch();

  ok("runDustAgent: failed agent message returns ok:false", result.ok === false);
  ok("runDustAgent: failed agent message surfaces the Dust error", !result.ok && result.error === "Model provider error.");
}

await testListSuccess();
await testListRegion();
await testListUnauthorized();
await testRunSuccess();
await testRunUnauthorized();
await testRunTimeout();
await testRunTimeoutAndRegion();
await testRunAgentFailed();

/* ---- Pure-function piece shared by the two routes: task validation ----- */
// Mirrors the z.enum(DUST_TASKS) used by POST /api/dust/run — same convention
// as tests/api-validation.mts (reconstructs the route's zod primitive locally).
const TaskSchema = z.enum(DUST_TASKS);
ok("DUST_TASKS: has exactly the two starter tasks", DUST_TASKS.length === 2 && DUST_TASKS.includes("jdAnalysis") && DUST_TASKS.includes("companyResearch"));
ok("task validation: accepts jdAnalysis", TaskSchema.safeParse("jdAnalysis").success);
ok("task validation: accepts companyResearch", TaskSchema.safeParse("companyResearch").success);
ok("task validation: rejects an unknown task", !TaskSchema.safeParse("somethingElse").success);

console.log(`RESULT dust: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
