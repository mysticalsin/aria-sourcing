#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  deriveAgentFrameworkConfigurationFromEnvironment,
} from "../src/lib/agents/framework/configuration-core.mjs";

const PLAN_SCHEMA = "aria.agent-framework.authority-plan.v2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/;
const VERSION = /^[1-9][0-9]{0,18}$/;
const ACTIONS = new Set(["configure", "activate", "kill"]);
const SUCCESS = Object.freeze({
  configure: new Set(["configured", "replay"]),
  activate: new Set(["activated", "replay"]),
  kill: new Set(["killed", "replay"]),
});
export const RPC_RESPONSE_MAX_BYTES = 32_768;
export const RPC_FETCH_POLICY = Object.freeze({
  method: "POST",
  cache: "no-store",
  redirect: "error",
});

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} has unexpected fields`);
}

function required(value, name, maximum = 2_048) {
  if (
    typeof value !== "string" || value.trim() !== value || value.length < 1 ||
    value.length > maximum || /[\r\n\0]/.test(value)
  ) fail(`${name} is invalid`);
  return value;
}

function uuid(value, name) {
  const normalized = required(value, name, 36).toLowerCase();
  if (!UUID.test(normalized) || normalized === "00000000-0000-0000-0000-000000000000") {
    fail(`${name} is invalid`);
  }
  return normalized;
}

function sha256(value, name) {
  const normalized = required(value, name, 64);
  if (!SHA256.test(normalized)) fail(`${name} is invalid`);
  return normalized;
}

function controlVersion(value, name) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : required(value, name, 19);
  if (!VERSION.test(normalized) || BigInt(normalized) > 9_223_372_036_854_775_806n) {
    fail(`${name} is invalid`);
  }
  return normalized;
}

function httpsOrigin(value, name) {
  const normalized = required(value, name, 2_048);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail(`${name} is invalid`);
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash
  ) fail(`${name} must be an HTTPS origin`);
  return parsed.origin;
}

function parseArguments(argv) {
  const [command, action, ...rest] = argv;
  if (command === "prepare") {
    if (!ACTIONS.has(action)) fail("prepare action must be configure, activate, or kill");
    const values = new Map();
    for (let index = 0; index < rest.length; index += 2) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (flag !== "--actor-id" || values.has(flag) || value === undefined) {
        fail("usage: prepare <configure|activate|kill> --actor-id <admin-uuid>");
      }
      values.set(flag, value);
    }
    if (values.size !== 1) fail("--actor-id is required");
    return { command, action, actorId: uuid(values.get("--actor-id"), "actorId") };
  }
  if (command === "apply" && action === undefined) {
    fail("usage: apply --plan <file> --confirm <sha256>");
  }
  if (command === "apply") {
    const applyArgs = [action, ...rest];
    const values = new Map();
    for (let index = 0; index < applyArgs.length; index += 2) {
      const flag = applyArgs[index];
      const value = applyArgs[index + 1];
      if (!new Set(["--plan", "--confirm"]).has(flag) || values.has(flag) || value === undefined) {
        fail("usage: apply --plan <file> --confirm <sha256>");
      }
      values.set(flag, value);
    }
    if (values.size !== 2) fail("--plan and --confirm are required");
    return {
      command,
      planPath: required(values.get("--plan"), "plan", 4_096),
      confirmation: sha256(values.get("--confirm"), "confirmation"),
    };
  }
  fail(
    "usage: prepare <configure|activate|kill> --actor-id <admin-uuid> | " +
    "apply --plan <file> --confirm <sha256>",
  );
}

function operatorEnvironment() {
  const baseUrl = httpsOrigin(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY", 16_384);
  if (serviceKey.length < 32 || /\s/.test(serviceKey)) fail("SUPABASE_SERVICE_ROLE_KEY is invalid");
  return { baseUrl, serviceKey };
}

function workspaceIdForAction(action) {
  if (action === "kill") {
    return uuid(process.env.AGENT_FRAMEWORK_READINESS_WORKSPACE_ID, "workspaceId");
  }
  return deriveAgentFrameworkConfigurationFromEnvironment(process.env).manifest.workspaceId;
}

function configurationIdentity() {
  const derived = deriveAgentFrameworkConfigurationFromEnvironment(process.env);
  return Object.freeze({
    configurationSha256: derived.sha256,
    deerflowInstanceId: derived.manifest.deerflow.instanceId,
    deerflowSourceCommit: derived.manifest.deerflow.sourceCommit,
    deerflowImageDigest: derived.manifest.deerflow.imageDigest,
    flowiseInstanceId: derived.manifest.flowise.instanceId,
    flowiseSourceCommit: derived.manifest.flowise.sourceCommit,
    flowiseImageDigest: derived.manifest.flowise.imageDigest,
    flowiseIsolationMode: derived.manifest.flowise.isolation,
  });
}

export async function rpc(name, body, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (
    typeof fetchImpl !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15_000
  ) fail("RPC transport policy is invalid");
  const { baseUrl, serviceKey } = operatorEnvironment();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
        ...RPC_FETCH_POLICY,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      fail(`${name} request failed`);
    }
    if (!response.ok) fail(`${name} failed with HTTP ${response.status}`);
    const value = await readBoundedRpcJson(response);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} returned an invalid receipt`);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export async function readBoundedRpcJson(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") fail("RPC response content type is invalid");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = /^[0-9]+$/.test(declared) ? Number(declared) : Number.NaN;
    if (!Number.isSafeInteger(length) || length > RPC_RESPONSE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      fail("RPC response is too large");
    }
  }
  if (!response.body) fail("RPC response body is missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RPC_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail("RPC response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message === "RPC response is too large") throw error;
    fail("RPC response read failed");
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("RPC response JSON is invalid");
  }
}

