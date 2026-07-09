export type FlowiseProxyPolicy =
  | { ok: true; flowId: string }
  | { ok: false; reason: string };

/**
 * ARIA can safely proxy inference only when the requested Flowise flow is
 * bound to the caller's workspace by agent_specs. Flow authoring and API-key
 * management remain disabled until Flowise has per-workspace isolation.
 */
export function getFlowiseProxyPolicy(method: string, path: readonly string[]): FlowiseProxyPolicy {
  if (method !== "POST") return { ok: false, reason: "Only POST prediction requests are allowed." };
  if (path.length !== 2 || path[0] !== "prediction") {
    return { ok: false, reason: "Only a single prediction flow is allowed." };
  }
  const flowId = path[1] ?? "";
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(flowId)) {
    return { ok: false, reason: "Invalid Flowise flow ID." };
  }
  return { ok: true, flowId };
}
