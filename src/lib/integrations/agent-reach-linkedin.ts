/**
 * Agent Reach — LinkedIn eyes for Aria.
 *
 * Upstream: https://github.com/Panniantong/Agent-Reach
 * LinkedIn channel backends: mcp-server-linkedin ▸ Jina Reader / Search.
 *
 * Slice 1: Jina Reader in-process (keyless OK; ARIA_JINA_API_KEY raises limits).
 * Slice 2: optional mcp-server-linkedin sidecar when
 *   ARIA_AGENT_REACH_LINKEDIN_MCP_URL is set (HTTPS POST /linkedin/profile).
 * Slice 3.7: authenticated Jina Reader + optional s.jina.ai search for discovery.
 * Connect / Message stay on OpenBot Browser Computers — never here.
 *
 * Get a Jina API key: https://jina.ai/?sui=apikey
 */

import { fetchPublicUrl } from "@/lib/api/public-fetch";
import { validateMcpBaseUrl } from "@/lib/mcp-auth-params";

export type AgentReachLinkedInVia = "agent-reach-jina" | "agent-reach-mcp" | "stub";

export type AgentReachLinkedInRead =
  | {
      ok: true;
      url: string;
      title: string;
      text: string;
      via: Exclude<AgentReachLinkedInVia, "stub">;
    }
  | {
      ok: false;
      url: string;
      detail: string;
      via: AgentReachLinkedInVia;
    };

export type AgentReachLinkedInSearchHit = {
  profileUrl: string;
  title?: string;
  snippet?: string;
  via: "agent-reach-jina-search";
};

const JINA_READER_ORIGIN = "https://r.jina.ai";
const JINA_SEARCH_ORIGIN = "https://s.jina.ai";

function agentReachJinaEnabled(): boolean {
  // Default ON for read path (keyless, Agent Reach zero-config). Operators can
  // disable with ARIA_AGENT_REACH_JINA=0 without removing the adapter.
  const raw = (process.env.ARIA_AGENT_REACH_JINA || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/**
 * Jina API key for Reader + Search. Prefer Aria-namespaced env; accept upstream
 * JINA_API_KEY. Never log or return the raw value.
 */
export function agentReachJinaApiKey(): string {
  const aria = (process.env.ARIA_JINA_API_KEY || "").trim();
  if (aria) return aria;
  return (process.env.JINA_API_KEY || "").trim();
}

export function agentReachJinaApiKeyConfigured(): boolean {
  return agentReachJinaApiKey().length > 0;
}

function jinaAuthHeaders(): Record<string, string> {
  const key = agentReachJinaApiKey();
  if (!key) return {};
  // Some Jina / Agent-Reach portal keys (`apikey_…`) authenticate via X-API-Key.
  // Standard jina.ai keys use Authorization: Bearer. Do not send both — an invalid
  // Bearer can fail the request even when X-API-Key would succeed.
  if (/^apikey_/i.test(key)) {
    return { "X-API-Key": key };
  }
  return { Authorization: `Bearer ${key}` };
}

/** Optional mcp-server-linkedin sidecar base URL (HTTPS, no credentials in URL). */
export function agentReachLinkedInMcpBaseUrl(): string {
  return (process.env.ARIA_AGENT_REACH_LINKEDIN_MCP_URL || "").trim().replace(/\/$/, "");
}

export function isLinkedInPublicUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:") return false;
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
    // Profiles, companies, jobs — Agent Reach LinkedIn surface.
    return /^\/(in|company|jobs)\b/i.test(u.pathname);
  } catch {
    return false;
  }
}

function normalizeLinkedInUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    // Strip tracking noise; keep path + essential query for jobs.
    if (/\/in\//i.test(u.pathname) || /\/company\//i.test(u.pathname)) {
      u.search = "";
    }
    return u.toString().replace(/\/$/, "") + (/\/in\/|\/company\//i.test(u.pathname) ? "/" : "");
  } catch {
    return url.trim();
  }
}

/** Build the Jina Reader URL Agent Reach documents for public page reads. */
export function jinaReaderUrlFor(targetUrl: string): string {
  const clean = normalizeLinkedInUrl(targetUrl);
  return `${JINA_READER_ORIGIN}/${clean}`;
}

