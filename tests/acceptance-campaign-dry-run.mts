import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "scripts/acceptance-campaign-dry-run.sh";
assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);
const source = readFileSync(scriptPath, "utf8");

assert.match(source, /set -Eeuo pipefail/, "the acceptance harness must fail closed");
assert.match(source, /trap ['"]?on_exit['"]? EXIT/, "cleanup must be registered on every exit");
assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/, "service authority must be explicit");
assert.match(source, /ARIA_ALLOWED_EMAIL_DOMAIN/, "the synthetic user must stay on the approved domain");
assert.match(source, /ARIA_RELEASE_SHA/, "the receipt must bind to the exact release");
assert.match(source, /\{40\}/, "the exact release identity must be validated");
assert.match(source, /confirmLive[^\n]*false/, "the harness must never opt in to a live send");
assert.doesNotMatch(source, /confirmLive[^\n]*true/, "the harness must contain no live-send request");
assert.match(source, /manual-required/, "LinkedIn must be proved as assisted-manual");
assert.match(source, /outreach_ledger/, "the immutable delivery ledger must be checked");
assert.match(source, /messages_outbound/, "the durable outbound table must be checked");
assert.match(source, /aria_acceptance_marker/, "ephemeral resources need a deletion marker");

const mockServerSource = String.raw`
import assert from "node:assert/strict";
import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const portFile = process.env.PORT_FILE;
const logFile = process.env.LOG_FILE;
const scenario = process.env.MOCK_SCENARIO || "happy";
const anonKey = "contract-anon-key";
const serviceKey = "contract-service-key";
const accessToken = "contract-access-token";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
let workspace = null;
let user = null;
let profile = null;
let workspaceState = null;

function event(name) {
  appendFileSync(logFile, JSON.stringify({ event: name }) + "\n");
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function empty(res, status = 204) {
  res.writeHead(status);
  res.end();
}

function isService(req) {
  return req.headers.apikey === serviceKey && req.headers.authorization === "Bearer " + serviceKey;
}

function isAuthenticated(req) {
  return req.headers.apikey === anonKey && req.headers.authorization === "Bearer " + accessToken;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!body) return resolve(null);
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let body = null;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "bad-json" }); }

  if (req.method === "POST" && url.pathname === "/rest/v1/workspaces") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    assert.equal(body.allowed_domain, null);
    assert.match(body.name, /^aria-acceptance:/);
    workspace = { id: workspaceId, name: body.name, allowed_domain: null };
    event("workspace.created");
    if (scenario === "workspace_create_response_lost") return json(res, 201, [{ name: workspace.name }]);
    return json(res, 201, [workspace]);
  }

  if (req.method === "POST" && url.pathname === "/auth/v1/admin/users") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    assert.match(body.email, /^aria\.acceptance\+[a-z0-9]+@example\.test$/);
    assert.ok(body.password.length >= 48);
    assert.equal(body.email_confirm, true);
    assert.equal(body.user_metadata.aria_acceptance_marker, workspace.name);
    user = {
      id: userId,
      email: body.email,
      user_metadata: body.user_metadata,
      password: body.password,
    };
    event("user.created");
    if (scenario === "user_create_response_lost") return json(res, 201, {
      email: user.email,
      user_metadata: user.user_metadata,
    });
    return json(res, 201, user);
  }

  if (req.method === "GET" && url.pathname === "/auth/v1/admin/users") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    event("cleanup.user-marker-list");
    return json(res, 200, { users: user ? [user] : [] });
  }

  if (req.method === "POST" && url.pathname === "/rest/v1/profiles") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    assert.equal(body.id, userId);
    assert.equal(body.workspace_id, workspaceId);
    assert.equal(body.role, "admin");
    profile = body;
    event("profile.bound");
    return json(res, 201, [profile]);
  }

  if (req.method === "POST" && url.pathname === "/auth/v1/token") {
    assert.equal(url.searchParams.get("grant_type"), "password");
    if (req.headers.apikey !== anonKey) return json(res, 401, { error: "anon-required" });
    if (!user || body.email !== user.email || body.password !== user.password) {
      return json(res, 400, { error: "invalid-credentials" });
    }
    event("user.signed-in");
    return json(res, 200, {
      access_token: accessToken,
      refresh_token: "contract-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: { id: userId, email: user.email, user_metadata: user.user_metadata },
    });
  }

  if (req.method === "POST" && url.pathname === "/rest/v1/rpc/current_workspace_id") {
    if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
    event("workspace.binding-proved");
    return json(res, 200, workspaceId);
  }

  if (req.method === "POST" && url.pathname === "/rest/v1/rpc/current_profile_role") {
    if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
    return json(res, 200, "admin");
  }

  if (req.method === "POST" && url.pathname === "/rest/v1/workspace_state") {
    if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
    assert.equal(body.workspace_id, workspaceId);
    assert.equal(body.state.settings.dryRunMode, true);
    assert.equal(body.state.settings.humanApprovalGate, true);
    assert.equal(body.state.campaigns[0].jobAnalysis.employmentType, "Full-time");
    assert.ok(body.state.settings.rateLimits);
    assert.ok(body.state.settings.compliance);
    assert.ok(body.state.settings.fleet);
    assert.ok(body.state.settings.guardrails);
    assert.ok(body.state.settings.notifications);
    assert.equal("currentRole" in body.state, false);
    assert.equal(body.state.campaigns.length, 1);
    assert.equal(body.state.outreach[0].status, "Needs Approval");
    assert.equal(body.state.outreach[0].dryRun, true);
    assert.equal(body.state.ariaAcceptanceMarker, workspace.name);
    workspaceState = body;
    event("state.persisted-authenticated");
    return json(res, 201, [workspaceState]);
  }

  if (req.method === "GET" && url.pathname === "/rest/v1/workspace_state") {
    if (!isAuthenticated(req) && !isService(req)) return json(res, 401, { error: "auth-required" });
    const rows = workspaceState ? [workspaceState] : [];
    if (isAuthenticated(req)) event("state.reloaded-authenticated");
    else event("state.read-service");
    return json(res, 200, rows);
  }

  if (req.method === "POST" && url.pathname === "/api/outreach/send") {
    assert.match(req.headers.cookie || "", /sb-auth-token(?:\.0)?=/);
    assert.equal(body.confirmLive, false);
    if (body.channel === "Email") {
      event("app.email-dry-run");
      return json(res, 200, { status: "dry-run", detail: "Nothing sent." });
    }
    if (body.channel === "LinkedIn") {
      event("app.linkedin-manual");
      if (scenario === "linkedin_fail") return json(res, 500, { status: "error" });
      return json(res, 409, { status: "manual-required", detail: "Manual only." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/agents/specs") {
    assert.match(req.headers.cookie || "", /sb-auth-token(?:\.0)?=/);
    event("app.session-authority-proved");
    return json(res, 200, { ok: true, specs: [] });
  }

  if (req.method === "GET" && url.pathname === "/rest/v1/outreach_ledger") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    event("ledger.zero-proved");
    return json(res, 200, []);
  }

  if (req.method === "GET" && url.pathname === "/rest/v1/messages_outbound") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    event("outbox.zero-proved");
    return json(res, 200, []);
  }

  if (url.pathname === "/auth/v1/admin/users/" + userId) {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    if (req.method === "GET") {
      event(user ? "cleanup.user-marker-read" : "cleanup.user-absence-read");
      return user ? json(res, 200, user) : json(res, 404, { error: "not-found" });
    }
    if (req.method === "DELETE") {
      assert.equal(body.should_soft_delete, false);
      user = null;
      profile = null;
      event("cleanup.user-deleted");
      return empty(res);
    }
  }

  if (req.method === "GET" && url.pathname === "/rest/v1/profiles") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    event("cleanup.profile-absence-read");
    return json(res, 200, profile ? [profile] : []);
  }

  if (url.pathname === "/rest/v1/workspaces") {
    if (!isService(req)) return json(res, 401, { error: "service-required" });
    if (req.method === "GET") {
      event(workspace ? "cleanup.workspace-marker-read" : "cleanup.workspace-absence-read");
      if (scenario === "workspace_marker_mismatch" && workspace) {
        return json(res, 200, [{ ...workspace, name: "not-the-acceptance-marker" }]);
      }
      return json(res, 200, workspace ? [workspace] : []);
    }
    if (req.method === "DELETE") {
      const deleted = workspace;
      workspace = null;
      workspaceState = null;
      event("cleanup.workspace-deleted");
      return json(res, 200, deleted ? [deleted] : []);
    }
  }

  return json(res, 404, { error: "unhandled", method: req.method, path: url.pathname });
});

server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});
`;

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  events: string[];
};

