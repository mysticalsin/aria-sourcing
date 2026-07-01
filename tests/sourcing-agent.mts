import { buildSeedState } from "../src/lib/seed";
import { makeSourcingToolRunner, isSourcingTool, SOURCING_TOOL_DEFS } from "../src/lib/ai/sourcing-tools";
import { runAnthropicWithTools, runOpenAiWithTools, type ResolvedMcpServer } from "../src/lib/ai/tool-loop";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const s = buildSeedState();
const campaign = s.campaigns[0];
const W = campaign.scoringWeights;

// --- sourcing-tools: tool defs + classifier ---------------------------------
ok("SOURCING_TOOL_DEFS exposes search_candidates", SOURCING_TOOL_DEFS.some((t) => t.name === "search_candidates"));
ok("isSourcingTool recognizes search_candidates", isSourcingTool("search_candidates"));
ok("isSourcingTool rejects an unrelated name", !isSourcingTool("web_search"));

// --- makeSourcingToolRunner: GitHub branch, mocked fetch --------------------
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      items: [{ login: "alice" }],
      login: "alice",
      name: "Alice Dev",
      email: "alice@corp.io",
      company: "zzz-unique-co",
      location: "London",
      bio: "TypeScript engineer",
      html_url: "https://github.com/alice",
      public_repos: 10,
      followers: 50,
      created_at: "2018-01-01T00:00:00Z",
    }),
  })) as typeof fetch;

  const runner = makeSourcingToolRunner(campaign, [], W, "");
  const result = await runner.run("search_candidates", { platform: "GitHub", query: "language:TypeScript", count: 3 });
  globalThis.fetch = originalFetch;

  ok("GitHub search_candidates call succeeds", result.ok === true);
  const content = result.content as { found?: { name: string; matchScore: number }[] } | undefined;
  ok("returns a found candidate", (content?.found?.length ?? 0) === 1);
  ok("candidate has a real score attached", typeof content?.found?.[0]?.matchScore === "number");
  ok("accumulates into getFound()", runner.getFound().length === 1);
  ok("getFound() candidate has the real github url", runner.getFound()[0]?.githubUrl === "https://github.com/alice");
}

// --- makeSourcingToolRunner: dedupe across repeated calls -------------------
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      items: [{ login: "bob" }],
      login: "bob",
      name: null,
      email: null,
      company: null,
      location: null,
      bio: null,
      html_url: "https://github.com/bob",
      public_repos: 1,
      followers: 1,
      created_at: null,
    }),
  })) as typeof fetch;

  const runner = makeSourcingToolRunner(campaign, [], W, "");
  await runner.run("search_candidates", { platform: "GitHub", query: "q", count: 1 });
  await runner.run("search_candidates", { platform: "GitHub", query: "q again", count: 1 });
  globalThis.fetch = originalFetch;

  ok("same real person found twice across calls is deduped, not double-counted", runner.getFound().length === 1);
}

// --- makeSourcingToolRunner: unsupported / invalid inputs -------------------
{
  const runner = makeSourcingToolRunner(campaign, [], W, "");
  const noQuery = await runner.run("search_candidates", { platform: "GitHub" });
  ok("missing query is rejected", noQuery.ok === false);

  const unknown = await runner.run("some_other_tool", {});
  ok("unknown tool name is rejected", unknown.ok === false);

  const talentPool = await runner.run("search_candidates", { platform: "Talent Pool", query: "x" });
  ok("Talent Pool has no external search — rejected with a clear reason", talentPool.ok === false && !!talentPool.error);
}

// --- tool-loop: run() override is used instead of URL-based dispatch -------
{
  let sawOverrideCall = false;
  const server: ResolvedMcpServer = {
    url: "builtin:test-stateful",
    token: "",
    tools: [{ name: "probe", description: "test", inputSchema: { type: "object", properties: {} } }],
    run: async (name, args) => {
      sawOverrideCall = true;
      return { ok: true, content: { echoed: name, args } };
    },
  };

  const originalFetch = globalThis.fetch;
  let round = 0;
  globalThis.fetch = (async () => {
    round += 1;
    if (round === 1) {
      return {
        ok: true,
        json: async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "probe", input: { foo: "bar" } }],
        }),
      };
    }
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }) };
  }) as typeof fetch;

  const result = await runAnthropicWithTools({
    model: "claude-x",
    system: "sys",
    prompt: "go",
    key: "k",
    servers: [server],
  });
  globalThis.fetch = originalFetch;

  ok("run() override was used (not the URL-based MCP dispatch)", sawOverrideCall);
  ok("loop completes with final text", result.ok === true && result.text === "done");
  ok("toolCalls records the call the model made", result.toolCalls.length === 1 && result.toolCalls[0]?.name === "probe");
  ok(
    "toolCalls records the REAL tool output, not just what the model said",
    JSON.stringify(result.toolCalls[0]?.output.content) === JSON.stringify({ echoed: "probe", args: { foo: "bar" } }),
  );
}

// --- tool-loop: OpenAI-compatible variant also records toolCalls -----------
{
  const server: ResolvedMcpServer = {
    url: "builtin:test-stateful",
    token: "",
    tools: [{ name: "probe", description: "test", inputSchema: { type: "object", properties: {} } }],
    run: async () => ({ ok: true, content: { hit: true } }),
  };
  const originalFetch = globalThis.fetch;
  let round = 0;
  globalThis.fetch = (async () => {
    round += 1;
    if (round === 1) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "c1", type: "function", function: { name: "probe", arguments: "{}" } }],
              },
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "final" } }] }),
    };
  }) as typeof fetch;

  const result = await runOpenAiWithTools({
    provider: "groq",
    model: "m",
    system: "sys",
    prompt: "go",
    key: "k",
    servers: [server],
  });
  globalThis.fetch = originalFetch;

  ok("openai-compatible loop completes", result.ok === true && result.text === "final");
  ok("openai-compatible toolCalls records the call", result.toolCalls.length === 1 && result.toolCalls[0]?.name === "probe");
}

console.log(`RESULT sourcing-agent: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