async function inspect(workspaceId, actorId) {
  const receipt = await rpc("inspect_agent_framework_control_authority", {
    p_workspace_id: workspaceId,
    p_actor_id: actorId,
  });
  if (receipt.status !== "ok") fail(`control inspection failed: ${String(receipt.status)}`);
  if (uuid(receipt.workspace_id, "inspected workspaceId") !== workspaceId) fail("control workspace mismatch");
  return receipt;
}

function planMaterial(plan) {
  const identity = plan.identity;
  return JSON.stringify([
    plan.schema,
    plan.action,
    plan.authorityOrigin,
    plan.workspaceId,
    plan.actorId,
    plan.changeId,
    plan.expectedControlVersion,
    identity?.configurationSha256 ?? null,
    identity?.deerflowInstanceId ?? null,
    identity?.deerflowSourceCommit ?? null,
    identity?.deerflowImageDigest ?? null,
    identity?.flowiseInstanceId ?? null,
    identity?.flowiseSourceCommit ?? null,
    identity?.flowiseImageDigest ?? null,
    identity?.flowiseIsolationMode ?? null,
    plan.createdAt,
    plan.expiresAt,
  ]);
}

export function confirmationFor(plan) {
  return createHash("sha256").update(planMaterial(plan), "utf8").digest("hex");
}

function validateIdentity(value) {
  exactKeys(value, [
    "configurationSha256", "deerflowInstanceId", "deerflowSourceCommit",
    "deerflowImageDigest", "flowiseInstanceId", "flowiseSourceCommit",
    "flowiseImageDigest", "flowiseIsolationMode",
  ], "identity");
  const identity = {
    configurationSha256: sha256(value.configurationSha256, "configurationSha256"),
    deerflowInstanceId: uuid(value.deerflowInstanceId, "deerflowInstanceId"),
    deerflowSourceCommit: required(value.deerflowSourceCommit, "deerflowSourceCommit", 40),
    deerflowImageDigest: required(value.deerflowImageDigest, "deerflowImageDigest", 460),
    flowiseInstanceId: uuid(value.flowiseInstanceId, "flowiseInstanceId"),
    flowiseSourceCommit: required(value.flowiseSourceCommit, "flowiseSourceCommit", 40),
    flowiseImageDigest: required(value.flowiseImageDigest, "flowiseImageDigest", 460),
    flowiseIsolationMode: required(value.flowiseIsolationMode, "flowiseIsolationMode", 40),
  };
  if (!COMMIT.test(identity.deerflowSourceCommit) || !COMMIT.test(identity.flowiseSourceCommit)) fail("source commit is invalid");
  if (!IMAGE.test(identity.deerflowImageDigest) || !IMAGE.test(identity.flowiseImageDigest)) fail("image digest is invalid");
  if (!new Set(["instance-per-workspace", "licensed-enterprise-workspace"]).has(identity.flowiseIsolationMode)) {
    fail("Flowise isolation is invalid");
  }
  if (identity.deerflowInstanceId === identity.flowiseInstanceId) fail("framework instance IDs must differ");
  return Object.freeze(identity);
}

