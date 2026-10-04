import { NextResponse, type NextRequest } from "next/server";

import { classifySameOriginJsonRequest } from "./same-origin-json";

/**
 * Request-boundary guard for the swarm mutation handlers.
 *
 * The swarm POST routes reached `validateBody` directly, and `validateBody`
 * checks size and schema — it has no origin or media-type check. So a
 * cross-site form post carrying the caller's cookies could answer an
 * escalation, create a mission, or change the agent roster. Every other
 * hardened mutation route in this repo classifies the request first; these
 * three did not.
 *
 * Call this as the FIRST statement of the handler. That ordering is the
 * contract `classifySameOriginJsonRequest` states — before authentication,
 * parsing, or any side effect — and it is what makes the guard meaningful:
 * running it after a session lookup or an RPC would already have done the work
 * the guard exists to prevent.
 *
 * Returns null when the request may proceed, or the response to return.
 */
export function swarmRequestBoundary(req: NextRequest): NextResponse | null {
  const boundary = classifySameOriginJsonRequest(req);
  if (boundary === "ok") return null;
  return boundary === "unsupported_media_type"
    ? NextResponse.json({ ok: false, error: "Expected application/json." }, { status: 415 })
    : NextResponse.json({ ok: false, error: "Cross-origin request rejected." }, { status: 403 });
}