function thinOrEmpty(body: string): boolean {
  return !body || body.trim().length < 40;
}

/**
 * Optional Agent Reach MCP LinkedIn sidecar.
 * Contract: POST {base}/linkedin/profile  body `{ "url": "<linkedin https url>" }`
 * → `{ "ok": true, "title"?: string, "text": string }` or fail.
 * Never invents profile text when the sidecar is down or returns empty.
 */
export async function readLinkedInViaAgentReachMcp(
  targetUrl: string,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<AgentReachLinkedInRead> {
  const clean = normalizeLinkedInUrl(targetUrl);
  if (!isLinkedInPublicUrl(clean)) {
    return {
      ok: false,
      url: clean,
      detail: "Only https LinkedIn /in, /company, or /jobs URLs are allowed.",
      via: "stub",
    };
  }
  const base = agentReachLinkedInMcpBaseUrl();
  if (!base) {
    return {
      ok: false,
      url: clean,
      detail: "Agent Reach LinkedIn MCP URL not configured (ARIA_AGENT_REACH_LINKEDIN_MCP_URL).",
      via: "stub",
    };
  }
  const guard = validateMcpBaseUrl(base);
  if (!guard.ok) {
    return { ok: false, url: clean, detail: guard.error, via: "stub" };
  }

  const endpoint = `${base}/linkedin/profile`;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url: clean }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
      redirect: "manual",
    });
    if (!res.ok) {
      return {
        ok: false,
        url: clean,
        detail: `Agent Reach MCP returned HTTP ${res.status}.`,
        via: "agent-reach-mcp",
      };
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      title?: string;
      text?: string;
      detail?: string;
    } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!data || data.ok === false || thinOrEmpty(text)) {
      return {
        ok: false,
        url: clean,
        detail: data?.detail || "Agent Reach MCP returned empty or too-thin profile text.",
        via: "agent-reach-mcp",
      };
    }
    return {
      ok: true,
      url: clean,
      title: (data.title || "").trim(),
      text: text.slice(0, 8_000),
      via: "agent-reach-mcp",
    };
  } catch (err) {
    return {
      ok: false,
      url: clean,
      detail: err instanceof Error ? err.message : "Agent Reach MCP egress failed.",
      via: "agent-reach-mcp",
    };
  }
}

/**
 * Read a public LinkedIn URL through Jina Reader (Agent Reach LinkedIn backend).
 * When ARIA_JINA_API_KEY / JINA_API_KEY is set, send Bearer auth for higher rate
 * limits and ASN-blocked egress. Fail closed on non-LinkedIn targets, disabled
 * flag, empty body, or egress errors.
 */
export async function readLinkedInViaAgentReachJina(
  targetUrl: string,
  opts?: { timeoutMs?: number },
): Promise<AgentReachLinkedInRead> {
  const clean = normalizeLinkedInUrl(targetUrl);
  if (!isLinkedInPublicUrl(clean)) {
    return {
      ok: false,
      url: clean,
      detail: "Only https LinkedIn /in, /company, or /jobs URLs are allowed.",
      via: "stub",
    };
  }
  if (!agentReachJinaEnabled()) {
    return {
      ok: false,
      url: clean,
      detail: "Agent Reach Jina LinkedIn read disabled (ARIA_AGENT_REACH_JINA=0).",
      via: "stub",
    };
  }

  const jinaUrl = jinaReaderUrlFor(clean);
  const auth = jinaAuthHeaders();
  try {
    const res = await fetchPublicUrl(jinaUrl, {
      method: "GET",
      headers: {
        accept: "text/plain,text/markdown,text/html;q=0.8,*/*;q=0.5",
        "user-agent": "AriaAgentReach/1.0 (+linkedin-read; compatible; https://aria.local)",
        "X-Retain-Images": "none",
        ...auth,
      },
      timeoutMs: opts?.timeoutMs ?? 20_000,
      maxResponseBytes: 1_500_000,
      redirect: "manual",
    });
    if (!res.ok) {
      return {
        ok: false,
        url: clean,
        detail: `Jina Reader returned HTTP ${res.status}.`,
        via: "agent-reach-jina",
      };
    }
    const body = (await res.text()).trim();
    if (thinOrEmpty(body)) {
      return {
        ok: false,
        url: clean,
        detail: "Jina Reader returned empty or too-thin content (login wall or block).",
        via: "agent-reach-jina",
      };
    }
    const titleMatch = body.match(/^(?:Title|标题)\s*:\s*(.+)$/im);
    const title = (titleMatch?.[1] || "").trim();
    return {
      ok: true,
      url: clean,
      title,
      text: body.slice(0, 8_000),
      via: "agent-reach-jina",
    };
  } catch (err) {
    return {
      ok: false,
      url: clean,
      detail: err instanceof Error ? err.message : "Agent Reach Jina egress failed.",
      via: "agent-reach-jina",
    };
  }
}

