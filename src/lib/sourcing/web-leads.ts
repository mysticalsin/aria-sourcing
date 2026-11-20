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
  /** Only when the result text itself names a place ("Greater Paris
   *  Metropolitan Region", "Location: Lyon"); never guessed. */
  location?: string;
}

/** Platforms real-sourced via a site:-scoped web search rather than a dedicated API. */
export type WebSearchPlatform = "LinkedIn" | "Stack Overflow" | "Dribbble" | "Behance";

const WEB_SEARCH_PLATFORMS = new Set<SourcePlatform>(["Stack Overflow", "Dribbble", "Behance"]);

/** True for platforms sourced through the web-search discovery path in this module. */
export function isWebSearchPlatform(platform: SourcePlatform): platform is WebSearchPlatform {
  return WEB_SEARCH_PLATFORMS.has(platform);
}

const PLATFORM_DOMAINS: Record<Exclude<WebSearchPlatform, "LinkedIn">, string> = {
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

/** Scope a base boolean/keyword query to one platform. LinkedIn is refused: Aria does not search linkedin.com. */
export function buildWebQuery(platform: WebSearchPlatform, baseQuery: string): string {
  if (platform === "LinkedIn") throw new Error("LinkedIn web search is disabled.");
  return `site:${PLATFORM_DOMAINS[platform]} ${baseQuery}`.trim();
}

/** Add the platform site: scope once, preserving callers that already sent it. */
export function ensureWebQueryScope(platform: WebSearchPlatform, query: string): string {
  if (platform === "LinkedIn") throw new Error("LinkedIn web search is disabled.");
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
  let title = parts[1] ?? "";
  let company = parts[2] ?? "";
  // "Name - X": LinkedIn shows the current company there when the profile has
  // no public headline, so X is a title only if it reads like one.
  if (parts.length === 2 && !looksLikeJobTitle(title)) {
    company = title;
    title = "";
  }
  // "Senior Engineer at Acme" / "Ingénieur chez Acme"
  const atCompany = !company ? /^(.+?)\s+(?:at|chez|@)\s+(.+)$/i.exec(title) : null;
  if (atCompany) {
    title = atCompany[1]!.trim();
    company = atCompany[2]!.trim();
  }
  // LinkedIn puts the member's location where a company would be when the
  // profile shows no employer: keep it as a location, not a company.
  let location = "";
  if (company && looksLikeLocation(company)) {
    location = company;
    company = "";
  }
  if (title && looksLikeLocation(title)) {
    location ||= title;
    title = "";
  }
  // A bio sentence in the headline slot ("As an expert in ... · Location:
  // Paris.") is not a job title; its stated location still counts.
  if (title && (/^(?:i|i'm|i am|my|we|as an?)\b/i.test(title) || title.length > 100 || /\blocation\s*:/i.test(title))) {
    location ||= locationFromText(title);
    title = "";
  }
  const snippet = cleanSnippet(hit.snippet);
  location ||= locationFromText(snippet);
  // No headline in the title: use the snippet's first sentence only when it
  // reads like a job title; a bio sentence or a list of "similar profiles" is
  // not a headline.
  if (!title) title = headlineFromSnippet(snippet);
  const lead: WebLead = { name, title, company, url: hit.url, snippet: snippet.slice(0, 300) };
  if (location) lead.location = location.slice(0, 120);
  return lead;
}

/** Search-result text without markdown headings, bullets, emoji and the
 *  "Other similar profiles" block LinkedIn appends to a public page. */
export function cleanSnippet(text: string): string {
  return text
    .split(/#{1,6}\s*(?:other similar profiles|people also viewed|explore more posts)/i)[0]!
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineFromSnippet(snippet: string): string {
  const first = snippet.split(/(?<=[.!?])\s|\s[·|]\s/)[0]?.trim() ?? "";
  if (!first || first.length > 90 || /^(?:i|i'm|i am|my|we|as an?)\b/i.test(first)) return "";
  return looksLikeJobTitle(first) ? first.replace(/[.!?]$/, "") : "";
}

const COUNTRIES =
  /\b(?:france|united kingdom|uk|germany|deutschland|spain|espa[ñn]a|italy|italia|belgium|belgique|netherlands|switzerland|suisse|portugal|ireland|luxembourg|austria|poland|sweden|denmark|norway|finland|united states|usa|canada|singapore|india|morocco|maroc|tunisia|tunisie|united arab emirates|uae)\b/i;

/** "Greater Paris Metropolitan Region", "Paris, Île-de-France, France", "Lyon Area". */
export function looksLikeLocation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80 || looksLikeJobTitle(t)) return false;
  if (/\bgreater\s+\S.*\b(?:area|region)\b|\bmetropolitan\b|[îi]le-de-france|\br[ée]gion(?!\p{L})/iu.test(t)) return true;
  if (/^[\p{L} .'-]+\s+area$/iu.test(t)) return true;
  // "City, Region, Country" or "City, Country" ending with a known country.
  return /^[\p{L} .'-]+(?:,\s*[\p{L} .'-]+){1,2}$/u.test(t) && COUNTRIES.test(t.split(",").pop()!);
}

/** A place the result text states outright: "Location: Paris". */
function locationFromText(text: string): string {
  const stated = /\b(?:location|localisation|lieu)\s*:\s*([\p{L} '-]+(?:,\s*[\p{L} '-]+){0,2})/iu.exec(text);
  if (stated) return stated[1]!.trim().replace(/[.\s]+$/, "");
  const segment = text.split(/\s[·|]\s/).map((s) => s.trim()).find((s) => looksLikeLocation(s));
  return segment ?? "";
}

/** Job-title vocabulary (English and French) that a company name rarely contains. */
const JOB_TITLE_WORDS =
  /\b(?:engineer|developer|programmer|architect|manager|lead|head of|director|consultant|analyst|scientist|designer|devops|sre|administrator|specialist|officer|cto|ceo|cfo|coo|cio|vp|founder|co-founder|recruiter|intern|student|freelance|freelancer|expert|technician|coordinator|product owner|scrum master|tester|ing[ée]nieure?|d[ée]veloppeu(?:r|se)|chef de projet|responsable|directeur|directrice|architecte|stagiaire|alternante?|technicienne?|charg[ée]e? de)\b/i;

function looksLikeJobTitle(text: string): boolean {
  return JOB_TITLE_WORDS.test(text);
}
