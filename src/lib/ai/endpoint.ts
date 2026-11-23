import { assertProviderUrlPublic, isAllowedProviderUrl } from "@/lib/api/url";
import { CLOUD_ENDPOINT, type AiProviderSlug } from "./provider";

/** Resolve egress server-side; custom endpoints never bypass the private-host guard. */
export function resolveProviderEndpoint(provider: AiProviderSlug, baseUrl?: string): string {
  if (provider !== "local") return CLOUD_ENDPOINT[provider];
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  const validation = isAllowedProviderUrl(base);
  if (!validation.ok) throw new Error(`Invalid local provider URL: ${validation.reason}`);
  return `${base}/chat/completions`;
}

type HostLookup = (
  hostname: string,
  options: { all: true },
) => Promise<readonly { address: string; family: number }[]>;

/**
 * Local model base URL from ARIA_LOCAL_MODEL_BASE_URL only.
 * The request body is not a source. A named host must resolve to public addresses.
 */
export async function resolveServerProviderEndpoint(
  provider: AiProviderSlug,
  options: { lookupImpl?: HostLookup } = {},
): Promise<string> {
  if (provider !== "local") return CLOUD_ENDPOINT[provider];
  const base = (process.env.ARIA_LOCAL_MODEL_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const validation = await assertProviderUrlPublic(base, options.lookupImpl);
  if (!validation.ok) throw new Error(`Invalid local provider URL: ${validation.reason}`);
  return `${base}/chat/completions`;
}
