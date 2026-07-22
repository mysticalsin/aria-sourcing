import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "scripts/provision-first-admin.sh";
assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);
const scriptSource = readFileSync(scriptPath, "utf8");
const realCurl = spawnSync("bash", ["-lc", "command -v curl"], { encoding: "utf8" }).stdout.trim();
assert.ok(realCurl, "curl must be discoverable for the behavior harness");

const mockServerSource = String.raw`
import assert from "node:assert/strict";
import https from "node:https";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const portFile = process.env.PORT_FILE;
const logFile = process.env.LOG_FILE;
const keyFile = process.env.KEY_FILE;
const certFile = process.env.CERT_FILE;
const scenario = process.env.MOCK_SCENARIO;

const anonKey = "contract-anon-key";
const serviceKey = "contract-service-key";
const accessToken = "contract-access-token";
const allowedDomain = "example.test";
const wrongDomain = "other.test";
const adminEmail = "first.admin@example.test";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const createdUserId = "22222222-2222-4222-8222-222222222222";
const unrelatedUserId = "33333333-3333-4333-8333-333333333333";
const now = "2026-07-11T12:00:00.000Z";

let createdUser = null;
let createdMarker = null;
let createdMarkerLocation = null;
let deleted = false;
let workspaceBound = false;

function event(name, details = {}) {
  appendFileSync(logFile, JSON.stringify({ event: name, ...details }) + "\n");
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

function findMarker(body) {
  for (const location of ["app_metadata", "user_metadata"]) {
    const metadata = body?.[location];
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    for (const [key, value] of Object.entries(metadata)) {
      if (/^aria_.*(?:admin|bootstrap).*marker$/i.test(key) && typeof value === "string" && value.length >= 16) {
        return { location, key, value };
      }
    }
  }
  return null;
}

function activeUser(user) {
  return {
    ...user,
    app_metadata: {
      ...(user?.app_metadata || {}),
      provider: "email",
      providers: ["email"],
    },
    identities: [{ provider: "email" }],
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
  };
}

const server = https.createServer(
  { key: readFileSync(keyFile), cert: readFileSync(certFile) },
  async (req, res) => {
    const url = new URL(req.url, "https://127.0.0.1");
    let body = null;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "bad-json" }); }

    if (req.method === "GET" && url.pathname === "/rest/v1/workspaces") {
      const postCreateProof = url.searchParams.has("id") || isAuthenticated(req);
      if (postCreateProof) {
        if (!isAuthenticated(req) && !isService(req)) return json(res, 401, { error: "auth-required" });
        event("workspace.domain-proved");
        return json(res, 200, [{ id: workspaceId, allowed_domain: allowedDomain }]);
      }

      if (!isService(req)) return json(res, 401, { error: "service-required" });
      event("workspace.preflight");
      if (scenario === "existing_workspace") {
        return json(res, 200, [{ id: workspaceId, allowed_domain: allowedDomain }]);
      }
      if (scenario === "workspace_domain_mismatch") {
        return json(res, 200, [{ id: workspaceId, allowed_domain: wrongDomain }]);
      }
      return json(res, 200, []);
    }

    if (req.method === "GET" && url.pathname === "/rest/v1/profiles" && isService(req)) {
      if (url.searchParams.has("id")) {
        event("cleanup.bound-admin-read");
        if (scenario === "cleanup_binding_http_error") {
          return json(res, 503, { error: "database-unavailable" });
        }
        if (scenario === "cleanup_binding_malformed") {
          return json(res, 200, { id: createdUserId });
        }
        let rows = workspaceBound ? [{
          id: createdUserId,
          role: "admin",
          workspace_id: workspaceId,
          workspaces: { id: workspaceId, allowed_domain: allowedDomain },
        }] : [];
        if (scenario === "cleanup_binding_two_rows") {
          rows = [
            {
              id: createdUserId,
              role: "admin",
              workspace_id: workspaceId,
              workspaces: { id: workspaceId, allowed_domain: allowedDomain },
            },
            {
              id: createdUserId,
              role: "admin",
              workspace_id: workspaceId,
              workspaces: { id: workspaceId, allowed_domain: allowedDomain },
            },
          ];
        }
        if (scenario === "cleanup_binding_member") {
          rows = [{
            id: createdUserId,
            role: "member",
            workspace_id: workspaceId,
            workspaces: { id: workspaceId, allowed_domain: allowedDomain },
          }];
        }
        if (scenario === "cleanup_binding_wrong_domain") {
          rows = [{
            id: createdUserId,
            role: "admin",
            workspace_id: workspaceId,
            workspaces: { id: workspaceId, allowed_domain: wrongDomain },
          }];
        }
        const roleFilter = url.searchParams.get("role")?.replace(/^eq\./, "");
        const domainFilter = url.searchParams.get("workspaces.allowed_domain")?.replace(/^eq\./, "");
        if (roleFilter) rows = rows.filter((row) => row.role === roleFilter);
        if (domainFilter) {
          rows = rows.filter((row) => row.workspaces?.allowed_domain === domainFilter);
        }
        return json(res, 200, rows);
      }
      event("admin.preflight");
      return json(res, 200, []);
    }

    if (req.method === "POST" && url.pathname === "/auth/v1/admin/users") {
      event("auth.create-attempted");
      if (!isService(req)) return json(res, 401, { error: "service-required" });
      if (scenario === "existing_workspace" || scenario === "workspace_domain_mismatch") {
        return json(res, 409, { error: "unsafe-create-attempt" });
      }
      if (scenario === "existing_user_422") {
        return json(res, 422, { message: "A user with this email address has already been registered" });
      }

      assert.equal(body.email, adminEmail);
      assert.equal(body.email_confirm, true);
      assert.ok(typeof body.password === "string" && body.password.length >= 24);
      const marker = findMarker(body);
      if (marker) {
        createdMarker = marker.value;
        createdMarkerLocation = { location: marker.location, key: marker.key };
        event("auth.create-marker-present");
      } else {
        event("auth.create-marker-missing");
      }
      createdUser = {
        id: createdUserId,
        email: adminEmail,
        app_metadata: body.app_metadata || {},
        user_metadata: body.user_metadata || {},
      };
      event("auth.created", { id: createdUserId });
      if (scenario === "create_transport_lost") {
        event("auth.create-transport-lost");
        req.socket.destroy();
        return;
      }
      if (scenario === "create_response_lost") {
        return json(res, 201, {
          email: createdUser.email,
          user_metadata: createdUser.user_metadata,
        });
      }
      return json(res, 201, createdUser);
    }

    if (req.method === "GET" && url.pathname === "/auth/v1/admin/users") {
      if (!isService(req)) return json(res, 401, { error: "service-required" });
      event("cleanup.user-marker-list");
      return json(res, 200, { users: createdUser && !deleted ? [createdUser] : [] });
    }

    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      if (req.headers.apikey !== anonKey || req.headers.authorization !== "Bearer " + anonKey) {
        return json(res, 401, { error: "anon-required" });
      }
      assert.equal(url.searchParams.get("grant_type"), "password");
      assert.equal(body.email, adminEmail);
      event("auth.signed-in");
      const baseUser = scenario === "created_login_id_mismatch" && createdUser
        ? { ...createdUser, id: unrelatedUserId }
        : createdUser || {
        id: unrelatedUserId,
        email: adminEmail,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
      };
      const user = activeUser(baseUser);
      if (
        scenario === "post_create_verification_failure" ||
        scenario === "cleanup_marker_mismatch" ||
        scenario.startsWith("cleanup_binding_") ||
        scenario === "existing_user_422"
      ) {
        delete user.last_sign_in_at;
      }
      return json(res, 200, {
        access_token: accessToken,
        refresh_token: "contract-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }

    if (req.method === "POST" && url.pathname === "/rest/v1/rpc/ensure_workspace") {
      if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
      if (scenario === "ensure_workspace_transport_lost") {
        event("workspace.binding-inflight");
        req.socket.destroy();
        setTimeout(() => {
          workspaceBound = true;
          event("workspace.binding-late-commit");
        }, 1000);
        return;
      }
      workspaceBound = true;
      event("workspace.binding-proved");
      if (scenario === "ensure_workspace_committed_response_lost") return json(res, 200, null);
      return json(res, 200, workspaceId);
    }

    if (req.method === "GET" && url.pathname === "/rest/v1/profiles") {
      if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
      event("profile.admin-proved");
      return json(res, 200, [{ id: createdUserId, workspace_id: workspaceId, role: "admin" }]);
    }

    if (req.method === "POST" && url.pathname === "/rest/v1/rpc/current_profile_role") {
      if (!isAuthenticated(req)) return json(res, 401, { error: "auth-required" });
      event("role.admin-proved");
      return json(res, 200, "admin");
    }

    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      if (!isService(req)) return json(res, 401, { error: "service-required" });
      const requestedId = decodeURIComponent(url.pathname.slice("/auth/v1/admin/users/".length));

      if (req.method === "GET") {
        if (requestedId !== createdUserId || !createdUser || deleted) {
          event("cleanup.user-absence-read", { id: requestedId });
          return json(res, 404, { error: "not-found" });
        }
        event("cleanup.user-marker-read", { id: requestedId });
        if (scenario === "cleanup_marker_mismatch" && createdMarker && createdMarkerLocation) {
          const mutated = structuredClone(createdUser);
          mutated[createdMarkerLocation.location][createdMarkerLocation.key] = "mismatched-marker-value";
          return json(res, 200, mutated);
        }
        return json(res, 200, createdUser);
      }

      if (req.method === "DELETE") {
        event("cleanup.delete-attempted", {
          id: requestedId,
          hardDelete: body?.should_soft_delete === false,
        });
        if (requestedId !== createdUserId) {
          event("cleanup.unsafe-user-target", { id: requestedId });
          return json(res, 409, { error: "wrong-user" });
        }
        deleted = true;
        event("cleanup.user-deleted", { id: requestedId });
        return empty(res);
      }
    }

    return json(res, 404, { error: "unhandled", method: req.method, path: url.pathname });
  },
);

server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});
`;

