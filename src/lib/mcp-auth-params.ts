import { AUTH_QUERY_PARAMS, type AuthQueryParam } from "./types";

const AUTH_QUERY_PARAM_SET = new Set<string>(AUTH_QUERY_PARAMS.map((p) => p.toLowerCase()));

export function findAuthQueryParamInUrl(url: string): AuthQueryParam | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const key of parsed.searchParams.keys()) {
    if (AUTH_QUERY_PARAM_SET.has(key.toLowerCase())) return key as AuthQueryParam;
  }
  return null;
}

export function validateMcpBaseUrlHasNoAuthQueryParam(url: string): { ok: true } | { ok: false; error: string } {
  const param = findAuthQueryParamInUrl(url);
  if (!param) return { ok: true };
  return { ok: false, error: `MCP server URL must not contain ${param}; store the secret in the key vault.` };
}
