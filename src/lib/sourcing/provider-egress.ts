import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import {
  mintProviderClearance,
  SOURCING_PROVIDER_HOSTS,
  type ProviderClearance,
  type ProviderClearanceKind,
  type SourcingProvider,
} from "@/lib/sourcing/provider-transport";
import { prohibitedCriteriaViolation, validateSourcingCriteria } from "@/lib/sourcing/query-policy";
import type { SourcePlatform } from "@/lib/types";
export type { ProviderClearance, ProviderClearanceKind, SourcingProvider } from "@/lib/sourcing/provider-transport";

type ClearanceResult = { ok: true; clearance: ProviderClearance } | { ok: false; error: string };

function mint(provider: SourcingProvider, kind: ProviderClearanceKind): ProviderClearance {
  return mintProviderClearance(provider, kind);
}

function providerForPlatform(platform: SourcePlatform): SourcingProvider | null {
  return platform in SOURCING_PROVIDER_HOSTS ? (platform as SourcingProvider) : null;
}

export function clearDiscoveryCriteria(
  platform: SourcePlatform,
  criteria: Record<string, string | string[]>,
  campaign: CandidateMappingCampaign,
): ClearanceResult {
  const policy = validateSourcingCriteria(platform, criteria, campaign);
  if (!policy.ok) return policy;
  const provider = providerForPlatform(platform);
  if (!provider) return { ok: false, error: `${platform} has no external sourcing provider.` };
  return { ok: true, clearance: mint(provider, "discovery") };
}

export function clearIdentityResolution(
  provider: SourcingProvider,
  criteria: Record<string, string | string[]>,
): ClearanceResult {
  const values = Object.values(criteria)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return { ok: false, error: "Provider identity lookup is invalid." };
  for (const value of values) {
    const violation = prohibitedCriteriaViolation(value);
    if (violation === "control_chars" || violation === "too_long" || violation === "injection") {
      return { ok: false, error: "Provider identity lookup is invalid." };
    }
  }
  return { ok: true, clearance: mint(provider, "identity") };
}

export function clearProviderProbe(provider: SourcingProvider): ProviderClearance {
  return mint(provider, "probe");
}