type Event = {
  event: string;
  id?: string;
  hardDelete?: boolean;
};

type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  events: Event[];
};

function waitForFile(path: string) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 120; attempt++) {
    if (existsSync(path) && readFileSync(path, "utf8").trim()) return;
    Atomics.wait(sleeper, 0, 0, 25);
  }
  throw new Error(`timed out waiting for ${path}`);
}

function runScenario(
  scenario: string,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): RunResult {
  const root = mkdtempSync(join(tmpdir(), "aria-first-admin-behavior-"));
  const binPath = join(root, "bin");
  const serverPath = join(root, "mock-server.mjs");
  const portPath = join(root, "port");
  const logPath = join(root, "events.jsonl");
  const keyPath = join(root, "key.pem");
  const certPath = join(root, "cert.pem");
  const curlWrapperPath = join(binPath, "curl");
  mkdirSync(binPath);
  writeFileSync(serverPath, mockServerSource, { mode: 0o700 });
  writeFileSync(logPath, "");
  // curl 8.7 rejects `fail-with-body = false` in a config file. Keep the
  // production defect visible in a separate assertion, but normalize that one
  // line here so every safety scenario can still exercise the HTTP behavior.
  writeFileSync(
    curlWrapperPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--config" ] && [ -n "\${2:-}" ]; then
  config="\$2"
  shift 2
  normalized="\${config}.behavior-test"
  /usr/bin/sed 's/^fail-with-body = false$/no-fail-with-body/' "\$config" > "\$normalized"
  exec "\$REAL_CURL" --config "\$normalized" "\$@"
fi
exec "\$REAL_CURL" "\$@"
`,
    { mode: 0o700 },
  );

  const certificate = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-days",
      "1",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(certificate.status, 0, certificate.stderr);

  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT_FILE: portPath,
      LOG_FILE: logPath,
      KEY_FILE: keyPath,
      CERT_FILE: certPath,
      MOCK_SCENARIO: scenario,
    },
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
        PATH: `${binPath}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? "",
        TMPDIR: root,
        REAL_CURL: realCurl,
        CURL_CA_BUNDLE: certPath,
        KONG_URL: `https://127.0.0.1:${port}`,
        SUPABASE_SERVICE_ROLE_KEY: "contract-service-key",
        ANON_KEY: "contract-anon-key",
        ADMIN_EMAIL: scenario === "uppercase_admin_email"
          ? "First.Admin@Example.Test"
          : scenario === "multiple_at_admin_email"
            ? "first@admin@example.test"
            : "first.admin@example.test",
        ADMIN_PASSWORD: "FirstAdmin_0123456789abcdef!",
        ARIA_ALLOWED_EMAIL_DOMAIN: "example.test",
        ...overrides,
      },
      timeout: 30_000,
    });
    const events = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, events };
  } finally {
    server.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
}