function waitForFile(path: string) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(path) && readFileSync(path, "utf8").trim()) return;
    Atomics.wait(sleeper, 0, 0, 25);
  }
  throw new Error(`timed out waiting for ${path}`);
}

function runScenario(scenario: string): RunResult {
  const root = mkdtempSync(join(tmpdir(), "aria-acceptance-contract-"));
  const serverPath = join(root, "mock-server.mjs");
  const portPath = join(root, "port");
  const logPath = join(root, "events.jsonl");
  writeFileSync(serverPath, mockServerSource, { mode: 0o700 });
  writeFileSync(logPath, "");
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT_FILE: portPath, LOG_FILE: logPath, MOCK_SCENARIO: scenario },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    waitForFile(portPath);
    const port = readFileSync(portPath, "utf8").trim();
    const result = spawnSync("bash", [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: root,
        APP_URL: `http://127.0.0.1:${port}`,
        KONG_URL: `http://127.0.0.1:${port}`,
        ANON_KEY: "contract-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "contract-service-key",
        ARIA_ALLOWED_EMAIL_DOMAIN: "example.test",
        ARIA_RELEASE_SHA: "a".repeat(40),
        ARIA_ACCEPTANCE_TEST_MODE: "1",
      },
      timeout: 30_000,
    });
    const events = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).event as string);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, events };
  } finally {
    server.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
}

