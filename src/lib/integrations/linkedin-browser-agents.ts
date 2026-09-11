/**
 * LinkedIn + browser-agent adapters for Aria.
 *
 * Real in-process sourcing work (not decorative stubs):
 * - search  → public web_search scoped to linkedin.com/in (NightTrek-style)
 * - analyze → fetch public page text → Orca-style insight
 * - qualify → token-overlap ICP scoring (Linki / OpenOutreach-style)
 * - navigate → fetch public page content (browser-use-style); Connect/Message refused
 *
 * Optional sidecars (ARIA_*_URL) override when enabled. Invented profile URLs
 * (e.g. …/in/foo-lead-1) are never returned.
 */

import { runWebTool } from "@/lib/ai/web-tools";
import { scraplingFetch } from "@/lib/scrapling/adapter";
import { extractLead } from "@/lib/sourcing/web-leads";

export type LinkedInProfileInsight = {
  url: string;
  headline?: string;
  location?: string;
  focusAreas: string[];
  trajectoryNotes: string[];
  painPoints: string[];
  via: "orca-style" | "web-fetch" | "stub";
  /** Raw excerpt used for scoring / outreach when a public page was readable. */
  evidenceText?: string;
};

export type LinkedInSearchHit = {
  profileUrl: string;
  name?: string;
  title?: string;
  location?: string;
  snippet?: string;
  via: "linkedin-agent-tool" | "web-search" | "stub";
};

export type BrowserUseAction =
  | { type: "navigate"; url: string }
  | { type: "connect"; profileUrl: string; note?: string }
  | { type: "message"; profileUrl: string; body: string };

function enabled(flag: string): boolean {
  return process.env[flag] === "1" || process.env[flag] === "true";
}

function isLinkedInProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\/[^/]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

function normalizeProfileUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const m = u.pathname.match(/\/in\/([^/]+)/i);
    if (!m) return url.trim();
    return `https://www.linkedin.com/in/${m[1]}/`;
  } catch {
    return url.trim();
  }
}

function slugLabel(url: string): string {
  try {
    const m = new URL(url).pathname.match(/\/in\/([^/]+)/i);
    const slug = (m?.[1] || "").replace(/-+/g, " ").trim();
    return slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : "this profile";
  } catch {
    return "this profile";
  }
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "you",
  "your",
  "our",
  "their",
  "into",
  "onto",
  "over",
  "under",
  "about",
  "than",
  "then",
  "them",
  "they",
  "who",
  "what",
  "when",
  "where",
  "which",
  "will",
  "can",
  "may",
  "not",
  "but",
  "all",
  "any",
  "out",
  "via",
  "www",
  "http",
  "https",
  "com",
  "linkedin",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

async function readPublicPage(
  url: string,
): Promise<{ title: string; text: string; via: string } | null> {
  const scraped = await scraplingFetch({ url, timeoutMs: 15_000 });
  if (scraped.ok && scraped.text.trim()) {
    return {
      title: (scraped.title || "").trim(),
      text: scraped.text.slice(0, 8_000),
      via: scraped.via,
    };
  }
  const page = await runWebTool("fetch_page", { url });
  if (!page.ok) return null;
  const content = page.content as { title?: string; text?: string } | undefined;
  const text = (content?.text || "").trim();
  if (!text) return null;
  return {
    title: (content?.title || "").trim(),
    text: text.slice(0, 8_000),
    via: "fetch_page",
  };
}

function insightFromText(
  url: string,
  title: string,
  text: string,
  via: LinkedInProfileInsight["via"],
): LinkedInProfileInsight {
  const label = title || slugLabel(url);
  const hay = `${title}\n${text}`.toLowerCase();
  const focusPool = [
    "ai",
    "agentic",
    "machine learning",
    "llm",
    "platform",
    "cloud",
    "security",
    "data",
    "product",
    "engineering",
    "innovation",
    "automation",
    "devops",
    "frontend",
    "backend",
    "fullstack",
    "mobile",
    "sales",
    "recruiting",
  ];
  const focusAreas = focusPool.filter((k) => hay.includes(k)).slice(0, 5);
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 220)
    .slice(0, 8);
  const painHints = [
    "scale",
    "adoption",
    "transform",
    "legacy",
    "growth",
    "efficiency",
    "hiring",
    "delivery",
    "reliability",
    "cost",
  ];
  const painPoints = painHints
    .filter((k) => hay.includes(k))
    .slice(0, 3)
    .map((k) => `Signals around ${k} in public profile text`);
  return {
    url,
    headline: label.slice(0, 160),
    focusAreas: focusAreas.length ? focusAreas : tokenize(label).slice(0, 3),
    trajectoryNotes: sentences.slice(0, 2).length
      ? sentences.slice(0, 2)
      : [`Public profile text read for ${label}.`],
    painPoints: painPoints.length
      ? painPoints
      : ["Enterprise delivery and adoption pressure (inferred from thin public signal)"],
    via,
    evidenceText: text.slice(0, 1_200),
  };
}

