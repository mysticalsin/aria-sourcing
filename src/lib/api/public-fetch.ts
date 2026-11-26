import { assertPublicUrl } from "@/lib/api/url";

/**
 * Live transport for the hire connectors. Calls the URL the operator configured.
 * Refuses non-https, private, and metadata hosts before any socket is opened.
 * Does not log the URL or the request body.
 */
export async function fetchPublicUrl(url: string, init?: RequestInit): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Blocked URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Blocked URL.");
  }
  const check = await assertPublicUrl(url);
  if (!check.ok) throw new Error("Blocked URL.");
  const redirect = init?.redirect === "error" || init?.redirect === "manual" ? init.redirect : "manual";
  return fetch(parsed.toString(), { ...init, redirect });
}