function validatePlan(value) {
  exactKeys(value, [
    "schema", "action", "authorityOrigin", "workspaceId", "actorId", "changeId",
    "expectedControlVersion", "identity", "createdAt", "expiresAt",
    "confirmationSha256",
  ], "plan");
  if (value.schema !== PLAN_SCHEMA || !ACTIONS.has(value.action)) fail("plan schema or action is invalid");
  const createdAt = new Date(required(value.createdAt, "createdAt", 40));
  const expiresAt = new Date(required(value.expiresAt, "expiresAt", 40));
  if (!Number.isFinite(createdAt.valueOf()) || !Number.isFinite(expiresAt.valueOf())) fail("plan time is invalid");
  const plan = {
    schema: PLAN_SCHEMA,
    action: value.action,
    authorityOrigin: httpsOrigin(value.authorityOrigin, "authorityOrigin"),
    workspaceId: uuid(value.workspaceId, "workspaceId"),
    actorId: uuid(value.actorId, "actorId"),
    changeId: uuid(value.changeId, "changeId"),
    expectedControlVersion: controlVersion(value.expectedControlVersion, "expectedControlVersion"),
    identity: value.action === "kill"
      ? (value.identity === null ? null : fail("kill plan identity must be null"))
      : validateIdentity(value.identity),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  if (expiresAt <= createdAt || expiresAt.valueOf() - createdAt.valueOf() > 15 * 60_000) fail("plan lifetime is invalid");
  if (createdAt.valueOf() > Date.now() + 30_000 || expiresAt.valueOf() <= Date.now()) fail("plan is expired or from the future");
  const embedded = sha256(value.confirmationSha256, "confirmationSha256");
  if (confirmationFor(plan) !== embedded) fail("plan confirmation digest is invalid");
  return Object.freeze({ ...plan, confirmationSha256: embedded });
}

function assertCurrentIdentity(control, identity, { requireFresh = false } = {}) {
  if (
    control.configuration_sha256 !== identity.configurationSha256 ||
    control.deerflow_instance_id !== identity.deerflowInstanceId ||
    control.flowise_instance_id !== identity.flowiseInstanceId
  ) fail("database framework identity differs from the canonical environment");
  if (requireFresh && (control.deerflow_fresh !== true || control.flowise_fresh !== true)) {
    fail("both framework heartbeat receipts must be fresh before activation");
  }
}

async function prepare(action, actorId) {
  const authorityOrigin = operatorEnvironment().baseUrl;
  const workspaceId = workspaceIdForAction(action);
  const control = await inspect(workspaceId, actorId);
  const identity = action === "kill" ? null : configurationIdentity();
  if (identity && workspaceId !== deriveAgentFrameworkConfigurationFromEnvironment(process.env).manifest.workspaceId) {
    fail("canonical workspace identity mismatch");
  }
  if (action === "activate") {
    assertCurrentIdentity(control, identity, { requireFresh: true });
    if (control.execution_enabled !== false || control.kill_switch !== true) {
      fail("activation requires the disabled, kill-engaged control state");
    }
  }
  const createdAt = new Date();
  const plan = {
    schema: PLAN_SCHEMA,
    action,
    authorityOrigin,
    workspaceId,
    actorId,
    changeId: randomUUID(),
    expectedControlVersion: controlVersion(control.control_version, "controlVersion"),
    identity,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.valueOf() + 15 * 60_000).toISOString(),
  };
  process.stdout.write(`${JSON.stringify({ ...plan, confirmationSha256: confirmationFor(plan) }, null, 2)}\n`);
}

