type McpBaseUrlValidation = { ok: true } | { ok: false; error: string };

export function validateMcpBaseUrl(url: string): McpBaseUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "MCP server URL must be a valid absolute HTTPS URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "MCP server URL must use HTTPS." };
  if (parsed.port && parsed.port !== "443") {
    return { ok: false, error: "MCP server URL must use the standard HTTPS port 443." };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "MCP server URL must not contain embedded credentials." };
  if (!parsed.searchParams.keys().next().done) return { ok: false, error: "MCP server URL must not contain query parameters." };
  if (parsed.hash) return { ok: false, error: "MCP server URL must not contain a fragment." };
  return { ok: true };
}
