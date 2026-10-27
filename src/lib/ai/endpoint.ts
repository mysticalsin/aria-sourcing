import { isAllowedProviderUrl } from "@/lib/api/url";
import { CLOUD_ENDPOINT, type AiProviderSlug } from "./provider";

/** Resolve egress server-side; custom endpoints never bypass the private-host guard. */
export function resolveProviderEndpoint(provider: AiProviderSlug, baseUrl?: string): string {
  if (provider !== "local") return CLOUD_ENDPOINT[provider];
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  const validation = isAllowedProviderUrl(base);
  if (!validation.ok) throw new Error(`Invalid local provider URL: ${validation.reason}`);
  return `${base}/chat/completions`;
}
