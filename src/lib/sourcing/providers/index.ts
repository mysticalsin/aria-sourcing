import type { SourcePlatform } from "@/lib/types";
import { githubProvider } from "./github";
import { linkedinProfilesProvider } from "./linkedin-profiles";
import { smartProvider } from "./smart";
import {
  behanceProvider,
  dribbbleProvider,
  linkedinWebProvider,
  stackOverflowProvider,
} from "./web";
import type { ProviderContext, SourcingProvider, SourcingProviderId } from "./types";

const ALL_PROVIDERS: SourcingProvider[] = [
  smartProvider,
  linkedinProfilesProvider,
  githubProvider,
  linkedinWebProvider,
  stackOverflowProvider,
  dribbbleProvider,
  behanceProvider,
];

const BY_ID = new Map(ALL_PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id: SourcingProviderId): SourcingProvider | undefined {
  return BY_ID.get(id);
}

export function listProviders(): SourcingProvider[] {
  return [...ALL_PROVIDERS];
}

export async function availableProviders(ctx: ProviderContext): Promise<SourcingProvider[]> {
  const out: SourcingProvider[] = [];
  for (const provider of ALL_PROVIDERS) {
    if (await provider.isAvailable(ctx)) out.push(provider);
  }
  return out;
}

export function providersForCampaign(
  available: SourcingProvider[],
  primaryPlatforms: SourcePlatform[],
): SourcingProvider[] {
  const primary = primaryPlatforms[0] ?? "GitHub";
  const byId = new Map(available.map((p) => [p.id, p]));
  const pick = (...ids: SourcingProviderId[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is SourcingProvider => Boolean(p));

  const withSmart = (rest: SourcingProvider[]) => {
    const smart = byId.get("smart");
    if (!smart) return rest;
    if (rest.some((p) => p.id === "smart")) return rest;
    return [smart, ...rest];
  };

  if (primary === "SMART" || primary === "Talent Pool") {
    return withSmart(pick("smart", "linkedin_profiles", "linkedin_web", "github"));
  }
  if (primary === "Dribbble") {
    return withSmart(pick("dribbble", "linkedin_profiles", "linkedin_web", "behance"));
  }
  if (primary === "Behance") {
    return withSmart(pick("behance", "linkedin_profiles", "linkedin_web", "dribbble"));
  }
  if (primary === "Stack Overflow") {
    return withSmart(pick("stackoverflow", "linkedin_profiles", "linkedin_web", "github"));
  }
  if (primary === "GitHub") {
    return withSmart(pick("github", "linkedin_profiles", "linkedin_web"));
  }
  return withSmart(pick("linkedin_profiles", "linkedin_web", "github"));
}

export type { ProviderContext, SourcingProvider, SourcingProviderId } from "./types";
