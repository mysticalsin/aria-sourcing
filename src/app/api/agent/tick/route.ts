import { NextResponse, type NextRequest } from "next/server";
import { agentsEnabled, runnerAuthorized, serviceClient } from "@/lib/agents/server/authority";
import { tickDeps } from "@/lib/agents/server/deps";
import { runTick } from "@/lib/agents/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A web search step can take two minutes; the runner waits longer than that.
export const maxDuration = 300;

/** One tick at a time per app instance: the runner is sequential, a second caller waits its turn. */
let busy = false;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The agents runner's clock (ADR 0002). Bearer AGENT_RUNNER_SECRET only:
 * no cookie, no browser. Each call does one bounded unit of work; `more`
 * tells the runner to call again at once.
 */
export async function POST(req: NextRequest) {
  if (!agentsEnabled()) return json({ ok: false, disabled: true, error: "Agents are off (AGENTS_ENABLED, AGENT_RUNNER_SECRET)." }, 503);
  if (!runnerAuthorized(req)) return json({ ok: false }, 401);
  const svc = serviceClient();
  if (!svc) return json({ ok: false, error: "Service client unavailable." }, 503);
  if (busy) return json({ ok: false, busy: true }, 409);
  busy = true;
  try {
    const result = await runTick(tickDeps(svc));
    return json({ ok: true, ...result });
  } catch (cause) {
    // Messages are ours (no row content); keep them short.
    const message = cause instanceof Error ? cause.message.slice(0, 200) : "Tick failed.";
    console.error("[agents] tick failed", message);
    return json({ ok: false, error: message }, 500);
  } finally {
    busy = false;
  }
}
