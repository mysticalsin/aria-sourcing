import "server-only";

export const SOURCING_PROVIDER_HOSTS = Object.freeze({
  GitHub: "api.github.com",
  Apify: "api.apify.com",
  Apollo: "api.apollo.io",
  Seamless: "api.seamless.ai",
  Sillage: "api.getsillage.com",
  Tavily: "api.tavily.com",
  DuckDuckGo: "api.duckduckgo.com",
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

export async function sourcingFetch(
  clearance: ProviderClearance,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname.toLowerCase() !== SOURCING_PROVIDER_HOSTS[clearance.provider]) {
    throw new Error(`Sourcing provider clearance mismatch for ${url.hostname}.`);
  }
  return fetch(url, init);
}
