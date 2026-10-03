/**
 * Agent Reach — LinkedIn eyes for Aria.
 *
 * Upstream: https://github.com/Panniantong/Agent-Reach
 * LinkedIn channel backends: mcp-server-linkedin ▸ Jina Reader (zero-config).
 *
 * Slice 1: Jina Reader in-process (keyless).
 * Slice 2: optional mcp-server-linkedin sidecar when
 *   ARIA_AGENT_REACH_LINKEDIN_MCP_URL is set (HTTPS POST /linkedin/profile).
 * Connect / Message stay on OpenBot Browser Computers — never here.
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

const JINA_READER_ORIGIN = "https://r.jina.ai";

function agentReachJinaEnabled(): boolean {
  // Default ON for read path (keyless, Agent Reach zero-config). Operators can
  // disable with ARIA_AGENT_REACH_JINA=0 without removing the adapter.
  const raw = (process.env.ARIA_AGENT_REACH_JINA || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
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
 * Fail closed on non-LinkedIn targets, disabled flag, empty body, or egress errors.
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
  try {
    const res = await fetchPublicUrl(jinaUrl, {
      method: "GET",
      headers: {
        accept: "text/plain,text/markdown,text/html;q=0.8,*/*;q=0.5",
        "user-agent": "AriaAgentReach/1.0 (+linkedin-read; compatible; https://aria.local)",
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

export function agentReachLinkedInStatus(): {
  id: string;
  enabled: boolean;
  urlConfigured: boolean;
  role: string;
  builtin: string;
} {
  return {
    id: "agent-reach-jina",
    enabled: agentReachJinaEnabled(),
    urlConfigured: true, // keyless public Reader origin
    role: "Public LinkedIn page read (Agent Reach → Jina Reader)",
    builtin: "r.jina.ai over SSRF-guarded HTTPS",
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
