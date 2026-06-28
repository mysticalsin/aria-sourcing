import { NextResponse } from "next/server";

/**
 * Health / monitoring probe.
 *
 * Minimal, unauthenticated liveness response. Intentionally exposes no internal
 * configuration (Node version, env flags, supabase/hermes status) so it is safe
 * to poll publicly from an uptime monitor or a local `watch curl`. Use as the
 * liveness check in the OPERATIONS_RUNBOOK uptime canary.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, status: "healthy", time: new Date().toISOString() },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
