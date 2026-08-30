import type { Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import type { WebFetch } from "@/lib/ai/web-tools";

/** Internal backend ids — never shown to operators as vendor brands. */
export type SourcingProviderId =
  | "github"
  | "linkedin_profiles"
  | "linkedin_web"
  | "stackoverflow"
  | "dribbble"
  | "behance"
  | "smart";

export interface ProviderContext {
  campaign: CandidateMappingCampaign & {
    sourcingStrategy: CandidateMappingCampaign["sourcingStrategy"] & {
      githubQueries?: { query: string }[];
      primaryPlatforms?: SourcePlatform[];
      linkedinBoolean?: string;
    };
  };
  existing: CandidateDedupeIdentity[];
  weights: ScoringWeights;
  githubToken: string;
  tavilyKey?: string;
  /** Decrypted LinkedIn-profile-search connector token (Apify under the hood). */
  linkedInProfileToken?: string | null;
  /** Decrypted SMART resume-DB API key (or env fallback). */
  smartApiKey?: string | null;
  webFetchImpl?: WebFetch;
  signal?: AbortSignal;
  beforeExternalCall?: () => Promise<boolean>;
}

export interface ProviderSearchInput {
  query: string;
  count: number;
  ctx: ProviderContext;
}

export interface ProviderSearchResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
  ok: boolean;
  error?: string;
}

export interface SourcingProvider {
  id: SourcingProviderId;
  /** Operator-facing label stamped on Candidate.sourcePlatform — never "Apify". */
  displayPlatform: SourcePlatform;
  /** Richer hits win over thin SERP when both match the same person. */
  richness: "profile" | "serp" | "identity";
  isAvailable(ctx: ProviderContext): boolean | Promise<boolean>;
  search(input: ProviderSearchInput): Promise<ProviderSearchResult>;
}