/** Orca-style profile URL analysis from real public page text when readable. */
export async function analyzeLinkedInProfile(url: string): Promise<LinkedInProfileInsight> {
  const clean = normalizeProfileUrl(url);
  if (!clean || !isLinkedInProfileUrl(clean)) {
    return { url: clean, focusAreas: [], trajectoryNotes: [], painPoints: [], via: "stub" };
  }

  if (enabled("ARIA_ORCA_ENABLED")) {
    const base = (process.env.ARIA_ORCA_URL || "").replace(/\/$/, "");
    if (base) {
      try {
        const res = await fetch(`${base}/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: clean }),
          signal: AbortSignal.timeout(20_000),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<LinkedInProfileInsight> & {
          evidenceText?: string;
          text?: string;
        };
        if (res.ok && (data.focusAreas?.length || data.evidenceText || data.text || data.headline)) {
          return {
            url: clean,
            headline: data.headline || slugLabel(clean),
            location: data.location,
            focusAreas: data.focusAreas ?? [],
            trajectoryNotes: data.trajectoryNotes ?? [],
            painPoints: data.painPoints ?? [],
            via: "orca-style",
            evidenceText: data.evidenceText || data.text,
          };
        }
      } catch {
        // fall through to built-in fetch
      }
    }
  }

  const page = await readPublicPage(clean);
  if (page) return insightFromText(clean, page.title, page.text, "web-fetch");

  const label = slugLabel(clean);
  return {
    url: clean,
    headline: label,
    focusAreas: tokenize(label).slice(0, 3),
    trajectoryNotes: [
      `Public LinkedIn slug resolved for ${label}; page body was not readable (login wall or bot block).`,
    ],
    painPoints: ["Limited public signal — confirm details via AriaBot Take control before outreach"],
    via: "orca-style",
  };
}

/**
 * NightTrek-style LinkedIn metadata search.
 * Built-in path uses Aria web_search (site:linkedin.com/in). Never invents profiles.
 */
export async function searchLinkedInProfiles(query: {
  keywords: string[];
  location?: string;
  limit?: number;
  tavilyKey?: string;
}): Promise<{ ok: boolean; hits: LinkedInSearchHit[]; detail?: string }> {
  const keywords = (query.keywords || []).map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) return { ok: false, hits: [], detail: "keywords required" };
  const limit = Math.min(Math.max(query.limit ?? 8, 1), 25);
  const q = ["site:linkedin.com/in", ...keywords, query.location?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  const hits: LinkedInSearchHit[] = [];
  const seen = new Set<string>();

  if (enabled("ARIA_LINKEDIN_AGENT_TOOL_ENABLED")) {
    const base = (process.env.ARIA_LINKEDIN_AGENT_TOOL_URL || "").replace(/\/$/, "");
    if (base) {
      try {
        const res = await fetch(`${base}/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keywords, location: query.location, limit }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => ({}))) as {
          hits?: LinkedInSearchHit[];
          error?: string;
        };
        for (const hit of data.hits ?? []) {
          const profileUrl = normalizeProfileUrl(hit.profileUrl || "");
          if (!isLinkedInProfileUrl(profileUrl) || seen.has(profileUrl)) continue;
          if (/lead-\d+\/?$/i.test(profileUrl)) continue;
          seen.add(profileUrl);
          hits.push({
            profileUrl,
            name: hit.name,
            title: hit.title,
            location: hit.location,
            snippet: hit.snippet,
            via: "linkedin-agent-tool",
          });
        }
      } catch {
        // continue to built-in web search
      }
    }
  }

  const search = await runWebTool(
    "web_search",
    { query: q },
    { tavilyKey: query.tavilyKey || process.env.TAVILY_API_KEY || process.env.TAVILY_KEY },
  );
  if (search.ok) {
    const content = search.content as
      | { results?: { title: string; url: string; snippet: string }[] }
      | undefined;
    for (const raw of content?.results ?? []) {
      if (!isLinkedInProfileUrl(raw.url)) continue;
      const profileUrl = normalizeProfileUrl(raw.url);
      if (seen.has(profileUrl)) continue;
      seen.add(profileUrl);
      const lead = extractLead(
        { title: raw.title, url: profileUrl, snippet: raw.snippet },
        "LinkedIn",
      );
      hits.push({
        profileUrl,
        name: lead.name,
        title: lead.title,
        location: query.location,
        snippet: lead.snippet,
        via: "web-search",
      });
      if (hits.length >= limit) break;
    }
  }

  if (!hits.length) {
    return {
      ok: false,
      hits: [],
      detail: search.ok
        ? "No public LinkedIn profile URLs found for that query."
        : search.error || "LinkedIn web search failed.",
    };
  }
  return { ok: true, hits: hits.slice(0, limit) };
}

