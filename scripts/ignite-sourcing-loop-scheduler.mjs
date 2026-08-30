#!/usr/bin/env node
/**
 * ignite-sourcing-loop-scheduler.mjs
 *
 * Calls POST /api/cron/ignite-sourcing-loop once per workspace listed in
 * ARIA_LOOP_WORKSPACE_IDS (comma-separated UUIDs). Intended for Fly cron /
 * GitHub Actions / systemd timers. Does not flip kill switches — that remains
 * an owner action after Phase 0 proofs are green.
 *
 * Required env:
 *   ARIA_WEB_INTERNAL_URL or ARIA_WEB_URL  — base URL of the web process
 *   CRON_SECRET                           — shared cron bearer
 *   ARIA_LOOP_WORKSPACE_IDS               — comma-separated workspace UUIDs
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    console.error(JSON.stringify({ ok: false, error: `missing_env:${name}` }));
    process.exit(78);
  }
  return String(value).trim();
}

function baseUrl() {
  const raw = process.env.ARIA_WEB_INTERNAL_URL || process.env.ARIA_WEB_URL || "";
  if (!raw.trim()) {
    console.error(JSON.stringify({ ok: false, error: "missing_env:ARIA_WEB_INTERNAL_URL" }));
    process.exit(78);
  }
  return raw.replace(/\/$/, "");
}

async function igniteOne(workspaceId, secret, urlBase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${urlBase}/api/cron/ignite-sourcing-loop`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-aria-workspace-id": workspaceId,
        "content-type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { workspaceId, status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const secret = requireEnv("CRON_SECRET");
  const ids = requireEnv("ARIA_LOOP_WORKSPACE_IDS")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error(JSON.stringify({ ok: false, error: "no_workspaces" }));
    process.exit(78);
  }
  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      console.error(JSON.stringify({ ok: false, error: "invalid_workspace_id", id }));
      process.exit(78);
    }
  }

  const url = baseUrl();
  const results = [];
  for (const workspaceId of ids) {
    results.push(await igniteOne(workspaceId, secret, url));
  }
  const failed = results.filter((row) => !row.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  process.exit(1);
});
