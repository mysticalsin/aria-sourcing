import type { SourcePlatform } from "@/lib/types";
import { githubProvider } from "./github";
import { linkedinProfilesProvider } from "./linkedin-profiles";
import {
  behanceProvider,
  dribbbleProvider,
  linkedinWebProvider,
  stackOverflowProvider,
} from "./web";
import type { ProviderContext, SourcingProvider, SourcingProviderId } from "./types";

const ALL_PROVIDERS: SourcingProvider[] = [
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

/** Providers available for this workspace/request (missing connector keys drop out). */
export async function availableProviders(ctx: ProviderContext): Promise<SourcingProvider[]> {
  const out: SourcingProvider[] = [];
  for (const provider of ALL_PROVIDERS) {
    if (await provider.isAvailable(ctx)) out.push(provider);
  }
  return out;
}

/**
 * Pick which backends to run for a campaign based on primary platforms.
 * LinkedIn always includes profile search (when keyed) + web SERP.
 */
export function providersForCampaign(
  available: SourcingProvider[],
  primaryPlatforms: SourcePlatform[],
): SourcingProvider[] {
  const primary = primaryPlatforms[0] ?? "GitHub";
  const byId = new Map(available.map((p) => [p.id, p]));
  const pick = (...ids: SourcingProviderId[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is SourcingProvider => Boolean(p));

  if (primary === "Dribbble") return pick("dribbble", "linkedin_profiles", "linkedin_web", "behance");
  if (primary === "Behance") return pick("behance", "linkedin_profiles", "linkedin_web", "dribbble");
  if (primary === "Stack Overflow") {
    return pick("stackoverflow", "linkedin_profiles", "linkedin_web", "github");
  }
  if (primary === "GitHub") {
    return pick("github", "linkedin_profiles", "linkedin_web");
  }
  // LinkedIn / Talent Pool / Referral / default → professional networks first
  return pick("linkedin_profiles", "linkedin_web", "github");
}

export type { ProviderContext, SourcingProvider, SourcingProviderId } from "./types";