/**
 * Prefer configured MCP sidecar, then Jina. Never invents text when both fail.
 */
export async function readLinkedInViaAgentReach(
  targetUrl: string,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<AgentReachLinkedInRead> {
  if (agentReachLinkedInMcpBaseUrl()) {
    const mcp = await readLinkedInViaAgentReachMcp(targetUrl, opts);
    if (mcp.ok) return mcp;
  }
  return readLinkedInViaAgentReachJina(targetUrl, opts);
}

function extractLinkedInProfileUrls(text: string, limit: number): AgentReachLinkedInSearchHit[] {
  const hits: AgentReachLinkedInSearchHit[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/in\/[A-Za-z0-9%_\-.~]+\/?/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") u.protocol = "https:";
      u.hash = "";
      u.search = "";
      const profileUrl = u.toString().replace(/\/$/, "") + "/";
      if (!isLinkedInPublicUrl(profileUrl) || seen.has(profileUrl)) continue;
      if (/lead-\d+\/?$/i.test(profileUrl)) continue;
      seen.add(profileUrl);
      hits.push({ profileUrl, via: "agent-reach-jina-search" });
      if (hits.length >= limit) break;
    } catch {
      /* skip bad URL */
    }
  }
  return hits;
}

/**
 * Discover public LinkedIn /in URLs via Jina Search (s.jina.ai).
 * Best Aria use when ARIA_JINA_API_KEY is set: supplements Tavily for NightTrek-style
 * discovery. Requires API key (search is not keyless). Never invents profile URLs.
 */
