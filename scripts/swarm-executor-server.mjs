// swarm-executor-server.mjs — reference swarm executor (PLAN.md Rock 8).
//
// The pluggable half of the swarm execution contract: the orchestrator worker
// POSTs {contract:"swarm-checkpoint-v1", envelope, required_reply} and this
// server answers with ONE six-field checkpoint JSON object. Any OpenAI-
// compatible chat-completions endpoint can be the brain (Kimi/Moonshot,
// OpenAI, a local server) — configured entirely by env.
//
// Authority boundaries (the DB enforces them; this server also respects them):
//   - it can only produce TEXT: results, drafts, plans, review verdicts.
//   - it sends nothing, writes nothing, and holds no Supabase credential.
//   - a reply is only accepted by record_swarm_checkpoint under the live job
//     lease held by the worker — this server cannot self-report progress.
//
// Env:
//   SWARM_EXECUTOR_PORT   (default 8787)
//   SWARM_EXECUTOR_TOKEN  bearer the worker must present (>=32 chars)
//   SWARM_LLM_BASE_URL    OpenAI-compatible base, e.g. https://api.moonshot.ai/v1
//   SWARM_LLM_API_KEY     key for that endpoint
//   SWARM_LLM_MODEL       optional; auto-picked from GET /models when unset
//
// Conventions follow scripts/sourcing-loop-worker.mjs: pure exported
// functions, bounded reads, JSON-line logging, exit code 78 on invalid
// configuration.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const REQUEST_BYTES_MAX = 256_000;
const LLM_TIMEOUT_MS = 90_000;
const CHECKPOINT_STATES = Object.freeze([
  "in_progress", "done", "blocked", "needs_input", "handoff", "needs_review",
]);

function validServiceToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && !/\s/.test(value);
}

export function loadExecutorConfiguration(environment) {
  const port = Number(environment.SWARM_EXECUTOR_PORT ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("invalid SWARM_EXECUTOR_PORT");
  }
  const token = environment.SWARM_EXECUTOR_TOKEN ?? "";
  if (!validServiceToken(token)) {
    throw new Error("invalid SWARM_EXECUTOR_TOKEN");
  }
  let baseUrl;
  try {
    baseUrl = new URL(environment.SWARM_LLM_BASE_URL ?? "");
  } catch {
    throw new Error("invalid SWARM_LLM_BASE_URL");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("invalid SWARM_LLM_BASE_URL");
  }
  const apiKey = environment.SWARM_LLM_API_KEY ?? "";
  if (typeof apiKey !== "string" || apiKey.length < 8 || /\s/.test(apiKey)) {
    throw new Error("invalid SWARM_LLM_API_KEY");
  }
  const model = environment.SWARM_LLM_MODEL ?? "";
  return { port, token, baseUrl, apiKey, model: model === "" ? null : model };
}

