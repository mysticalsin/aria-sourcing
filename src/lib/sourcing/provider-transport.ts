import "server-only";

export const SOURCING_PROVIDER_HOSTS = Object.freeze({
  GitHub: "api.github.com",
  Apify: "api.apify.com",
  Apollo: "api.apollo.io",
  Seamless: "api.seamless.ai",
  Sillage: "api.getsillage.com",
  Tavily: "api.tavily.com",
  DuckDuckGo: "api.duckduckgo.com",
  /** Placeholder host — real host comes from SMART_API_BASE_URL at request time. */
  SMART: "smart.local",
} as const);

export type SourcingProvider = keyof typeof SOURCING_PROVIDER_HOSTS;
export type ProviderClearanceKind = "discovery" | "identity" | "probe";

declare const CLEARANCE: unique symbol;

export type ProviderClearance = Readonly<{
  provider: SourcingProvider;
  kind: ProviderClearanceKind;
  [CLEARANCE]: true;
}>;

export function mintProviderClearance(
  provider: SourcingProvider,
  kind: ProviderClearanceKind,
): ProviderClearance {
  return { provider, kind } as ProviderClearance;
}

/**
 * Resolve the hostname a sourcing provider is allowed to call.
 * SMART uses SMART_API_BASE_URL (server-only); other providers are fixed.
 */
export function resolveSourcingProviderHost(provider: SourcingProvider): string {
  if (provider === "SMART") {
    const base = process.env.SMART_API_BASE_URL?.trim();
    if (!base) return SOURCING_PROVIDER_HOSTS.SMART;
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      return SOURCING_PROVIDER_HOSTS.SMART;
    }
  }
  return SOURCING_PROVIDER_HOSTS[provider];
}

export async function sourcingFetch(
  clearance: ProviderClearance,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input));
  const allowed = resolveSourcingProviderHost(clearance.provider);
  if (url.hostname.toLowerCase() !== allowed) {
    throw new Error(`Sourcing provider clearance mismatch for ${url.hostname}.`);
  }
  return fetch(url, init);
}
