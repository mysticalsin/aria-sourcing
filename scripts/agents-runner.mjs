#!/usr/bin/env node
/* ============================================================================
   ARIA agents runner (ADR 0002): the `agents` service's whole program.

   A clock, nothing else: it calls POST {ARIA_APP_URL}/api/agent/tick with
   the shared AGENT_RUNNER_SECRET, again at once while the app answers
   `more: true` (bounded per wake), then sleeps. Every decision, read and
   write happens in the app, behind its authority checks. This process holds
   no database credential and no model key.

   Env: ARIA_APP_URL (default http://app:3000), AGENT_RUNNER_SECRET,
        AGENT_TICK_SECONDS (default 60), AGENT_MAX_STEPS_PER_WAKE (default 25).
   ========================================================================== */

const appUrl = (process.env.ARIA_APP_URL || "http://app:3000").replace(/\/+$/, "");
const secret = process.env.AGENT_RUNNER_SECRET || "";
const tickSeconds = Math.max(10, Number(process.env.AGENT_TICK_SECONDS) || 60);
const maxSteps = Math.max(1, Number(process.env.AGENT_MAX_STEPS_PER_WAKE) || 25);
const disabledSeconds = 300;
const requestTimeoutMs = 300_000;

let stopping = false;
let wake = null;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    log("stopping", { signal });
    wake?.();
  });
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

function sleep(seconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, seconds * 1000);
    wake = () => { clearTimeout(timer); resolve(); };
  });
}

async function tick() {
  const res = await fetch(`${appUrl}/api/agent/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  log("start", { appUrl, tickSeconds, maxSteps, secret: secret ? "set" : "missing" });
  while (!stopping) {
    let pause = tickSeconds;
    for (let step = 0; step < maxSteps && !stopping; step++) {
      let result;
      try {
        result = await tick();
      } catch (cause) {
        log("unreachable", { error: cause instanceof Error ? cause.message : String(cause) });
        break;
      }
      const { status, body } = result;
      if (status === 503 && body.disabled) {
        log("disabled", { error: body.error });
        pause = disabledSeconds;
        break;
      }
      if (status === 409 && body.busy) break;
      if (status !== 200 || !body.ok) {
        log("tick-error", { status, error: body.error });
        break;
      }
      if (body.action !== "idle" || body.followUps) {
        log("tick", { action: body.action, detail: body.detail, followUps: body.followUps });
      }
      if (!body.more) break;
    }
    if (!stopping) await sleep(pause);
  }
  log("stopped");
}

await main();