const happy = runScenario("happy");
assert.equal(happy.status, 0, happy.stderr);
const receipt = JSON.parse(happy.stdout);
assert.equal(receipt.schemaVersion, 1);
assert.equal(receipt.status, "passed");
assert.equal(receipt.releaseSha, "a".repeat(40));
assert.equal(receipt.checks.authenticatedWorkspaceBinding, true);
assert.equal(receipt.checks.appSessionAuthority, true);
assert.equal(receipt.checks.authenticatedStateReload, true);
assert.equal(receipt.checks.emailConfirmLiveFalse, "dry-run");
assert.equal(receipt.checks.linkedinPolicy, "manual-required");
assert.equal(receipt.checks.outreachLedgerRows, 0);
assert.equal(receipt.checks.messagesOutboundRows, 0);
assert.equal(receipt.checks.cleanupVerified, true);
assert.equal(receipt.safety.liveSendIntentProvided, false);
assert.equal(receipt.safety.requestsWithConfirmLiveTrue, 0);
assert.equal(receipt.safety.providerCallPreventionProof, "exact-sha-ci-normal-tenant-route-counters");
assert.doesNotMatch(happy.stdout, /aria\.acceptance|example\.test|contract-|password|access_token/i);
assert.doesNotMatch(happy.stderr, /aria\.acceptance\+|example\.test|contract-(?:anon|service|access|refresh)/i);
assert.deepEqual(happy.events.slice(-5), [
  "cleanup.workspace-deleted",
  "cleanup.user-absence-read",
  "cleanup.profile-absence-read",
  "cleanup.workspace-absence-read",
  "state.read-service",
]);
assert.ok(happy.events.indexOf("ledger.zero-proved") < happy.events.indexOf("cleanup.user-deleted"));
assert.ok(happy.events.includes("app.email-dry-run"));
assert.ok(happy.events.includes("app.linkedin-manual"));

const appFailure = runScenario("linkedin_fail");
assert.notEqual(appFailure.status, 0, "an invalid LinkedIn safety response must fail acceptance");
assert.equal(appFailure.stdout, "", "a failed run must not emit an acceptance receipt");
assert.ok(appFailure.events.includes("cleanup.user-deleted"), "failure must still delete the marked auth user");
assert.ok(appFailure.events.includes("cleanup.workspace-deleted"), "failure must still delete the marked workspace");
assert.ok(appFailure.events.includes("cleanup.user-absence-read"), "failure cleanup must verify user absence");
assert.ok(appFailure.events.includes("cleanup.workspace-absence-read"), "failure cleanup must verify workspace absence");

const markerMismatch = runScenario("workspace_marker_mismatch");
assert.notEqual(markerMismatch.status, 0, "a mismatched cleanup marker must fail closed");
assert.equal(markerMismatch.stdout, "", "unsafe cleanup must never produce a receipt");
assert.ok(markerMismatch.events.includes("cleanup.user-deleted"), "the independently marked auth user remains safe to delete");
assert.ok(!markerMismatch.events.includes("cleanup.workspace-deleted"), "an unmarked workspace must never be deleted");

const lostWorkspaceResponse = runScenario("workspace_create_response_lost");
assert.notEqual(lostWorkspaceResponse.status, 0, "lost workspace identity must fail acceptance");
assert.equal(lostWorkspaceResponse.stdout, "", "lost create response must not emit a receipt");
assert.ok(lostWorkspaceResponse.events.includes("cleanup.workspace-deleted"), "cleanup must recover the exact marked workspace when its create response loses the id");
assert.ok(lostWorkspaceResponse.events.includes("cleanup.workspace-absence-read"), "recovered workspace cleanup must prove absence");

const lostUserResponse = runScenario("user_create_response_lost");
assert.notEqual(lostUserResponse.status, 0, "lost auth-user identity must fail acceptance");
assert.equal(lostUserResponse.stdout, "", "lost auth-user response must not emit a receipt");
assert.ok(lostUserResponse.events.includes("cleanup.user-marker-list"), "cleanup must recover a committed user by exact email and marker");
assert.ok(lostUserResponse.events.includes("cleanup.user-deleted"), "cleanup must delete the exact recovered marked user");
assert.ok(lostUserResponse.events.includes("cleanup.user-absence-read"), "recovered user cleanup must prove absence");

console.log("acceptance-campaign-dry-run: contract and behavior tests passed");