/**
 * browser-use style action runner. Navigate fetches real public page text.
 * Connect/Message always refused → AriaBot Take control.
 */
export async function runBrowserUseAction(
  action: BrowserUseAction,
): Promise<{
  ok: boolean;
  detail: string;
  via: "browser-use" | "ariabot" | "web-fetch" | "stub";
  title?: string;
  text?: string;
  url?: string;
}> {
  if (action.type === "connect" || action.type === "message") {
    return {
      ok: false,
      detail: "LinkedIn Connect/Message must use AriaBot computers (Take control path).",
      via: "ariabot",
    };
  }

  const url = action.url.trim();
  if (!url) return { ok: false, detail: "url required", via: "stub" };

  if (enabled("ARIA_BROWSER_USE_ENABLED")) {
    const base = (process.env.ARIA_BROWSER_USE_URL || "").replace(/\/$/, "");
    if (base) {
      try {
        const res = await fetch(`${base}/act`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
          signal: AbortSignal.timeout(60_000),
        });
        const data = (await res.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
          title?: string;
          text?: string;
        };
        if (res.ok && (data.text || data.title || data.detail)) {
          return {
            ok: true,
            detail: data.detail || "ok",
            via: "browser-use",
            title: data.title,
            text: data.text,
            url,
          };
        }
      } catch {
        // fall through
      }
    }
  }

  const page = await readPublicPage(url);
  if (!page) {
    return {
      ok: false,
      detail: "Public page could not be fetched (blocked, empty, or invalid URL).",
      via: "stub",
      url,
    };
  }
  return {
    ok: true,
    detail: `Fetched ${page.title || url} via ${page.via}`,
    via: "web-fetch",
    title: page.title,
    text: page.text.slice(0, 4_000),
    url,
  };
}

function scoreIcpOverlap(haystack: string, icp: string): { score: number; reasons: string[] } {
  const icpTokens = [...new Set(tokenize(icp))];
  const hayTokens = new Set(tokenize(haystack));
  if (!icpTokens.length) return { score: 0, reasons: ["ICP text empty after tokenization."] };

  const matched = icpTokens.filter((t) => hayTokens.has(t) || haystack.toLowerCase().includes(t));
  const ratio = matched.length / icpTokens.length;
  let score = Math.round(35 + ratio * 55);
  const reasons: string[] = [];
  if (matched.length) reasons.push(`Matched ICP tokens: ${matched.slice(0, 8).join(", ")}`);
  else reasons.push("No ICP token overlap in available public text.");
  if (/linkedin\.com\/in\//i.test(haystack)) {
    score += 5;
    reasons.push("LinkedIn profile URL present.");
  }
  if (haystack.length > 400) {
    score += 3;
    reasons.push("Sufficient public text for qualification.");
  }
  return { score: Math.max(0, Math.min(99, score)), reasons };
}