export async function applyAuthorityPlan(value, suppliedConfirmation, options = {}) {
  const resolveAuthorityOrigin = options.resolveAuthorityOrigin ?? (() => operatorEnvironment().baseUrl);
  const inspectControl = options.inspectControl ?? inspect;
  const resolveWorkspaceId = options.resolveWorkspaceId ?? workspaceIdForAction;
  const resolveIdentity = options.resolveIdentity ?? configurationIdentity;
  const invokeRpc = options.invokeRpc ?? rpc;
  const writeReceipt = options.writeReceipt ?? ((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  });
  const plan = validatePlan(value);
  if (plan.confirmationSha256 !== suppliedConfirmation) fail("explicit confirmation does not match the plan");
  if (httpsOrigin(resolveAuthorityOrigin(), "current authority origin") !== plan.authorityOrigin) {
    fail("authority origin differs from the reviewed plan");
  }
  const control = await inspectControl(plan.workspaceId, plan.actorId);
  if (uuid(control.workspace_id, "inspected workspaceId") !== plan.workspaceId) {
    fail("control workspace mismatch");
  }
  const currentControlVersion = controlVersion(control.control_version, "controlVersion");
  const mutationCanStillCommit = currentControlVersion === plan.expectedControlVersion;
  if (plan.action === "kill" || mutationCanStillCommit) {
    const expectedWorkspaceId = resolveWorkspaceId(plan.action);
    if (plan.workspaceId !== expectedWorkspaceId) fail("plan workspace differs from the current environment");
  }
  if (plan.action !== "kill" && mutationCanStillCommit) {
    const currentIdentity = resolveIdentity();
    if (JSON.stringify(plan.identity) !== JSON.stringify(currentIdentity)) fail("canonical environment changed after plan preparation");
    if (plan.action === "activate") {
      assertCurrentIdentity(control, currentIdentity, { requireFresh: true });
      if (control.execution_enabled !== false || control.kill_switch !== true) {
        fail("activation control state changed after plan preparation");
      }
    }
  }

  let name;
  let body;
  if (plan.action === "configure") {
    name = "configure_agent_framework_authority";
    body = {
      p_workspace_id: plan.workspaceId,
      p_actor_id: plan.actorId,
      p_change_id: plan.changeId,
      p_expected_control_version: plan.expectedControlVersion,
      p_configuration_sha256: plan.identity.configurationSha256,
      p_deerflow_instance_id: plan.identity.deerflowInstanceId,
      p_deerflow_source_commit: plan.identity.deerflowSourceCommit,
      p_deerflow_image_digest: plan.identity.deerflowImageDigest,
      p_flowise_instance_id: plan.identity.flowiseInstanceId,
      p_flowise_source_commit: plan.identity.flowiseSourceCommit,
      p_flowise_image_digest: plan.identity.flowiseImageDigest,
      p_flowise_isolation_mode: plan.identity.flowiseIsolationMode,
    };
  } else if (plan.action === "activate") {
    name = "activate_agent_framework_authority";
    body = {
      p_workspace_id: plan.workspaceId,
      p_actor_id: plan.actorId,
      p_change_id: plan.changeId,
      p_expected_control_version: plan.expectedControlVersion,
      p_configuration_sha256: plan.identity.configurationSha256,
      p_deerflow_instance_id: plan.identity.deerflowInstanceId,
      p_flowise_instance_id: plan.identity.flowiseInstanceId,
    };
  } else {
    name = "engage_agent_framework_kill_switch";
    body = {
      p_workspace_id: plan.workspaceId,
      p_actor_id: plan.actorId,
      p_change_id: plan.changeId,
      p_expected_control_version: plan.expectedControlVersion,
    };
  }
  const receipt = await invokeRpc(name, body);
  if (!SUCCESS[plan.action].has(receipt.status)) fail(`${plan.action} failed: ${String(receipt.status)}`);
  writeReceipt(receipt);
  return receipt;
}

async function apply(planPath, suppliedConfirmation) {
  const raw = await readFile(planPath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 32_768) fail("plan file is too large");
  return applyAuthorityPlan(JSON.parse(raw), suppliedConfirmation);
}

async function main() {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.command === "prepare") await prepare(parsed.action, parsed.actorId);
    else await apply(parsed.planPath, parsed.confirmation);
  } catch (error) {
    process.stderr.write(`agent framework authority: ${error instanceof Error ? error.message : "operation failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
