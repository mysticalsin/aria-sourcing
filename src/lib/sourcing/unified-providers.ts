import "server-only";
import type { SourcingWorkspace, UnifiedProviders } from "./unified-run";
import { searchGithubUsers } from "./github";

/**
 * Providers for a durable campaign run. GitHub stays. LinkedIn web search
 * (Claude's web_search tool scoped to linkedin.com) is disabled: Aria does
 * not call linkedin.com. The unused arguments keep the call-site signature.
 */
export function unifiedProviders(
  _readWorkspace: () => Promise<SourcingWorkspace>,
  _resolveAnthropicKey: (apiKeyId: string | undefined) => Promise<string>,
): UnifiedProviders {
  return {
    github: (clearance, query, count, signal) => searchGithubUsers(clearance, query, count, process.env.GITHUB_TOKEN ?? "", signal),
    webSearch: async () => ({ ok: false, error: "LinkedIn web search is disabled." }),
  };
}
