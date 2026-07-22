import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/settings/need-ingress-credentials-panel.tsx", import.meta.url);
const settingsPath = new URL("../src/app/settings/page.tsx", import.meta.url);
const routePath = new URL("../src/app/api/admin/need-ingress/credentials/route.ts", import.meta.url);

test("Settings exposes tenant need-ingress credentials as admin-only server authority", async () => {
  const [panel, settings] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(settingsPath, "utf8"),
  ]);

  assert.match(settings, /NeedIngressCredentialsPanel/);
  assert.match(settings, /Need ingress credentials/i);
  assert.match(panel, /can\(role,\s*["']manage_settings["']\)/);
  assert.match(panel, /\/api\/admin\/need-ingress\/credentials/);
  assert.match(panel, /credentials:\s*["']same-origin["']/);
});

test("the browser generates an exact 256-bit opaque key and sends only its lowercase SHA-256 digest", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(panel, /aria_need_v1_/);
  assert.match(panel, /crypto\.subtle\.digest\(["']SHA-256["']/);
  assert.match(panel, /byte\.toString\(16\)\.padStart\(2,\s*["']0["']\)/);
  assert.match(panel, /keySha256/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(panel, /body:\s*JSON\.stringify\([^)]*(?:rawCredential|credentialKey|rawKey)/s);
});

test("the one-time reveal documents the exact signed ingress boundary", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /one time/i);
  assert.match(panel, /\/api\/webhooks\/needs/);
  assert.match(panel, /X-ARIA-Need-Key/);
  assert.match(panel, /X-ARIA-Need-Timestamp/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /X-ARIA-Need-Signature/);
  assert.match(panel, /7 days/);
  assert.match(panel, /30 days/);
  assert.match(panel, /90 days/);
});

test("the server never accepts, selects, returns, or logs a raw credential", async () => {
  const route = await readFile(routePath, "utf8");

  assert.match(route, /id,label,status,expires_at,created_at,revoked_at/);
  assert.match(route, /\.eq\(["']workspace_id["'],\s*context\.workspaceId\)/);
  assert.match(route, /create_need_ingress_credential/);
  assert.match(route, /revoke_need_ingress_credential/);
  assert.match(route, /classifySameOriginJsonRequest/);
  assert.match(route, /maxBytes:\s*2_000/);
  assert.doesNotMatch(route, /key_sha256[^\n]*select|select\([^)]*key_sha256/i);
  assert.doesNotMatch(route, /rawCredential|credentialKey|rawKey|console\.|safeLog/);
});
