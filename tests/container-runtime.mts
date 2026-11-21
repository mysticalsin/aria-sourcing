import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureContainerRuntime } from "../scripts/container-runtime.mjs";
import { supabaseConnectSources } from "../next.config.mjs";
import { isLoopbackHttpOrigin } from "../src/lib/supabase/config";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aria-container-runtime-"));
  const metadataPath = join(root, "image.json");
  const environment = { ARIA_RELEASE_SHA: "a".repeat(40), ARIA_EXPECTED_MIGRATION: "0002_test.sql" };
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ARIA_LOCAL_DEMO: "true", NEXT_PUBLIC_APP_URL: "http://localhost:3101", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54331", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key" };
  writeFileSync(metadataPath, JSON.stringify({ environment, publicConfig: { NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, anonKeySha256: createHash("sha256").update(env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).digest("hex") } }));
  return { root, env, configDirectory: join(root, "config"), metadataPath };
}

test("local restart retains the encryption key and loads immutable image identity", () => {
  const f = fixture();
  try {
    configureContainerRuntime(f);
    const first = f.env.DATA_ENCRYPTION_KEY;
    assert.equal(Buffer.from(first!, "base64").length, 32);
    assert.equal(f.env.ARIA_RELEASE_SHA, "a".repeat(40));
    delete f.env.DATA_ENCRYPTION_KEY;
    configureContainerRuntime(f);
    assert.equal(f.env.DATA_ENCRYPTION_KEY, first);
    assert.equal(readFileSync(join(f.configDirectory, "data-encryption-key"), "utf8").trim(), first);
    f.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.throws(() => configureContainerRuntime(f), /differs from the persisted/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("wrong image identity, public URL, and corrupt keys fail before app startup", () => {
  for (const change of [
    { ARIA_RELEASE_SHA: "b".repeat(40) },
    { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:9999" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "different-public-key" },
    { DATA_ENCRYPTION_KEY: "invalid" },
    { ARIA_LOCAL_DEMO: "false" },
  ]) {
    const f = fixture();
    try { Object.assign(f.env, change); assert.throws(() => configureContainerRuntime(f)); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("configured HTTPS backend and custom loopback ports drive CSP and cookie policy", () => {
  assert.deepEqual(supabaseConnectSources("http://localhost:54331"), ["http://localhost:54331", "ws://localhost:54331"]);
  assert.deepEqual(supabaseConnectSources("https://backend.example.test"), ["https://backend.example.test", "wss://backend.example.test"]);
  assert.throws(() => supabaseConnectSources("https://user:secret@example.test"));
  assert.throws(() => supabaseConnectSources("https://example.test/?token=secret"));
  assert.equal(isLoopbackHttpOrigin("http://localhost:3101"), true);
  assert.equal(isLoopbackHttpOrigin("http://127.0.0.1:3000"), true);
  for (const origin of [undefined, "http://example.test", "https://example.test", "http://localhost.evil.test", "http://user:secret@localhost", "http://localhost/path"]) assert.equal(isLoopbackHttpOrigin(origin), false);
});

test("the recruitment addon names opt-out, erasure, and a pipeline page", () => {
  const applicant = readFileSync("odoo_addons/aria_recruitment/models/applicant.py", "utf8");
  const views = readFileSync("odoo_addons/aria_recruitment/views/applicant_views.xml", "utf8");
  const controller = readFileSync("odoo_addons/aria_recruitment/controllers/pipeline.py", "utf8");
  assert.match(applicant, /string='Opt-out'/);
  assert.match(views, /Erasure/);
  assert.match(controller, /opt-out/);
  assert.match(controller, /[Ee]rasure/);
  assert.match(controller, /\/aria\/pipeline/);
});

test("the bridge rule never changes a Mac firewall and skips outside a sandbox", () => {
  const script = new URL("../scripts/sandbox-bridge.sh", import.meta.url);
  const run = (env: NodeJS.ProcessEnv) =>
    execFileSync("sh", [script.pathname], {
      env: {
        PATH: process.env.PATH ?? "",
        SANDBOX_UNAME: env.SANDBOX_UNAME,
        CI: env.CI,
        GITHUB_ACTIONS: env.GITHUB_ACTIONS,
        CURSOR_AGENT: env.CURSOR_AGENT,
        ARIA_SANDBOX: env.ARIA_SANDBOX,
      },
      encoding: "utf8",
    }).trim();
  assert.match(run({ SANDBOX_UNAME: "Darwin", CI: "true", CURSOR_AGENT: "1" }), /skip:.*macOS/);
  assert.match(run({ SANDBOX_UNAME: "Linux" }), /skip:.*sandbox/);
  assert.equal(run({ SANDBOX_UNAME: "Linux", CI: "true" }), "apply");
  assert.equal(run({ SANDBOX_UNAME: "Linux", CURSOR_AGENT: "1" }), "apply");
});

test("the ingest image does not pin the withdrawn poppler revision", () => {
  const docker = readFileSync(new URL("../services/ingest/Dockerfile", import.meta.url), "utf8");
  assert.doesNotMatch(docker, /poppler-utils=22\.12\.0-2\+deb12u2/);
});