function joinBase(baseUrl, suffix) {
  const base = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
  return new URL(suffix.replace(/^\//, ""), base);
}

export async function resolveModel(configuration, fetcher = fetch) {
  if (configuration.model) return configuration.model;
  const response = await fetcher(joinBase(configuration.baseUrl, "models"), {
    headers: { authorization: `Bearer ${configuration.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`model list http_${response.status}`);
  const body = await response.json();
  const first = Array.isArray(body?.data) ? body.data[0]?.id : null;
  if (typeof first !== "string" || first.length === 0) {
    throw new Error("no models available");
  }
  return first;
}

export function buildExecutorMessages(envelope) {
  const agent = envelope.agent ?? {};
  const mission = envelope.mission ?? {};
  const continuation = envelope.continuation ?? {};
  const isReview = envelope.kind === "review";
  const system = [
    `You are ${agent.name ?? "a swarm agent"} (${agent.slug ?? "agent"}) — ${agent.role ?? "specialist"} in the ARIA sourcing swarm.`,
    agent.specialty ? `Specialty: ${agent.specialty}.` : "",
    agent.mission ? `Standing mission: ${agent.mission}` : "",
    "",
    "Hard rules:",
    "- You NEVER send messages to candidates or any external party. Outreach work always terminates at a DRAFT; a human approves and sends through a separate gate.",
    "- Evidence over adjectives: state concrete findings, name exact blockers.",
    "- Reply with ONE minified JSON object and NOTHING else. Shape:",
    '{"state":"in_progress|done|blocked|needs_input|handoff|needs_review","files_changed":[],"commands_run":[],"result":"...","blocker":null,"next_action":null,"proof":{}}',
    isReview
      ? 'This is a REVIEW task: verify the claimed work critically against its checkpoint and its dependencies (both provided verbatim below); do not produce new work. You MUST conclude with state=done and proof.verdict = "approved" or "changes_requested" (plus a one-line proof.justification). A changes_requested verdict with state=done is how rework reaches the author — never use blocked or needs_input unless the artifact itself is absent from your envelope.'
      : 'Put your actual deliverable (research summary, plan, draft text, source list) in "result". Use "proof" for structured evidence (queries used, counts, criteria).',
    "If you finish the task, state=done. If you genuinely need operator input, state=needs_input with the question in blocker.",
  ].filter(Boolean).join("\n");
  const user = [
    `Mission: ${mission.title ?? ""} — ${mission.goal ?? ""}`,
    Array.isArray(mission.constraints) && mission.constraints.length > 0
      ? `Constraints: ${JSON.stringify(mission.constraints)}` : "",
    Array.isArray(mission.proof_contract) && mission.proof_contract.length > 0
      ? `Proof contract: ${JSON.stringify(mission.proof_contract)}` : "",
    "",
    `Your assigned task: ${envelope.task ?? ""}`,
    isReview && envelope.reviewed
      ? `Work under review — original task: ${envelope.reviewed.task ?? ""}\nClaimed checkpoint (verbatim): ${JSON.stringify(envelope.reviewed.checkpoint ?? null)}\nUpstream dependencies of the reviewed work (verbatim): ${JSON.stringify(envelope.reviewed.dependencies ?? [])}`
      : "",
    !isReview && Array.isArray(envelope.dependencies) && envelope.dependencies.length > 0
      ? `Upstream results you depend on (verbatim): ${JSON.stringify(envelope.dependencies)}`
      : "",
    envelope.rationale ? `Why you: ${envelope.rationale}` : "",
    envelope.expected_output ? `Expected output: ${envelope.expected_output}` : "",
    continuation.last_next_action ? `You previously said next: ${continuation.last_next_action}` : "",
    Array.isArray(continuation.operator_answers) && continuation.operator_answers.length > 0
      ? `Operator answers: ${JSON.stringify(continuation.operator_answers)}` : "",
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function parseCheckpointReply(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, reason: "empty_reply" };
  }
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, reason: "no_json_object" };
  let parsed;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "json_invalid" };
  }
  if (!CHECKPOINT_STATES.includes(parsed.state)) {
    return { ok: false, reason: "invalid_state" };
  }
  const asStringArray = (value) => Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, 50).map((item) => item.slice(0, 400))
    : [];
  const asBounded = (value, maximum) =>
    typeof value === "string" && value.length > 0 ? value.slice(0, maximum) : null;
  const proof = typeof parsed.proof === "object" && parsed.proof !== null && !Array.isArray(parsed.proof)
    ? parsed.proof : {};
  if (JSON.stringify(proof).length > 4_000) return { ok: false, reason: "proof_too_large" };
  return {
    ok: true,
    checkpoint: {
      state: parsed.state,
      files_changed: asStringArray(parsed.files_changed),
      commands_run: asStringArray(parsed.commands_run),
      result: asBounded(parsed.result, 8_000),
      blocker: asBounded(parsed.blocker, 2_000),
      next_action: asBounded(parsed.next_action, 2_000),
      proof,
    },
  };
}

export async function executeEnvelope(configuration, model, envelope, fetcher = fetch) {
  const response = await fetcher(joinBase(configuration.baseUrl, "chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildExecutorMessages(envelope),
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    return { ok: false, reason: `llm_http_${response.status}`, detail };
  }
  const body = await response.json().catch(() => null);
  const content = body?.choices?.[0]?.message?.content;
  return parseCheckpointReply(content);
}

function readBoundedBody(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > maximumBytes) {
        reject(new Error("payload_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export function createExecutorServer(configuration, model, fetcher = fetch, logger = () => undefined) {
  return createServer(async (request, response) => {
    const respond = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
    const auth = request.headers.authorization ?? "";
    if (auth !== `Bearer ${configuration.token}`) return respond(401, { error: "unauthorized" });
    let payload;
    try {
      payload = JSON.parse(await readBoundedBody(request, REQUEST_BYTES_MAX));
    } catch {
      return respond(400, { error: "body_invalid" });
    }
    if (payload?.contract !== "swarm-checkpoint-v1" || typeof payload.envelope !== "object" || payload.envelope === null) {
      return respond(400, { error: "contract_invalid" });
    }
    const started = Date.now();
    let executed;
    try {
      executed = await executeEnvelope(configuration, model, payload.envelope, fetcher);
    } catch (cause) {
      executed = { ok: false, reason: cause instanceof Error && cause.name === "TimeoutError" ? "llm_timeout" : "llm_unreachable" };
    }
    logger({
      event: "swarm_executor_request",
      assignmentId: payload.envelope.assignment_id ?? null,
      kind: payload.envelope.kind ?? null,
      ok: executed.ok,
      reason: executed.ok ? undefined : executed.reason,
      durationMs: Date.now() - started,
    });
    if (!executed.ok) return respond(502, { error: executed.reason });
    return respond(200, executed.checkpoint);
  });
}

async function main() {
  let configuration;
  try {
    configuration = loadExecutorConfiguration(process.env);
  } catch (cause) {
    console.error(JSON.stringify({
      event: "swarm_executor_configuration",
      status: "failed",
      code: cause instanceof Error ? cause.message : "configuration_invalid",
    }));
    process.exitCode = 78;
    return;
  }
  let model;
  try {
    model = await resolveModel(configuration);
  } catch (cause) {
    console.error(JSON.stringify({
      event: "swarm_executor_model",
      status: "failed",
      code: cause instanceof Error ? cause.message : "model_unavailable",
    }));
    process.exitCode = 78;
    return;
  }
  const server = createExecutorServer(configuration, model, fetch, (event) => {
    (event.ok ? console.log : console.error)(JSON.stringify(event));
  });
  server.listen(configuration.port, () => {
    console.log(JSON.stringify({ event: "swarm_executor_listening", port: configuration.port, model }));
  });
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    process.on(signalName, () => server.close(() => process.exit(0)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
