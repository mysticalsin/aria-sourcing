// Built-in, read-only WEB RESEARCH tools for the agent tool-loop.
//
// These give the fleet the ability to *read* the public internet — search,
// fetch a page, read a feed — so agents can gather research/sourcing signals.
// They are deliberately NON-EVASIVE and compliant by construction:
//   - honest bot User-Agent (never impersonates a human browser),
//   - no cookies / sessions / logins / form submission (read-only GET),
//   - no stealth, fingerprint spoofing, CAPTCHA solving, or proxy rotation,
//   - SSRF-guarded (assertPublicUrl blocks private/loopback/metadata + DNS-rebind),
//   - redirect:"manual" (a 30x can't bounce to an internal host),
//   - hard timeout + response size cap + compact truncated output.
// Search uses an official API when configured (TAVILY_API_KEY), else DuckDuckGo's
// public, documented, key-less Instant Answer JSON API.

import type { McpTool } from "@/lib/mcp-client";
import { assertPublicUrl } from "@/lib/api/url";

/** Sentinel "server url" that marks the built-in web tools inside the tool-loop. */
export const BUILTIN_WEB_URL = "builtin:web-research";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000; // 1.5 MB cap on any fetched body
const MAX_TEXT = 6_000; // chars of page text returned to the model
const MAX_RESULTS = 8; // search results returned
const USER_AGENT = "AriaResearchBot/1.0 (+read-only; https://aria-sourcing-demo.vercel.app)";

/** Tool definitions in the same shape MCP tools use, so the existing tool-def builders work unchanged. */
export const WEB_TOOL_DEFS: McpTool[] = [
  {
    name: "web_search",
    description:
      "Search the public web and return a short list of {title, url, snippet}. Read-only research signal — never for contacting people.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query." } },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch a single PUBLIC web page by absolute http(s) URL and return its readable text (HTML stripped, truncated). Read-only: no login, no forms, no redirects followed.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL of a public page." } },
      required: ["url"],
    },
  },
  {
    name: "rss",
    description:
      "Fetch and parse a public RSS/Atom feed and return recent items {title, link, date, summary}. Read-only.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL of an RSS/Atom feed." } },
      required: ["url"],
    },
  },
];

const WEB_TOOL_NAMES = new Set(WEB_TOOL_DEFS.map((t) => t.name));

/** True if `name` is one of the built-in web-research tools. */
export function isWebTool(name: string): boolean {
  return WEB_TOOL_NAMES.has(name);
}

export interface ToolResult {
  ok: boolean;
  content?: unknown;
  error?: string;
}

/* ----------------------------- helpers ----------------------------------- */

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Read a response body up to `maxBytes`, cancelling the stream once the cap is hit. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, total)).slice(0, maxBytes);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Strip HTML to a title + collapsed plain-text body. */
export function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

/** SSRF-guarded, read-only GET with redirect + timeout + size caps. */
async function safeGet(
  url: string,
  accept: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const guard = await assertPublicUrl(url);
  if (!guard.ok) return { ok: false, error: guard.reason ?? "URL blocked." };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { accept, "user-agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error." };
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return { ok: false, error: "Redirect blocked (SSRF guard)." };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, body: await readCapped(res, MAX_BYTES) };
}

/* ----------------------------- tools ------------------------------------- */

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function tavilySearch(query: string, key: string): Promise<ToolResult | null> {
  const guard = await assertPublicUrl("https://api.tavily.com/search");
  if (!guard.ok) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ api_key: key, query, max_results: MAX_RESULTS, search_depth: "basic" }),
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { results?: { title?: string; url?: string; content?: string }[] }
      | null;
    const results: SearchHit[] = (data?.results ?? [])
      .filter((r) => r.url)
      .slice(0, MAX_RESULTS)
      .map((r) => ({ title: (r.title ?? "").slice(0, 120), url: r.url as string, snippet: (r.content ?? "").slice(0, 300) }));
    return { ok: true, content: { query, results, source: "tavily" } };
  } catch {
    return null;
  }
}

