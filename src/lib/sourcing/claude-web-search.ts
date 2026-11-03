import "server-only";
import { DEFAULT_MODEL, anthropicHeaders, anthropicSupportsEffort, resolveAiProvider, type AiProviderSettings } from "@/lib/ai/provider";
import type { AnthropicUsage } from "@/lib/ai/usage";
import { SOURCING_PROVIDER_HOSTS, sourcingFetch, type ProviderClearance } from "./provider-transport";
import { webSearchBudget } from "./unified-contract";
import type { SearchHit } from "./web-leads";

/* LinkedIn discovery through Claude's server-side web search.

   Claude searches a public search engine, restricted to linkedin.com/in, for
   the operator's reviewed query and a few close variants. Nothing logs in to
   LinkedIn, opens a browser or hides what it is: the searches run at
   Anthropic and only indexed public results come back.

   The profiles are built from the search results themselves (URL, page title,
   the text Claude cited), never from Claude's prose, so a profile can only
   exist if a search returned it. Results from a search whose query fails the
   sourcing policy (protected criteria, unrelated to the role) are dropped. */

const ENDPOINT = `https://${SOURCING_PROVIDER_HOSTS.Anthropic}/v1/messages`;
/** A long search turn can pause; each resume is a new request. */
const MAX_REQUESTS = 3;

/** Uses the workspace's own Anthropic key (Settings), never the server's. */
export function webSearchAnthropicConfig(settings: AiProviderSettings): { apiKeyId: string; model: string } | null {
  const provider = (settings.llmProviders ?? []).find((p) => p.enabled && p.kind === "Anthropic" && p.apiKeyId);
  if (!provider?.apiKeyId) return null;
  const resolved = resolveAiProvider(settings, "sourcing");
  const model = resolved?.provider === "anthropic" && resolved.model ? resolved.model : DEFAULT_MODEL.anthropic;
  return { apiKeyId: provider.apiKeyId, model };
}

/** https://www.linkedin.com/in/<slug>, or null for anything that is not a public profile page. */
export function canonicalLinkedInProfileUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname)) return null;
  const match = /^\/in\/([A-Za-z0-9%_-]{3,100})(?:\/[a-z]{2})?\/?$/.exec(url.pathname);
  return match ? `https://www.linkedin.com/in/${match[1]}` : null;
}

export interface WebSearchRequest {
  query: string;
  limit: number;
  role: string;
  location: string;
  model: string;
  /** The sourcing policy, applied to every query Claude actually ran. */
  queryAllowed: (query: string) => boolean;
  signal?: AbortSignal;
}

export type WebSearchOutcome =
  | { ok: true; hits: SearchHit[]; searches: number; rejectedSearches: number; usage: AnthropicUsage }
  | { ok: false; reason: "refused" | "unavailable"; status: number; usage: AnthropicUsage };

const SYSTEM = `You find candidates for a recruiter by searching public LinkedIn profile pages with the web_search tool.

Rules:
- Search only for the role in the request. Run the reviewed query first, exactly as given, then at most a few close variants: a synonym of the job title, one or two of the required skills, the location.
- Never search on age, gender, ethnicity, religion, nationality, disability, family status, schools or universities.
- When you are done, list the people whose result matches the role, one per line, each with one short factual sentence based on the search result. Never invent a person, a title or a detail.`;

type Block = Record<string, unknown>;
const isRecord = (v: unknown): v is Block => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function addUsage(total: AnthropicUsage, raw: unknown): void {
  if (!isRecord(raw)) return;
  total.input_tokens = count(total.input_tokens) + count(raw.input_tokens);
  total.output_tokens = count(total.output_tokens) + count(raw.output_tokens);
  total.cache_read_input_tokens = count(total.cache_read_input_tokens) + count(raw.cache_read_input_tokens);
  total.cache_creation_input_tokens = count(total.cache_creation_input_tokens) + count(raw.cache_creation_input_tokens);
  const server = isRecord(raw.server_tool_use) ? raw.server_tool_use : {};
  total.server_tool_use = { web_search_requests: count(total.server_tool_use?.web_search_requests) + count(server.web_search_requests) };
}

