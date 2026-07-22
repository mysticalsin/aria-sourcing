import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = "scripts/recover-orphan-workspace-owner.sh";
assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);

const workspaceId = "31000000-0000-4000-8000-000000000010";
const profileId = "31000000-0000-4000-8000-000000000001";
const requestId = "31000000-0000-4000-8000-000000000110";
const releaseSha = "a".repeat(40);
const recoverySha = "b".repeat(64);
const approval = `aria-owner-recovery-v1:${workspaceId}:${profileId}:${releaseSha}:${recoverySha}:${requestId}`;
const approvalSha = spawnSync(
  process.execPath,
  ["-e", "process.stdout.write(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))", approval],
  { encoding: "utf8" },
).stdout;

const fakeCurlSource = String.raw`#!/usr/bin/env node
const fs = require("node:fs");

const scenario = process.env.MOCK_SCENARIO;
const statePath = process.env.MOCK_STATE;
const logPath = process.env.MOCK_LOG;
const workspaceId = "31000000-0000-4000-8000-000000000010";
const profileId = "31000000-0000-4000-8000-000000000001";
const email = "owner@example.test";
const now = "2026-07-14T12:00:00.000Z";

let state = JSON.parse(fs.readFileSync(statePath, "utf8"));
function save() { fs.writeFileSync(statePath, JSON.stringify(state)); }
function event(name, details = {}) {
  fs.appendFileSync(logPath, JSON.stringify({ event: name, ...details }) + "\n");
}
function unquote(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : trimmed;
}

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
if (configIndex < 0 || !args[configIndex + 1]) process.exit(90);
const config = fs.readFileSync(args[configIndex + 1], "utf8");
const readOption = (name) => {
  const line = config.split("\n").find((entry) => entry.startsWith(name + " = "));
  return line ? unquote(line.slice((name + " = ").length)) : null;
};
const method = readOption("request") || "GET";
const url = new URL(readOption("url"));
const output = readOption("output");
const dataArg = args.find((value) => value.startsWith("@"));
const binaryIndex = args.indexOf("--data-binary");
const bodyRef = binaryIndex >= 0 ? args[binaryIndex + 1] : dataArg;
let body = null;
if (bodyRef?.startsWith("@")) body = JSON.parse(fs.readFileSync(bodyRef.slice(1), "utf8"));

function respond(code, payload) {
  if (output) fs.writeFileSync(output, payload === undefined ? "" : JSON.stringify(payload));
  process.stdout.write(String(code));
}
function user() {
  return {
    id: profileId,
    email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {
      aria_owner_recovery_marker: state.marker,
      aria_owner_recovery_attempt: state.attempt,
    },
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    banned_until: null,
    deleted_at: null,
    identities: [{ provider: "email", identity_data: { email } }],
  };
}

if (method === "GET" && url.pathname === "/rest/v1/workspaces") {
  event(state.bound ? "verify.workspace" : "inventory.workspace");
  return respond(200, [{ id: workspaceId, allowed_domain: state.bound ? "example.test" : "workspace" }]);
}
if (method === "GET" && url.pathname === "/rest/v1/profiles") {
  event(state.bound ? "verify.profile" : "inventory.profiles");
  const row = state.bound
    ? { id: profileId, email, full_name: "Owner Admin", workspace_id: workspaceId, role: "admin" }
    : { id: profileId, email: "", full_name: "Placeholder", workspace_id: workspaceId, role: "admin" };
  return respond(200, [row]);
}
if (method === "GET" && url.pathname === "/rest/v1/workspace_state") {
  event(state.bound ? "verify.state" : "inventory.state");
  return respond(200, [{ workspace_id: workspaceId, state: { campaigns: [{ id: "preserve-me" }] } }]);
}
if (method === "GET" && url.pathname === "/auth/v1/admin/users") {
  event("inventory.auth-users");
  if (scenario === "extra_auth_user") {
    return respond(200, { users: [{ id: "32000000-0000-4000-8000-000000000099", email: "other@example.test" }] });
  }
  return respond(200, { users: state.created && !state.deleted ? [user()] : [] });
}
if (method === "POST" && url.pathname === "/auth/v1/admin/users") {
  event("auth.create");
  if (body?.id !== profileId || body?.email !== email || body?.email_confirm !== true || body?.password?.length < 24) {
    return respond(422, { error: "invalid-create-body" });
  }
  const marker = body?.user_metadata?.aria_owner_recovery_marker;
  if (typeof marker !== "string" || marker.length < 24) return respond(422, { error: "missing-marker" });
  state.created = true;
  state.marker = marker;
  state.attempt = scenario === "concurrent_create_conflict"
    ? "00000000-0000-4000-8000-000000000999"
    : body?.user_metadata?.aria_owner_recovery_attempt;
  save();
  if (scenario === "concurrent_create_conflict") return respond(409, { error: "already-exists" });
  return respond(201, user());
}
if (url.pathname === "/auth/v1/admin/users/" + profileId && method === "GET") {
  event("auth.read-marked");
  if (!state.created || state.deleted) return respond(404, { error: "not-found" });
  return respond(200, user());
}
if (url.pathname === "/auth/v1/admin/users/" + profileId && method === "DELETE") {
  event("auth.delete", { id: profileId, hard: body?.should_soft_delete === false });
  if (!state.created || state.deleted) return respond(404, { error: "not-found" });
  state.deleted = true;
  save();
  return respond(204);
}
if (method === "POST" && url.pathname === "/rest/v1/rpc/recover_orphan_workspace_owner") {
  event("recovery.rpc");
  if (scenario === "rpc_reject_before_binding") {
    return respond(200, { status: "topology_mismatch" });
  }
  const wasBound = state.bound;
  state.bound = true;
  save();
  if (scenario === "rpc_response_lost_after_binding") process.exit(7);
  return respond(200, { status: wasBound ? "replay" : "recovered", request_id: body?.p_request_id });
}
if (method === "POST" && url.pathname === "/auth/v1/token") {
  event("auth.password-login");
  if (
    scenario === "login_reject_before_binding" || !state.created || state.deleted ||
    body?.email !== email || typeof body?.password !== "string"
  ) return respond(401, { error: "bad-login" });
  return respond(200, { access_token: "contract.access.token.0123456789abcdef", user: user() });
}
return respond(404, { error: "unhandled", method, path: url.pathname });
`;