const failures: string[] = [];

function check(name: string, verify: () => void) {
  try {
    verify();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL: ${name}`);
  }
}

function names(result: RunResult) {
  return result.events.map(({ event }) => event);
}

check("curl config is portable without a behavior-test compatibility shim", () => {
  assert.doesNotMatch(
    scriptSource,
    /fail-with-body = false/,
    "curl 8.7 treats the value as a file argument and exits 26; use no-fail-with-body",
  );
});

check("mutating requests are marked ambiguous before transport and cleared only after definitive completion", () => {
  assert.match(
    scriptSource,
    /MUTATION_OUTCOME_AMBIGUOUS=1\s+if CREATE_CODE=.*curl --config "\$CREATE_CONFIG"[\s\S]*?then\s+MUTATION_OUTCOME_AMBIGUOUS=0/,
  );
  assert.match(
    scriptSource,
    /MUTATION_OUTCOME_AMBIGUOUS=1\s+if ENSURE_CODE=.*curl --config "\$ENSURE_CONFIG"[\s\S]*?BOOTSTRAP_BOUND=1\s+MUTATION_OUTCOME_AMBIGUOUS=0/,
  );
});

const fresh = runScenario("fresh_success");
check("fresh bootstrap succeeds and proves the exact auth/profile/workspace binding", () => {
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /FIRST_ADMIN_VERIFIED role=admin domain=example\.test/);
  const eventNames = names(fresh);
  assert.ok(eventNames.includes("workspace.preflight"), "missing service-authority workspace preflight");
  assert.ok(eventNames.indexOf("workspace.preflight") < eventNames.indexOf("auth.create-attempted"));
  assert.ok(eventNames.includes("auth.create-marker-present"), "new auth identity has no cleanup marker");
  assert.ok(eventNames.includes("auth.signed-in"));
  assert.ok(eventNames.includes("workspace.binding-proved"));
  assert.ok(eventNames.includes("workspace.domain-proved"));
  assert.ok(eventNames.includes("profile.admin-proved"));
  assert.ok(eventNames.includes("role.admin-proved"));
});

const existingWorkspace = runScenario("existing_workspace");
check("an existing allowed-domain workspace with no active admin fails before auth creation", () => {
  assert.notEqual(existingWorkspace.status, 0, "unsafe existing-workspace bootstrap unexpectedly succeeded");
  assert.ok(names(existingWorkspace).includes("workspace.preflight"), "workspace existence was not checked");
  assert.ok(
    !names(existingWorkspace).includes("auth.create-attempted"),
    "POST /auth/v1/admin/users occurred before the existing-workspace guard",
  );
});

const domainMismatch = runScenario("workspace_domain_mismatch");
check("a workspace-domain mismatch fails closed before auth creation", () => {
  assert.notEqual(domainMismatch.status, 0, "mismatched workspace domain unexpectedly succeeded");
  assert.ok(names(domainMismatch).includes("workspace.preflight"), "workspace/domain response was not checked");
  assert.ok(
    !names(domainMismatch).includes("auth.create-attempted"),
    "POST /auth/v1/admin/users occurred despite a workspace-domain mismatch",
  );
});

const verificationFailure = runScenario("post_create_verification_failure");
check("post-create verification failure deletes only the exact marked new user and proves absence", () => {
  assert.notEqual(verificationFailure.status, 0, "invalid active-identity proof unexpectedly succeeded");
  const eventNames = names(verificationFailure);
  assert.ok(eventNames.includes("auth.create-marker-present"), "the new user was not uniquely marked");
  assert.ok(eventNames.includes("cleanup.user-marker-read"), "cleanup did not re-read the exact created user");
  const deletes = verificationFailure.events.filter(({ event }) => event === "cleanup.delete-attempted");
  assert.deepEqual(deletes, [
    {
      event: "cleanup.delete-attempted",
      id: "22222222-2222-4222-8222-222222222222",
      hardDelete: true,
    },
  ]);
  assert.ok(eventNames.includes("cleanup.user-deleted"));
  assert.ok(eventNames.includes("cleanup.user-absence-read"), "cleanup did not verify 404 absence");
  assert.ok(!eventNames.includes("cleanup.unsafe-user-target"));
});

const markerMismatch = runScenario("cleanup_marker_mismatch");
check("cleanup refuses to delete a created-id response whose marker no longer matches", () => {
  assert.notEqual(markerMismatch.status, 0);
  const eventNames = names(markerMismatch);
  assert.ok(eventNames.includes("cleanup.user-marker-read"));
  assert.ok(!eventNames.includes("cleanup.delete-attempted"), "mismatched cleanup marker was ignored");
});

const lostCreateResponse = runScenario("create_response_lost");
check("a committed create with a lost user id is recovered by exact email and marker before cleanup", () => {
  assert.notEqual(lostCreateResponse.status, 0);
  const eventNames = names(lostCreateResponse);
  assert.ok(eventNames.includes("auth.created"));
  assert.ok(eventNames.includes("cleanup.user-marker-list"));
  assert.ok(eventNames.includes("cleanup.user-marker-read"));
  assert.ok(eventNames.includes("cleanup.user-deleted"));
  assert.ok(eventNames.includes("cleanup.user-absence-read"));
});

const lostCreateTransport = runScenario("create_transport_lost");
check("an auth create with an ambiguous transport outcome is preserved for owner reconciliation", () => {
  assert.notEqual(lostCreateTransport.status, 0);
  const eventNames = names(lostCreateTransport);
  assert.ok(eventNames.includes("auth.created"));
  assert.ok(eventNames.includes("auth.create-transport-lost"));
  assert.ok(!eventNames.includes("cleanup.user-marker-list"));
  assert.ok(!eventNames.includes("cleanup.user-marker-read"));
  assert.ok(!eventNames.includes("cleanup.delete-attempted"));
});

const lostEnsureResponse = runScenario("ensure_workspace_committed_response_lost");
check("a committed workspace/admin bind with a lost RPC response is preserved for the next inventory pass", () => {
  assert.notEqual(lostEnsureResponse.status, 0);
  const eventNames = names(lostEnsureResponse);
  assert.ok(eventNames.includes("workspace.binding-proved"));
  assert.ok(!eventNames.includes("cleanup.user-marker-read"));
  assert.ok(!eventNames.includes("cleanup.bound-admin-read"));
  assert.ok(!eventNames.includes("cleanup.delete-attempted"), "a committed admin binding was destructively rolled back");
});

const lostEnsureTransport = runScenario("ensure_workspace_transport_lost");
check("an in-flight workspace mutation with a lost transport is never destructively cleaned up", () => {
  assert.notEqual(lostEnsureTransport.status, 0);
  const eventNames = names(lostEnsureTransport);
  assert.ok(eventNames.includes("workspace.binding-inflight"));
  assert.ok(!eventNames.includes("cleanup.user-marker-read"));
  assert.ok(!eventNames.includes("cleanup.bound-admin-read"));
  assert.ok(!eventNames.includes("cleanup.delete-attempted"));
});

for (const scenario of [
  "cleanup_binding_malformed",
  "cleanup_binding_two_rows",
  "cleanup_binding_http_error",
  "cleanup_binding_member",
  "cleanup_binding_wrong_domain",
]) {
  const uncertainBinding = runScenario(scenario);
  check(`cleanup fails closed for ${scenario.replaceAll("_", " ")}`, () => {
    assert.notEqual(uncertainBinding.status, 0);
    const eventNames = names(uncertainBinding);
    assert.ok(eventNames.includes("cleanup.user-marker-read"));
    assert.ok(eventNames.includes("cleanup.bound-admin-read"));
    assert.ok(
      !eventNames.includes("cleanup.delete-attempted"),
      `cleanup deleted a user while ${scenario} was unresolved`,
    );
  });
}

const uppercaseEmail = runScenario("uppercase_admin_email");
check("a non-canonical mixed-case administrator email fails before mutation", () => {
  assert.notEqual(uppercaseEmail.status, 0);
  assert.ok(!names(uppercaseEmail).includes("auth.create-attempted"));
});

const multipleAtEmail = runScenario("multiple_at_admin_email");
check("an administrator email with multiple at-signs fails before mutation", () => {
  assert.notEqual(multipleAtEmail.status, 0);
  assert.ok(!names(multipleAtEmail).includes("auth.create-attempted"));
});

const oversizedPassword = runScenario("fresh_success", { ADMIN_PASSWORD: "x".repeat(73) });
check("an administrator password above GoTrue's 72-byte maximum fails before mutation", () => {
  assert.notEqual(oversizedPassword.status, 0);
  assert.ok(!names(oversizedPassword).includes("auth.create-attempted"));
});

const createdLoginMismatch = runScenario("created_login_id_mismatch");
check("a fresh auth create cannot verify as a different signed-in identity", () => {
  assert.notEqual(createdLoginMismatch.status, 0);
  const eventNames = names(createdLoginMismatch);
  assert.ok(eventNames.includes("auth.created"));
  assert.ok(eventNames.includes("auth.signed-in"));
  assert.ok(!eventNames.includes("workspace.binding-proved"));
  assert.ok(eventNames.includes("cleanup.user-deleted"));
});

const existingUser = runScenario("existing_user_422");
check("an existing 422 auth user is never deleted after failed verification", () => {
  assert.notEqual(existingUser.status, 0, "invalid existing user unexpectedly verified");
  const eventNames = names(existingUser);
  assert.ok(eventNames.includes("auth.create-attempted"));
  assert.ok(!eventNames.includes("cleanup.delete-attempted"), "a pre-existing 422 user was deleted");
});

if (failures.length > 0) {
  console.error("\nprovision-first-admin behavior failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("provision-first-admin: behavior tests passed");
