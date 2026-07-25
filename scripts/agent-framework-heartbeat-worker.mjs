import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  deriveAgentFrameworkConfigurationFromEnvironment,
  normalizePrivateInternalUrl,
} from "../src/lib/agents/framework/configuration-core.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST_RE = /^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$/;
const TARGET_KEYS = [
  "workspace_id",
  "instance_id",
  "framework",
  "source_commit",
  "image_digest",
  "isolation_mode",
  "configuration_sha256",
];
const READINESS_DEPENDENCY_KEYS = Object.freeze({
  deerflow: Object.freeze([
    "assistantBinding",
    "modelBinding",
    "modelGateway",
    "policyBundle",
    "runtimeHealth",
  ]),
  flowise: Object.freeze(["database", "policy", "queue", "worker"]),
});
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TARGETS = 100;
const DEFAULT_CONCURRENCY = 20;
const INVENTORY_RESPONSE_BYTES = 512_000;
const RECORD_RESPONSE_BYTES = 16_000;
const ADAPTER_RESPONSE_BYTES = 64_000;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const raw = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(raw) || raw < minimum || raw > maximum) {
    throw new Error(`invalid ${name}`);
  }
  return raw;
}

function validServiceToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && !/\s/.test(value);
}

function privateInternalUrl(value) {
  try {
    return new URL(normalizePrivateInternalUrl(value, "framework adapter URL"));
  } catch {
    return null;
  }
}

function responseMatchesTarget(response, target) {
  if (!response || typeof response !== "object" || typeof response.url !== "string" || !response.url) return false;
  try {
    const actual = new URL(response.url);
    return actual.origin === target.origin && actual.pathname === target.pathname && actual.search === target.search;
  } catch {
    return false;
  }
}

