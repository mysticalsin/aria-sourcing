export type FlowiseProxyPolicy = { ok: false; reason: string };

/**
 * Public Flowise proxying is not an authority boundary. The private adapter
 * resolves server-owned workflow bindings and never accepts a browser flow ID.
 */
export function getFlowiseProxyPolicy(_method: string, _path: readonly string[]): FlowiseProxyPolicy {
  return { ok: false, reason: "Public Flowise proxying is disabled." };
}