type Event = { event: string; id?: string; hard?: boolean };
type Result = { status: number | null; stdout: string; stderr: string; events: Event[]; state: Record<string, unknown> };

function runScenario(
  scenario: string,
  overrides: Partial<NodeJS.ProcessEnv> = {},
  initialState: Record<string, unknown> = { created: false, deleted: false, bound: false, marker: null },
): Result {
  const root = mkdtempSync(join(tmpdir(), "aria-owner-recovery-behavior-"));
  const bin = join(root, "bin");
  const statePath = join(root, "state.json");
  const logPath = join(root, "events.jsonl");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), fakeCurlSource, { mode: 0o700 });
  writeFileSync(statePath, JSON.stringify(initialState));
  writeFileSync(logPath, "");

  try {
    const result = spawnSync("bash", [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        MOCK_SCENARIO: scenario,
        MOCK_STATE: statePath,
        MOCK_LOG: logPath,
        KONG_URL: "https://recovery.example.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "contract.service.secret.0123456789abcdef",
        ANON_KEY: "contract.anon.secret.0123456789abcdef",
        ADMIN_EMAIL: "owner@example.test",
        ADMIN_PASSWORD: "OwnerRecovery_0123456789abcdef!",
        ARIA_ALLOWED_EMAIL_DOMAIN: "example.test",
        ARIA_RECOVERY_WORKSPACE_ID: workspaceId,
        ARIA_RECOVERY_PROFILE_ID: profileId,
        ARIA_RECOVERY_EXPECTED_DOMAIN: "workspace",
        ARIA_RECOVERY_FULL_NAME: "Owner Admin",
        ARIA_RELEASE_SHA: releaseSha,
        ARIA_RECOVERY_RECEIPT_SHA256: recoverySha,
        ARIA_RECOVERY_REQUEST_ID: requestId,
        ARIA_RECOVERY_OPERATOR_APPROVAL: approval,
        ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256: approvalSha,
        ...overrides,
      },
    });
    const events = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      events,
      state: JSON.parse(readFileSync(statePath, "utf8")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function names(result: Result) {
  return result.events.map(({ event }) => event);
}

const success = runScenario("success");
assert.equal(success.status, 0, success.stderr);
assert.match(success.stdout, /OWNER_RECOVERY_VERIFIED/, JSON.stringify(success));
for (const secret of [
  "contract.service.secret.0123456789abcdef",
  "contract.anon.secret.0123456789abcdef",
  "OwnerRecovery_0123456789abcdef!",
  "owner@example.test",
]) {
  assert.doesNotMatch(`${success.stdout}\n${success.stderr}`, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
const successEvents = names(success);
for (const inventoryEvent of ["inventory.workspace", "inventory.profiles", "inventory.state", "inventory.auth-users"]) {
  assert.ok(successEvents.includes(inventoryEvent), `missing ${inventoryEvent}`);
  assert.ok(successEvents.indexOf(inventoryEvent) < successEvents.indexOf("auth.create"));
}
assert.ok(
  successEvents.indexOf("auth.password-login") < successEvents.indexOf("recovery.rpc"),
  "password login must be proven before the irreversible workspace/profile binding",
);
assert.ok(successEvents.includes("verify.workspace"));
assert.ok(successEvents.includes("verify.profile"));
assert.ok(successEvents.includes("verify.state"));
assert.ok(!successEvents.includes("auth.delete"));

const rejected = runScenario("rpc_reject_before_binding");
assert.notEqual(rejected.status, 0, "a rejected recovery unexpectedly succeeded");
const rejectedDeletes = rejected.events.filter(({ event }) => event === "auth.delete");
assert.deepEqual(rejectedDeletes, [{ event: "auth.delete", id: profileId, hard: true }]);
assert.equal(rejected.state.deleted, true);
assert.ok(names(rejected).includes("auth.read-marked"));

const loginRejected = runScenario("login_reject_before_binding");
assert.notEqual(loginRejected.status, 0, "a non-login-capable owner unexpectedly reached binding");
assert.ok(!names(loginRejected).includes("recovery.rpc"), "recovery RPC ran before password login was proven");
assert.deepEqual(
  loginRejected.events.filter(({ event }) => event === "auth.delete"),
  [{ event: "auth.delete", id: profileId, hard: true }],
);
assert.equal(loginRejected.state.bound, false);
assert.equal(loginRejected.state.deleted, true);

const concurrentConflict = runScenario("concurrent_create_conflict");
assert.notEqual(concurrentConflict.status, 0, "a concurrent create conflict unexpectedly succeeded");
assert.ok(!names(concurrentConflict).includes("recovery.rpc"));
assert.ok(
  !names(concurrentConflict).includes("auth.delete"),
  "cleanup deleted an exact-request identity created by another in-flight attempt",
);
assert.equal(concurrentConflict.state.deleted, false);

const lostAfterCommit = runScenario("rpc_response_lost_after_binding");
assert.notEqual(lostAfterCommit.status, 0, "a lost RPC response unexpectedly succeeded");
assert.equal(lostAfterCommit.state.bound, true);
assert.equal(lostAfterCommit.state.deleted, false, "cleanup deleted a bound owner after ambiguous RPC response");
assert.ok(!names(lostAfterCommit).includes("auth.delete"));

const resumedAfterCommit = runScenario("success", {}, lostAfterCommit.state);
assert.equal(resumedAfterCommit.status, 0, resumedAfterCommit.stderr);
assert.match(resumedAfterCommit.stdout, /OWNER_RECOVERY_VERIFIED/);
assert.ok(!names(resumedAfterCommit).includes("auth.create"), "exact replay created a second GoTrue user");
assert.ok(names(resumedAfterCommit).includes("recovery.rpc"), "exact replay did not reconcile the receipt");
assert.ok(names(resumedAfterCommit).includes("auth.password-login"), "exact replay did not verify password login");
assert.equal(resumedAfterCommit.state.deleted, false);

const extraUser = runScenario("extra_auth_user");
assert.notEqual(extraUser.status, 0, "pre-existing auth user inventory unexpectedly passed");
assert.ok(!names(extraUser).includes("auth.create"));

const shortPassword = runScenario("success", { ADMIN_PASSWORD: "too-short" });
assert.notEqual(shortPassword.status, 0, "short owner password unexpectedly passed");
assert.equal(shortPassword.events.length, 0, "network inventory began before password validation");

const oversizedPassword = runScenario("success", { ADMIN_PASSWORD: "x".repeat(73) });
assert.notEqual(oversizedPassword.status, 0, "oversized owner password unexpectedly passed");
assert.equal(oversizedPassword.events.length, 0, "network inventory began before password maximum validation");

const uppercaseEmail = runScenario("success", { ADMIN_EMAIL: "Owner@Example.Test" });
assert.notEqual(uppercaseEmail.status, 0, "non-canonical owner email unexpectedly passed");
assert.equal(uppercaseEmail.events.length, 0, "network inventory began before canonical email validation");

const whitespaceEmail = runScenario("success", { ADMIN_EMAIL: "owner name@example.test" });
assert.notEqual(whitespaceEmail.status, 0, "owner email with whitespace unexpectedly passed");
assert.equal(whitespaceEmail.events.length, 0, "network inventory began before owner email grammar validation");

const injectedServiceHeader = runScenario("success", {
  SUPABASE_SERVICE_ROLE_KEY: `validprefix012345678901234567890123\nheader = "X-Injected: yes"`, // gitleaks:allow - rejected injection fixture
});
assert.notEqual(injectedServiceHeader.status, 0, "service-key curl-config injection unexpectedly passed");
assert.equal(injectedServiceHeader.events.length, 0, "network inventory began before service header validation");

const injectedAnonHeader = runScenario("success", {
  ANON_KEY: `validprefix012345678901234567890123"\\injected`, // gitleaks:allow - rejected injection fixture
});
assert.notEqual(injectedAnonHeader.status, 0, "anon-key curl-config injection unexpectedly passed");
assert.equal(injectedAnonHeader.events.length, 0, "network inventory began before anon header validation");

console.log(
  "RESULT orphan-owner-recovery-behavior: inventory=before-mutation exact-id=true marker=request-bound replay=resume-safe password=24+ headers=validated cleanup=request-and-attempt-bound ambiguous-commit=preserved login=prebinding-verified state=preserved secret-output=none",
);
