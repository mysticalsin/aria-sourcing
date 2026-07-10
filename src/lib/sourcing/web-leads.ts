// Real candidate discovery for platforms with no free structured search API
// (LinkedIn, Stack Overflow, Dribbble, Behance). READ-ONLY: reuses the existing
// compliant web_search tool (src/lib/ai/web-tools.ts) — honest bot User-Agent, no
// login/cookies/stealth, SSRF-guarded — scoped with a `site:` filter per platform.
//
// Honest limitation: search results give a title/url/snippet, not a structured
// profile. Name and current title are best-effort, extracted from the result text
// or the profile URL slug when parsing fails — never fabricated. Email is always
// blank; finding it is a separate enrichment step (same policy as GitHub sourcing).

import type { SourcePlatform } from "@/lib/types";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebLead {
  name: string;
  title: string;
  company: string;
  url: string;
  snippet: string;
}

/** Platforms real-sourced via a site:-scoped web search rather than a dedicated API. */
export type WebSearchPlatform = "LinkedIn" | "Stack Overflow" | "Dribbble" | "Behance";

const WEB_SEARCH_PLATFORMS = new Set<SourcePlatform>(["LinkedIn", "Stack Overflow", "Dribbble", "Behance"]);

/** True for platforms sourced through the web-search discovery path in this module. */
export function isWebSearchPlatform(platform: SourcePlatform): platform is WebSearchPlatform {
  return WEB_SEARCH_PLATFORMS.has(platform);
}

const PLATFORM_DOMAINS: Record<WebSearchPlatform, string> = {
  LinkedIn: "linkedin.com/in",
  "Stack Overflow": "stackoverflow.com/users",
  Dribbble: "dribbble.com",
  Behance: "behance.net",
};

const TITLE_SUFFIX_PATTERNS: Record<WebSearchPlatform, RegExp> = {
  LinkedIn: /\s*[|\-]\s*LinkedIn\s*$/i,
  "Stack Overflow": /\s*[|\-]\s*Stack Overflow\s*$/i,
  // Dribbble/Behance commonly read "Name on Dribbble" with no leading | or -,
  // unlike LinkedIn/Stack Overflow — so that delimiter is optional here.
  Dribbble: /\s*(?:[|\-]\s*)?(on\s+)?Dribbble('s)?(\s+profile)?\s*$/i,
  Behance: /\s*(?:[|\-]\s*)?(on\s+)?Behance('s)?(\s+profile)?\s*$/i,
};

/** Scope a base boolean/keyword query (e.g. campaign.sourcingStrategy.linkedinBoolean) to one platform. */
export function buildWebQuery(platform: WebSearchPlatform, baseQuery: string): string {
  return `site:${PLATFORM_DOMAINS[platform]} ${baseQuery}`.trim();
}

/** Add the platform site: scope once, preserving callers that already sent it. */
export function ensureWebQueryScope(platform: WebSearchPlatform, query: string): string {
  const trimmed = query.trim();
  const siteScope = `site:${PLATFORM_DOMAINS[platform]}`;
  return trimmed.toLowerCase().includes(siteScope.toLowerCase()) ? trimmed : buildWebQuery(platform, trimmed);
}

function titleCase(words: string): string {
  return words
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Best-effort name from a profile URL slug, e.g. dribbble.com/jane-doe-42 -> "Jane Doe". */
function nameFromSlug(url: string): string {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] ?? "";
    const cleaned = slug.replace(/-[a-f0-9]{4,}$/i, "").replace(/[-_]+/g, " ").trim();
    return cleaned ? titleCase(cleaned) : "";
  } catch {
    return "";
  }
}

/** A raw url-slug ("jane-doe-4471"), not prose — prefer the title-cased slug over this. */
function looksLikeSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s);
}

/**
 * Extract a best-effort lead from one search hit. Never throws, never fabricates —
 * falls back to the URL slug or the raw (truncated) title when structured parsing
 * doesn't find a clean "Name - Title - Company" pattern.
 */
export function extractLead(hit: SearchHit, platform: WebSearchPlatform): WebLead {
  const cleanedTitle = hit.title.replace(TITLE_SUFFIX_PATTERNS[platform], "").trim();
  const parts = cleanedTitle
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Common LinkedIn/profile title shape: "Name - Title - Company". Take what's there;
  // never invent a company or title the result text doesn't actually contain. When the
  // leading segment is itself a raw slug (search engine had no real title to show),
  // prefer the title-cased URL slug over dumping the slug in as a "name".
  const rawName = parts[0];
  const name =
    (rawName && !looksLikeSlug(rawName) ? rawName : nameFromSlug(hit.url)) ||
    rawName ||
    cleanedTitle.slice(0, 60) ||
    "Unknown";
  const title = parts[1] || hit.snippet.slice(0, 120);
  const company = parts[2] || "";
  return { name, title, company, url: hit.url, snippet: hit.snippet.slice(0, 300) };
}