/** OpenOutreach / Linki style ICP qualification using real public text when available. */
export async function qualifyLeadAgainstIcp(input: {
  profileUrl?: string;
  snippet?: string;
  icp: string;
}): Promise<{
  ok: boolean;
  score: number;
  reasons: string[];
  via: "openoutreach" | "linki" | "web-fetch" | "stub";
}> {
  const icp = input.icp.trim();
  if (!icp) return { ok: false, score: 0, reasons: ["icp is required"], via: "stub" };

  const preferLinki = enabled("ARIA_LINKI_ENABLED");
  const preferOpen = enabled("ARIA_OPENOUTREACH_ENABLED");
  if (preferLinki || preferOpen) {
    const via = preferLinki ? "linki" : "openoutreach";
    const base = (
      (preferLinki ? process.env.ARIA_LINKI_URL : process.env.ARIA_OPENOUTREACH_URL) || ""
    ).replace(/\/$/, "");
    if (base) {
      try {
        const res = await fetch(`${base}/qualify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => ({}))) as {
          score?: number;
          reasons?: string[];
          error?: string;
        };
        if (res.ok && typeof data.score === "number") {
          return {
            ok: true,
            score: Math.max(0, Math.min(99, Number(data.score))),
            reasons: data.reasons ?? ["Sidecar ICP score"],
            via,
          };
        }
      } catch {
        // fall through to built-in
      }
    }
  }

  let evidence = `${input.profileUrl || ""}\n${input.snippet || ""}`;
  let via: "web-fetch" | "stub" = "stub";
  const profileUrl = (input.profileUrl || "").trim();
  if (profileUrl && isLinkedInProfileUrl(profileUrl)) {
    const insight = await analyzeLinkedInProfile(profileUrl);
    evidence += `\n${insight.headline || ""}\n${insight.focusAreas.join(" ")}\n${insight.evidenceText || ""}\n${insight.trajectoryNotes.join(" ")}`;
    if (insight.evidenceText) via = "web-fetch";
  } else if (profileUrl) {
    const page = await readPublicPage(profileUrl);
    if (page) {
      evidence += `\n${page.title}\n${page.text}`;
      via = "web-fetch";
    }
  }

  const scored = scoreIcpOverlap(evidence, icp);
  return { ok: true, score: scored.score, reasons: scored.reasons, via };
}

/** Operator-facing status for LinkedIn / browser-agent capabilities. */
export function listLinkedInBrowserAgentStatus(): {
  id: string;
  enabled: boolean;
  urlConfigured: boolean;
  role: string;
  builtin: string;
}[] {
  const flag = (name: string) => process.env[name] === "1" || process.env[name] === "true";
  const url = (name: string) => Boolean((process.env[name] || "").trim());
  return [
    {
      id: "orca",
      enabled: true,
      urlConfigured: url("ARIA_ORCA_URL"),
      role: "LinkedIn profile insight (trajectory / focus / pain points)",
      builtin: "web-fetch + scrapling",
    },
    {
      id: "linkedin-agent-tool",
      enabled: true,
      urlConfigured: url("ARIA_LINKEDIN_AGENT_TOOL_URL"),
      role: "LinkedIn search metadata for sourcing batches",
      builtin: "web_search site:linkedin.com/in",
    },
    {
      id: "browser-use",
      enabled: true,
      urlConfigured: url("ARIA_BROWSER_USE_URL"),
      role: "Public navigate/fetch (Connect/Message stay on AriaBot)",
      builtin: "fetch_page / scrapling",
    },
    {
      id: "linki",
      enabled: flag("ARIA_LINKI_ENABLED") || true,
      urlConfigured: url("ARIA_LINKI_URL"),
      role: "ICP qualification / SDR scoring",
      builtin: "token-overlap against public text",
    },
    {
      id: "openoutreach",
      enabled: flag("ARIA_OPENOUTREACH_ENABLED") || true,
      urlConfigured: url("ARIA_OPENOUTREACH_URL"),
      role: "ICP qualification / SDR scoring",
      builtin: "token-overlap against public text",
    },
  ];
}
