import "server-only";
import type { SourcingWorkspace, UnifiedProviders } from "./unified-run";
import { searchGithubUsers } from "./github";
import { searchLinkedInWithClaude, webSearchAnthropicConfig } from "./claude-web-search";
import { validateSourcingQuery } from "./query-policy";
import { aiBudgetStatus, recordAiUsage } from "@/lib/ai/usage";

/**
 * The providers of a durable campaign run (GitHub, then Claude web search over
 * public LinkedIn profiles). `resolveAnthropicKey` turns the workspace's
 * configured vault key id into the secret: the signed-in operator's vault
 * read on the route, the delegating user's workspace for the agents runner.
 */
export function unifiedProviders(
  readWorkspace: () => Promise<SourcingWorkspace>,
  resolveAnthropicKey: (apiKeyId: string | undefined) => Promise<string>,
): UnifiedProviders {
  return {
    github: (clearance, query, count, signal) => searchGithubUsers(clearance, query, count, process.env.GITHUB_TOKEN ?? "", signal),
    webSearch: async (clearance, query, count, campaign, signal) => {
      const config = webSearchAnthropicConfig((await readWorkspace()).state.settings);
      const key = config ? await resolveAnthropicKey(config.apiKeyId) : "";
      if (!config || !key) return { ok: false, error: "Add an Anthropic key in Settings → AI & Models before searching the web." };
      const budget = aiBudgetStatus();
      if (!budget.ok) return { ok: false, error: `${budget.reason} No search was made.` };
      const outcome = await searchLinkedInWithClaude(clearance, key, { query, limit: count, model: config.model, signal,
        role: campaign.jobAnalysis.title, location: campaign.jobAnalysis.location ?? "",
        queryAllowed: (q) => validateSourcingQuery("LinkedIn", q, campaign).ok });
      recordAiUsage({ task: "sourcing", activity: "web-sourcing", model: config.model, usage: outcome.usage });
      if (outcome.ok) return { ok: true, hits: outcome.hits };
      return { ok: false, error: outcome.reason === "refused"
        ? "Anthropic refused the web search. Check the key, its credits and that web search is enabled for your Anthropic organization."
        : "Web search is temporarily unavailable. Start a new run later; no automatic retry was made." };
    },
  };
}