async function webSearch(queryRaw: string, storedTavilyKey?: string): Promise<ToolResult> {
  const query = queryRaw.trim().slice(0, 300);
  if (!query) return { ok: false, error: "Empty query." };

  // Prefer an official search API when configured.
  const tavilyKey = storedTavilyKey ?? process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    const t = await tavilySearch(query, tavilyKey);
    if (t) return t;
  }

  // Key-less default: DuckDuckGo Instant Answer JSON API (public, documented).
  const r = await safeGet(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&t=aria`,
    "application/json",
  );
  if (!r.ok) return { ok: false, error: r.error };
  let data: {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { FirstURL?: string; Text?: string; Topics?: { FirstURL?: string; Text?: string }[] }[];
  };
  try {
    data = JSON.parse(r.body ?? "{}");
  } catch {
    return { ok: false, error: "Malformed search response." };
  }
  const results: SearchHit[] = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({ title: (data.Heading || query).slice(0, 120), url: data.AbstractURL, snippet: data.AbstractText.slice(0, 300) });
  }
  for (const topic of data.RelatedTopics ?? []) {
    const flat = topic.Topics ?? [topic];
    for (const it of flat) {
      if (results.length >= MAX_RESULTS) break;
      if (it.FirstURL && it.Text) {
        results.push({ title: it.Text.slice(0, 120), url: it.FirstURL, snippet: it.Text.slice(0, 300) });
      }
    }
    if (results.length >= MAX_RESULTS) break;
  }
  return { ok: true, content: { query, results, source: "duckduckgo" } };
}

async function fetchPage(urlRaw: string): Promise<ToolResult> {
  const url = urlRaw.trim();
  if (!url) return { ok: false, error: "Missing url." };
  const r = await safeGet(url, "text/html,application/xhtml+xml,text/plain");
  if (!r.ok) return { ok: false, error: r.error };
  const { title, text } = stripHtml(r.body ?? "");
  return {
    ok: true,
    content: { url, title, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT },
  };
}

/** Extract the inner text of the first `<tag>…</tag>` (handles CDATA). */
function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  const inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

/** Atom feeds use `<link href="…"/>`; pull the href when present. */
function linkHref(block: string): string {
  const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : "";
}

async function rss(urlRaw: string): Promise<ToolResult> {
  const url = urlRaw.trim();
  if (!url) return { ok: false, error: "Missing url." };
  const r = await safeGet(url, "application/rss+xml,application/atom+xml,application/xml,text/xml");
  if (!r.ok) return { ok: false, error: r.error };
  const xml = r.body ?? "";
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items = blocks.slice(0, 15).map((b) => ({
    title: tagText(b, "title").slice(0, 200),
    link: (tagText(b, "link") || linkHref(b)).slice(0, 500),
    date: (tagText(b, "pubDate") || tagText(b, "updated") || tagText(b, "published")).slice(0, 60),
    summary: (tagText(b, "description") || tagText(b, "summary") || tagText(b, "content")).slice(0, 300),
  }));
  return { ok: true, content: { url, count: items.length, items } };
}

/**
 * Execute a built-in web tool by name. Same {ok, content, error} contract as callMcpTool,
 * so the tool-loop can dispatch to it interchangeably. Never throws.
 */
export async function runWebTool(
  name: string,
  args: Record<string, unknown>,
  opts: { tavilyKey?: string } = {},
): Promise<ToolResult> {
  try {
    switch (name) {
      case "web_search":
        return await webSearch(String(args.query ?? ""), opts.tavilyKey);
      case "fetch_page":
        return await fetchPage(String(args.url ?? ""));
      case "rss":
        return await rss(String(args.url ?? ""));
      default:
        return { ok: false, error: "Unknown web tool." };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Web tool error." };
  }
}
