export type HermesAccessDecision =
  | { ok: true; status: 200 }
  | { ok: false; status: 403 | 405 | 503; reason: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Non-admin-readable runtime paths. `api/health` was listed here but exists on
// neither upstream process — the aiohttp gateway serves `/health` — so it was
// dead weight, not the load-bearing public read it looked like. Replaced with
// the path that does exist; api/status and api/system/stats are unaffected and
// were always the working public reads.
const PUBLIC_RUNTIME_READS = new Set(["api/status", "api/system/stats", "health"]);

/**
 * One global Hermes process is not multi-tenant. Production may expose it only
 * to the workspace explicitly bound by the deployment owner. The workspace id
 * comes from the authenticated database session, never from request data.
 */
export function evaluateHermesWorkspaceBinding(input: {
  production: boolean;
  supabaseEnabled: boolean;
  workspaceId: string | null | undefined;
  boundWorkspaceId: string | null | undefined;
}): HermesAccessDecision {
  if (!input.production) return { ok: true, status: 200 };
  if (!input.supabaseEnabled) {
    return { ok: false, status: 503, reason: "Aria runtime requires authenticated workspace identity." };
  }
  if (!input.boundWorkspaceId || !UUID_PATTERN.test(input.boundWorkspaceId)) {
    return { ok: false, status: 503, reason: "Aria runtime is not tenant-isolated." };
  }
  if (!input.workspaceId || input.workspaceId !== input.boundWorkspaceId) {
    return { ok: false, status: 403, reason: "Aria runtime is not available for this workspace." };
  }
  return { ok: true, status: 200 };
}

/**
 * The generic proxy is read-only in production. Typed server routes own every
 * mutation and chat schema; sensitive runtime reads remain admin-only.
 */
export function evaluateHermesProxyOperation(input: {
  production: boolean;
  method: string;
  upstreamPath: string;
  canManageSettings: boolean;
}): HermesAccessDecision {
  if (!input.production) return { ok: true, status: 200 };
  if (input.method.toUpperCase() !== "GET") {
    return { ok: false, status: 405, reason: "Generic Aria runtime mutations are disabled." };
  }
  if (!PUBLIC_RUNTIME_READS.has(input.upstreamPath) && !input.canManageSettings) {
    return { ok: false, status: 403, reason: "Admins only." };
  }
  return { ok: true, status: 200 };
}