/** LinkedIn titles read "Name – Title – Company | LinkedIn"; extractLead splits on " - ". */
const normalizeTitle = (title: string) => title.replace(/\s+[–—]\s+/g, " - ").trim();

export async function searchLinkedInWithClaude(clearance: ProviderClearance, key: string, request: WebSearchRequest): Promise<WebSearchOutcome> {
  const maxUses = webSearchBudget(request.limit);
  const usage: AnthropicUsage = {};
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content:
    `Reviewed query: ${request.query}\nRole: ${request.role}\nLocation: ${request.location || "not specified"}\nFind up to ${request.limit} matching profiles.` }];
  const queries = new Map<string, string>();
  const found = new Map<string, { title: string; order: number }>();
  const cited = new Map<string, string>();
  let rejectedSearches = 0, searchErrors = 0, okSearches = 0;

  for (let round = 0; round < MAX_REQUESTS; round++) {
    let response: Response;
    try {
      response = await sourcingFetch(clearance, ENDPOINT, { method: "POST", headers: anthropicHeaders(key), signal: request.signal,
        body: JSON.stringify({
          model: request.model, max_tokens: 4096, system: SYSTEM, messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses, allowed_domains: ["linkedin.com/in"] }],
          ...(anthropicSupportsEffort(request.model) ? { output_config: { effort: "low" } } : {}),
        }) });
    } catch {
      return { ok: false, reason: "unavailable", status: 0, usage };
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(json)) {
      const refused = response.status >= 400 && response.status < 500 && response.status !== 429;
      return { ok: false, reason: refused ? "refused" : "unavailable", status: response.status, usage };
    }
    addUsage(usage, json.usage);
    const content = Array.isArray(json.content) ? json.content.filter(isRecord) : [];
    for (const block of content) {
      if (block.type === "server_tool_use" && block.name === "web_search" && typeof block.id === "string") {
        queries.set(block.id, isRecord(block.input) && typeof block.input.query === "string" ? block.input.query : "");
      } else if (block.type === "web_search_tool_result") {
        if (!Array.isArray(block.content)) { searchErrors++; continue; }
        if (!request.queryAllowed(queries.get(String(block.tool_use_id)) ?? "")) { rejectedSearches++; continue; }
        okSearches++;
        for (const result of block.content.filter(isRecord)) {
          const url = typeof result.url === "string" ? canonicalLinkedInProfileUrl(result.url) : null;
          if (url && !found.has(url)) found.set(url, { title: typeof result.title === "string" ? normalizeTitle(result.title) : "", order: found.size });
        }
      } else if (block.type === "text" && Array.isArray(block.citations)) {
        for (const citation of block.citations.filter(isRecord)) {
          const url = typeof citation.url === "string" ? canonicalLinkedInProfileUrl(citation.url) : null;
          if (!url || typeof citation.cited_text !== "string") continue;
          cited.set(url, `${cited.get(url) ?? ""} ${citation.cited_text}`.trim());
        }
      }
    }
    if (json.stop_reason !== "pause_turn" || queries.size >= maxUses) break;
    messages.push({ role: "assistant", content: json.content });
  }

  if (found.size === 0 && okSearches === 0 && searchErrors > 0) return { ok: false, reason: "unavailable", status: 200, usage };
  // Results Claude cited as matching the role first, then the other results.
  const hits = [...found.entries()]
    .sort(([a, x], [b, y]) => Number(cited.has(b)) - Number(cited.has(a)) || x.order - y.order)
    .slice(0, request.limit)
    .map(([url, { title }]) => ({ url, title, snippet: (cited.get(url) ?? "").slice(0, 300) }));
  return { ok: true, hits, searches: count(usage.server_tool_use?.web_search_requests) || queries.size, rejectedSearches, usage };
}