export async function searchLinkedInViaAgentReachJina(query: {
  keywords: string[];
  location?: string;
  limit?: number;
}): Promise<{ ok: boolean; hits: AgentReachLinkedInSearchHit[]; detail?: string }> {
  if (!agentReachJinaEnabled()) {
    return { ok: false, hits: [], detail: "Agent Reach Jina disabled (ARIA_AGENT_REACH_JINA=0)." };
  }
  if (!agentReachJinaApiKeyConfigured()) {
    return {
      ok: false,
      hits: [],
      detail: "Jina Search requires ARIA_JINA_API_KEY (or JINA_API_KEY).",
    };
  }
  // Portal `apikey_…` tokens work for Reader (X-API-Key) but not s.jina.ai Search.
  const key = agentReachJinaApiKey();
  if (/^apikey_/i.test(key)) {
    return {
      ok: false,
      hits: [],
      detail:
        "Jina Search needs a standard jina.ai Bearer key (jina_…). This ARIA_JINA_API_KEY is a Reader (X-API-Key) token — enrichment stays on Reader.",
    };
  }
  const keywords = (query.keywords || []).map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) return { ok: false, hits: [], detail: "keywords required" };
  const limit = Math.min(Math.max(query.limit ?? 8, 1), 25);
  const q = ["site:linkedin.com/in", ...keywords, query.location?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  const endpoint = `${JINA_SEARCH_ORIGIN}/?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetchPublicUrl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,text/markdown;q=0.8,*/*;q=0.5",
        "user-agent": "AriaAgentReach/1.0 (+linkedin-search; compatible; https://aria.local)",
        ...jinaAuthHeaders(),
      },
      timeoutMs: 20_000,
      maxResponseBytes: 1_500_000,
      redirect: "manual",
    });
    if (!res.ok) {
      return { ok: false, hits: [], detail: `Jina Search returned HTTP ${res.status}.` };
    }
    const body = (await res.text()).trim();
    if (thinOrEmpty(body)) {
      return { ok: false, hits: [], detail: "Jina Search returned empty results." };
    }

    // Prefer JSON shape when present; else scrape LinkedIn URLs from markdown/plain.
    let hits: AgentReachLinkedInSearchHit[] = [];
    try {
      const parsed = JSON.parse(body) as {
        data?: Array<{ url?: string; title?: string; description?: string; content?: string }>;
      };
      const seen = new Set<string>();
      for (const row of parsed.data ?? []) {
        const raw = typeof row.url === "string" ? row.url : "";
        if (!raw || !/linkedin\.com\/in\//i.test(raw)) continue;
        const profileUrl = normalizeLinkedInUrl(raw);
        if (!isLinkedInPublicUrl(profileUrl) || seen.has(profileUrl)) continue;
        seen.add(profileUrl);
        hits.push({
          profileUrl,
          title: typeof row.title === "string" ? row.title : undefined,
          snippet:
            typeof row.description === "string"
              ? row.description
              : typeof row.content === "string"
                ? row.content.slice(0, 280)
                : undefined,
          via: "agent-reach-jina-search",
        });
        if (hits.length >= limit) break;
      }
    } catch {
      hits = extractLinkedInProfileUrls(body, limit);
    }

    if (!hits.length) {
      hits = extractLinkedInProfileUrls(body, limit);
    }
    if (!hits.length) {
      return { ok: false, hits: [], detail: "No public LinkedIn profile URLs in Jina Search results." };
    }
    return { ok: true, hits: hits.slice(0, limit) };
  } catch (err) {
    return {
      ok: false,
      hits: [],
      detail: err instanceof Error ? err.message : "Agent Reach Jina Search egress failed.",
    };
  }
}

export function agentReachLinkedInStatus(): {
  id: string;
  enabled: boolean;
  urlConfigured: boolean;
  apiKeyConfigured: boolean;
  role: string;
  builtin: string;
} {
  const apiKeyConfigured = agentReachJinaApiKeyConfigured();
  return {
    id: "agent-reach-jina",
    enabled: agentReachJinaEnabled(),
    // Reader origin is always reachable; apiKeyConfigured raises rate limits / ASN unlock.
    urlConfigured: true,
    apiKeyConfigured,
    role: "Public LinkedIn page read (Agent Reach → Jina Reader)",
    builtin: apiKeyConfigured
      ? "r.jina.ai + ARIA_JINA_API_KEY (Bearer or X-API-Key) over SSRF-guarded HTTPS"
      : "r.jina.ai keyless over SSRF-guarded HTTPS (set ARIA_JINA_API_KEY for higher limits)",
  };
}

export function agentReachLinkedInMcpStatus(): {
  id: string;
  enabled: boolean;
  urlConfigured: boolean;
  role: string;
  builtin: string;
} {
  const base = agentReachLinkedInMcpBaseUrl();
  const configured = Boolean(base) && validateMcpBaseUrl(base).ok;
  return {
    id: "agent-reach-mcp",
    enabled: configured,
    urlConfigured: configured,
    role: "Configured LinkedIn read (Agent Reach → mcp-server-linkedin sidecar)",
    builtin: "POST /linkedin/profile — fail-closed when URL unset or empty",
  };
}

export function agentReachLinkedInSearchStatus(): {
  id: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  role: string;
  builtin: string;
} {
  const key = agentReachJinaApiKey();
  const apiKeyConfigured = key.length > 0;
  // Search needs a standard Bearer key; apikey_… tokens are Reader-only.
  const searchCapable = apiKeyConfigured && !/^apikey_/i.test(key);
  return {
    id: "agent-reach-jina-search",
    enabled: agentReachJinaEnabled() && searchCapable,
    apiKeyConfigured,
    role: "Public LinkedIn /in discovery (Agent Reach → Jina Search)",
    builtin: searchCapable
      ? "s.jina.ai site:linkedin.com/in — Bearer ARIA_JINA_API_KEY"
      : apiKeyConfigured
        ? "s.jina.ai needs a jina_… Bearer key (current key is Reader X-API-Key only)"
        : "s.jina.ai site:linkedin.com/in — requires ARIA_JINA_API_KEY (jina_… Bearer)",
  };
}
