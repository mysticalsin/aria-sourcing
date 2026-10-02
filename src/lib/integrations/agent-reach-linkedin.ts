/**
 * Agent Reach — LinkedIn eyes for Aria.
 *
 * Upstream: https://github.com/Panniantong/Agent-Reach
 * LinkedIn channel backends: mcp-server-linkedin ▸ Jina Reader (zero-config).
 *
 * This module implements the Jina Reader path Aria can call in-process.
 * Connect / Message stay on OpenBot Browser Computers — never here.
 */

import { fetchPublicUrl } from "@/lib/api/public-fetch";

export type AgentReachLinkedInRead =
  | {
      ok: true;
      url: string;
      title: string;
      text: string;
      via: "agent-reach-jina";
    }
  | {
      ok: false;
      url: string;
      detail: string;
      via: "agent-reach-jina" | "stub";
    };

const JINA_READER_ORIGIN = "https://r.jina.ai";

function agentReachJinaEnabled(): boolean {
  // Default ON for read path (keyless, Agent Reach zero-config). Operators can
  // disable with ARIA_AGENT_REACH_JINA=0 without removing the adapter.
  const raw = (process.env.ARIA_AGENT_REACH_JINA || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
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
    if (!body || body.length < 40) {
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