async function readBoundedText(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("response_size_invalid");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("response_size_invalid");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedJson(response, maximumBytes, { allowEmpty = false } = {}) {
  const text = await readBoundedText(response, maximumBytes);
  if (allowEmpty && text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("response_json_invalid");
  }
}

function parseTarget(value) {
  const target = record(value);
  if (!target || !hasExactKeys(target, TARGET_KEYS)) return null;
  if (
    typeof target.workspace_id !== "string" || !UUID_RE.test(target.workspace_id) ||
    typeof target.instance_id !== "string" || !UUID_RE.test(target.instance_id) ||
    !["deerflow", "flowise"].includes(target.framework) ||
    typeof target.source_commit !== "string" || !COMMIT_RE.test(target.source_commit) ||
    typeof target.image_digest !== "string" || !IMAGE_DIGEST_RE.test(target.image_digest) ||
    typeof target.configuration_sha256 !== "string" || !SHA256_RE.test(target.configuration_sha256)
  ) return null;
  if (
    (target.framework === "deerflow" && target.isolation_mode !== "dedicated-worker") ||
    (target.framework === "flowise" && ![
      "instance-per-workspace",
      "licensed-enterprise-workspace",
    ].includes(target.isolation_mode))
  ) return null;
  return target;
}

function parseTargetInventory(value, maximumTargets) {
  const envelope = record(value);
  if (!envelope || !hasExactKeys(envelope, ["status", "targets"]) || envelope.status !== "ok") return null;
  if (!Array.isArray(envelope.targets) || envelope.targets.length > maximumTargets) return null;
  const targets = envelope.targets.map(parseTarget);
  if (targets.some((target) => target === null)) return null;
  const identities = new Set();
  for (const target of targets) {
    const identity = `${target.workspace_id}\u0000${target.instance_id}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
  }
  return targets;
}

function frameworkConfiguration(configuration, framework) {
  return framework === "deerflow" ? configuration.deerflow : configuration.flowise;
}

function identityMatches(target, configuration) {
  const framework = frameworkConfiguration(configuration, target.framework);
  return target.source_commit === framework.sourceCommit &&
    target.image_digest === framework.imageDigest &&
    target.isolation_mode === framework.isolationMode &&
    target.configuration_sha256 === configuration.configurationSha256;
}

function adapterConfigurationIsValid(framework) {
  return privateInternalUrl(framework.url) !== null &&
    validServiceToken(framework.token) &&
    COMMIT_RE.test(framework.sourceCommit) &&
    IMAGE_DIGEST_RE.test(framework.imageDigest) &&
    (framework.framework === "deerflow"
      ? framework.isolationMode === "dedicated-worker"
      : ["instance-per-workspace", "licensed-enterprise-workspace"].includes(framework.isolationMode));
}

function readinessResponse(value, target, framework) {
  const parsed = record(value);
  const expectedKeys = target.framework === "flowise"
    ? ["configurationSha256", "contract", "dependencies", "framework", "frameworkInstanceId", "imageDigest", "isolation", "ok", "readinessSchema", "sourceCommit", "workspaceId"]
    : ["configurationSha256", "contract", "dependencies", "framework", "frameworkInstanceId", "imageDigest", "ok", "readinessSchema", "sourceCommit", "workspaceId"];
  if (!parsed || !hasExactKeys(parsed, expectedKeys)) return { valid: false };
  const dependencies = record(parsed.dependencies);
  const dependencyKeys = READINESS_DEPENDENCY_KEYS[target.framework];
  if (
    !dependencies ||
    !hasExactKeys(dependencies, dependencyKeys) ||
    dependencyKeys.some((key) => typeof dependencies[key] !== "boolean") ||
    typeof parsed.ok !== "boolean" ||
    parsed.readinessSchema !== "aria.agent-framework-adapter-readiness.v2" ||
    parsed.framework !== target.framework ||
    parsed.contract !== framework.contract ||
    parsed.sourceCommit !== target.source_commit ||
    parsed.imageDigest !== target.image_digest ||
    parsed.configurationSha256 !== target.configuration_sha256 ||
    parsed.workspaceId !== target.workspace_id ||
    parsed.frameworkInstanceId !== target.instance_id ||
    (target.framework === "flowise" && parsed.isolation !== target.isolation_mode)
  ) return { valid: false };
  return {
    valid: true,
    ready: parsed.ok === true && dependencyKeys.every((key) => dependencies[key] === true),
    evidence: parsed,
  };
}

function readinessSha256(target, ready, code, evidence) {
  return createHash("sha256").update(JSON.stringify({
    schema: "aria.agent-framework-readiness.v2",
    workspaceId: target.workspace_id,
    instanceId: target.instance_id,
    framework: target.framework,
    sourceCommit: target.source_commit,
    imageDigest: target.image_digest,
    isolationMode: target.isolation_mode,
    configurationSha256: target.configuration_sha256,
    ready,
    code,
    evidence,
  })).digest("hex");
}

async function probeTarget(target, configuration, fetcher) {
  const framework = frameworkConfiguration(configuration, target.framework);
  if (!identityMatches(target, configuration)) {
    return {
      ready: false,
      code: "target_identity_mismatch",
      readinessSha256: readinessSha256(target, false, "target_identity_mismatch", null),
    };
  }
  if (!adapterConfigurationIsValid(framework)) {
    return {
      ready: false,
      code: "adapter_configuration_invalid",
      readinessSha256: readinessSha256(target, false, "adapter_configuration_invalid", null),
    };
  }

  const baseUrl = privateInternalUrl(framework.url);
  const endpoint = new URL("/readyz", baseUrl);
  let response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${framework.token}`,
        "X-Aria-Framework-Contract": framework.contract,
        "X-Aria-Framework-Instance-Id": target.instance_id,
        "X-Aria-Workspace-Id": target.workspace_id,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(configuration.timeoutMs),
    });
  } catch {
    return {
      ready: false,
      code: "adapter_unavailable",
      readinessSha256: readinessSha256(target, false, "adapter_unavailable", null),
    };
  }
  if (!responseMatchesTarget(response, endpoint)) {
    await response?.body?.cancel?.().catch(() => undefined);
    return {
      ready: false,
      code: "adapter_response_invalid",
      readinessSha256: readinessSha256(target, false, "adapter_response_invalid", null),
    };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return {
      ready: false,
      code: "adapter_unavailable",
      readinessSha256: readinessSha256(target, false, "adapter_unavailable", null),
    };
  }

  let raw;
  try {
    raw = await readBoundedJson(response, ADAPTER_RESPONSE_BYTES);
  } catch {
    return {
      ready: false,
      code: "adapter_response_invalid",
      readinessSha256: readinessSha256(target, false, "adapter_response_invalid", null),
    };
  }
  const parsed = readinessResponse(raw, target, framework);
  if (!parsed.valid) {
    return {
      ready: false,
      code: "adapter_response_invalid",
      readinessSha256: readinessSha256(target, false, "adapter_response_invalid", null),
    };
  }
  const code = parsed.ready ? "ready" : "adapter_unready";
  return {
    ready: parsed.ready,
    code,
    readinessSha256: readinessSha256(target, parsed.ready, code, parsed.evidence),
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

export function loadAgentFrameworkHeartbeatConfiguration(environment = process.env) {
  const supabaseUrl = environment.SUPABASE_URL ?? "";
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const releaseSha = environment.ARIA_RELEASE_SHA ?? "";
  const readinessWorkspaceId = environment.AGENT_FRAMEWORK_READINESS_WORKSPACE_ID ?? "";
  if (!privateInternalUrl(supabaseUrl, { requireHttps: false })) throw new Error("invalid Supabase URL");
  if (!validServiceToken(serviceRoleKey)) throw new Error("invalid service credential");
  if (!COMMIT_RE.test(releaseSha)) throw new Error("invalid release SHA");
  if (!UUID_RE.test(readinessWorkspaceId)) throw new Error("invalid framework workspace binding");
  const derivedConfiguration = deriveAgentFrameworkConfigurationFromEnvironment(environment);
  if (environment.AGENT_FRAMEWORK_CONFIGURATION_SHA256 !== derivedConfiguration.sha256) {
    throw new Error("invalid framework configuration SHA-256");
  }

  return Object.freeze({
    supabaseUrl,
    serviceRoleKey,
    releaseSha,
    readinessWorkspaceId,
    intervalMs: boundedInteger(
      environment.AGENT_FRAMEWORK_HEARTBEAT_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      10_000,
      300_000,
      "heartbeat interval",
    ),
    timeoutMs: boundedInteger(
      environment.AGENT_FRAMEWORK_HEARTBEAT_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      500,
      10_000,
      "heartbeat timeout",
    ),
    maximumTargets: boundedInteger(
      environment.AGENT_FRAMEWORK_HEARTBEAT_MAX_TARGETS,
      DEFAULT_MAX_TARGETS,
      1,
      500,
      "heartbeat target bound",
    ),
    concurrency: boundedInteger(
      environment.AGENT_FRAMEWORK_HEARTBEAT_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      1,
      50,
      "heartbeat concurrency",
    ),
    configurationSha256: derivedConfiguration.sha256,
    deerflow: Object.freeze({
      framework: "deerflow",
      url: environment.DEERFLOW_ADAPTER_URL ?? "",
      token: environment.DEERFLOW_ADAPTER_TOKEN ?? "",
      sourceCommit: environment.DEERFLOW_SOURCE_COMMIT ?? "",
      imageDigest: environment.DEERFLOW_IMAGE_DIGEST ?? "",
      isolationMode: "dedicated-worker",
      contract: "aria.deerflow.run.v1",
    }),
    flowise: Object.freeze({
      framework: "flowise",
      url: environment.FLOWISE_ADAPTER_URL ?? "",
      token: environment.FLOWISE_ADAPTER_TOKEN ?? "",
      sourceCommit: environment.FLOWISE_SOURCE_COMMIT ?? "",
      imageDigest: environment.FLOWISE_IMAGE_DIGEST ?? "",
      isolationMode: environment.FLOWISE_TENANT_ISOLATION ?? "",
      contract: "aria.flowise.import.v1",
    }),
  });
}

export function createAgentFrameworkHeartbeatClient(
  baseUrl,
  serviceRoleKey,
  fetcher = fetch,
  options = {},
) {
  const endpoint = privateInternalUrl(baseUrl, { requireHttps: false });
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 10_000, "RPC timeout");
  if (!endpoint) throw new Error("invalid PostgREST URL");
  if (!validServiceToken(serviceRoleKey)) throw new Error("invalid service credential");

  async function rpc(name, args, maximumBytes, allowEmpty) {
    const target = new URL(`/rest/v1/rpc/${name}`, endpoint);
    let response;
    try {
      response = await fetcher(target, {
        method: "POST",
        headers: {
          Accept: "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { data: null, error: { code: "transport_unavailable" } };
    }
    if (!responseMatchesTarget(response, target) || !response.ok) {
      await response?.body?.cancel?.().catch(() => undefined);
      return { data: null, error: { code: "rpc_unavailable" } };
    }
    try {
      return {
        data: await readBoundedJson(response, maximumBytes, { allowEmpty }),
        error: null,
      };
    } catch {
      return { data: null, error: { code: "rpc_response_invalid" } };
    }
  }

  return Object.freeze({
    listTargets(workspaceId) {
      if (!UUID_RE.test(workspaceId ?? "")) {
        return Promise.resolve({ data: null, error: { code: "workspace_binding_invalid" } });
      }
      return rpc("list_agent_framework_heartbeat_targets", {
        p_workspace_id: workspaceId,
      }, INVENTORY_RESPONSE_BYTES, false);
    },
    recordReadiness(args) {
      return rpc("record_agent_framework_readiness", args, RECORD_RESPONSE_BYTES, false);
    },
  });
}

export async function heartbeatAgentFrameworksOnce(client, configuration, fetcher = fetch) {
  let inventory;
  try {
    inventory = await client.listTargets(configuration.readinessWorkspaceId);
  } catch {
    inventory = { data: null, error: { code: "inventory_exception" } };
  }
  if (inventory?.error) {
    return {
      status: "degraded",
      targets: 0,
      ready: 0,
      recorded: 0,
      failureCodes: ["target_inventory_unavailable"],
    };
  }
  const targets = parseTargetInventory(inventory?.data, configuration.maximumTargets);
  if (!targets || targets.some((target) => target.workspace_id !== configuration.readinessWorkspaceId)) {
    return {
      status: "degraded",
      targets: 0,
      ready: 0,
      recorded: 0,
      failureCodes: ["target_inventory_invalid"],
    };
  }

  const outcomes = await mapWithConcurrency(targets, configuration.concurrency, async (target) => {
    const probe = await probeTarget(target, configuration, fetcher);
    let recordResult;
    try {
      recordResult = await client.recordReadiness({
        p_workspace_id: target.workspace_id,
        p_instance_id: target.instance_id,
        p_source_commit: target.source_commit,
        p_image_digest: target.image_digest,
        p_isolation_mode: target.isolation_mode,
        p_configuration_sha256: target.configuration_sha256,
        p_readiness_sha256: probe.readinessSha256,
        p_ready: probe.ready,
      });
    } catch {
      recordResult = { data: null, error: { code: "record_exception" } };
    }
    const recordReceipt = record(recordResult?.data);
    const recorded = !recordResult?.error && recordReceipt !== null &&
      hasExactKeys(recordReceipt, ["status"]) && recordReceipt.status === "recorded";
    const failureCodes = [];
    if (!probe.ready) failureCodes.push(probe.code);
    if (!recorded) failureCodes.push("readiness_record_failed");
    return { ready: probe.ready && recorded, recorded, failureCodes };
  });

  const failureCodes = outcomes.flatMap((outcome) => outcome.failureCodes);
  return {
    status: failureCodes.length === 0 ? "ok" : "degraded",
    targets: targets.length,
    ready: outcomes.filter((outcome) => outcome.ready).length,
    recorded: outcomes.filter((outcome) => outcome.recorded).length,
    failureCodes,
  };
}

function delay(milliseconds, signal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runAgentFrameworkHeartbeatLoop({
  client,
  configuration,
  signal,
  fetcher = fetch,
  logger = () => undefined,
  now = Date.now,
  sleep = delay,
}) {
  while (!signal.aborted) {
    const started = now();
    let result;
    try {
      result = await heartbeatAgentFrameworksOnce(client, configuration, fetcher);
    } catch {
      result = {
        status: "failed",
        targets: 0,
        ready: 0,
        recorded: 0,
        failureCodes: ["worker_exception"],
      };
    }
    const durationMs = Math.max(0, now() - started);
    logger({
      event: "agent_framework_heartbeat",
      releaseSha: configuration.releaseSha,
      status: result.status,
      targets: result.targets,
      ready: result.ready,
      recorded: result.recorded,
      failureCodes: result.failureCodes,
      durationMs,
    });
    if (signal.aborted) break;
    await sleep(Math.max(0, configuration.intervalMs - durationMs), signal);
  }
}

async function main() {
  let configuration;
  try {
    configuration = loadAgentFrameworkHeartbeatConfiguration(process.env);
  } catch {
    console.error(JSON.stringify({
      event: "agent_framework_heartbeat_configuration",
      status: "failed",
      code: "configuration_invalid",
    }));
    process.exitCode = 78;
    return;
  }
  for (const [event, kind] of [["unhandledRejection", "unhandled_rejection"], ["uncaughtException", "uncaught_exception"]]) {
    process.on(event, (err) => {
      console.error(JSON.stringify({
        event: "agent_framework_heartbeat_crash",
        kind,
        message: err instanceof Error ? err.message : String(err),
      }));
      process.exit(1);
    });
  }
  const client = createAgentFrameworkHeartbeatClient(
    configuration.supabaseUrl,
    configuration.serviceRoleKey,
    fetch,
    { timeoutMs: configuration.timeoutMs },
  );
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => controller.abort());
  }
  await runAgentFrameworkHeartbeatLoop({
    client,
    configuration,
    signal: controller.signal,
    logger(event) {
      const writer = event.status === "ok" ? console.log : console.error;
      writer(JSON.stringify(event));
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
