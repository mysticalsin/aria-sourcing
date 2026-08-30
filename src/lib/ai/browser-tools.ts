// Stateful, multi-step browser tools for public research, backed by the
// transparent Obscura sidecar (src/lib/ai/obscura-adapter.ts).
//
//   - No stealth or private-network access.
//   - Interaction: click, scroll, wait, back, and forward only.
//   - No persistent identity: every browser_open gets a fresh, cookie-empty context.
//   - Bounded session lifetime: enforced by obscura-adapter.ts's sweeper.
//   - SSRF + robots.txt checked on open AND on every navigation.

import type { McpTool } from "@/lib/mcp-client";
import { assertPublicUrl } from "@/lib/api/url";
import { fetchPublicUrl } from "@/lib/api/public-fetch";
import {
  openObscuraSession,
  touchObscuraSession,
  closeObscuraSession,
  type ObscuraSession,
} from "@/lib/ai/obscura-adapter";

/** Sentinel "server url" that marks the built-in browser tools inside the tool-loop.
 *  Kept in sync with `BUILTIN_BROWSER_URL` in tool-loop.ts (tool-loop owns the
 *  canonical export so sourcing can load without importing playwright). */
export const BUILTIN_BROWSER_URL = "builtin:browser-research";

const USER_AGENT = "ARIAResearchBot/1.0";
const NAV_TIMEOUT_MS = 15_000;
const ROBOTS_TIMEOUT_MS = 15_000;
const MAX_TEXT = 6_000;
const MAX_SCREENSHOT_BYTES = 1_500_000;

type BrowserEgressEnvironment = {
  NODE_ENV?: string;
  OBSCURA_PUBLIC_EGRESS_VERIFIED?: string;
  OBSCURA_TEST_MODE?: string;
};

/**
 * Chromium owns its own DNS and sockets, so Node-side URL validation cannot
 * close DNS rebinding. Production stays disabled until the sidecar is isolated
 * behind a verified public-only egress proxy and container network policy.
 */
export function browserEgressReady(env: BrowserEgressEnvironment = process.env): boolean {
  return (
    env.OBSCURA_PUBLIC_EGRESS_VERIFIED === "true" ||
    (env.NODE_ENV === "test" && env.OBSCURA_TEST_MODE === "true")
  );
}

export interface ToolResult {
  ok: boolean;
  content?: unknown;
  error?: string;
}

/** The public-research actions a caller may request. */
const ALLOWED_ACT_TYPES = new Set(["click", "scroll", "wait", "back", "forward"]);

export const BROWSER_TOOL_DEFS: McpTool[] = [
  {
    name: "browser_open",
    description:
      "Open a PUBLIC web page in a real (read-only, JS-executing) browser session and return its rendered text. Use only when fetch_page can't read a JS-rendered page. Returns a sessionId for follow-up browser_act/browser_extract/browser_close calls. Sessions auto-expire (idle 60s / hard cap 5min).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute HTTPS URL of a public page." } },
      required: ["url"],
    },
  },
  {
    name: "browser_act",
    description:
      "Perform one public-research interaction in an open browser session: click, scroll, wait, back, or forward.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id from browser_open." },
        type: { type: "string", enum: ["click", "scroll", "wait", "back", "forward"], description: "The action to perform." },
        selector: { type: "string", description: "CSS selector, required for click and optional for wait." },
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction, required for scroll." },
        ms: { type: "number", description: "Milliseconds to wait, for wait (used when selector is omitted)." },
      },
      required: ["sessionId", "type"],
    },
  },
  {
    name: "browser_extract",
    description: "Return the current page's title, URL, and readable text for an open browser session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "Session id from browser_open." } },
      required: ["sessionId"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a PNG screenshot (base64) of the current page in an open browser session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "Session id from browser_open." } },
      required: ["sessionId"],
    },
  },
  {
    name: "browser_close",
    description: "Explicitly close an open browser session (it will also auto-expire on its own).",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "Session id from browser_open." } },
      required: ["sessionId"],
    },
  },
];

const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOL_DEFS.map((t) => t.name));

/** True if `name` is one of the built-in browser tools. */
export function isBrowserTool(name: string): boolean {
  return BROWSER_TOOL_NAMES.has(name);
}

/* ----------------------------- robots.txt --------------------------------- */

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Very small robots.txt parser: groups by User-agent, longest-prefix-match wins. Exported for direct unit testing. */
export function parseRobotsTxt(body: string): Map<string, RobotsRules> {
  const groups = new Map<string, RobotsRules>();
  let currentAgents: string[] = [];
  let groupOpen = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawField, ...rest] = line.split(":");
    if (!rawField || rest.length === 0) continue;
    const field = rawField.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      if (groupOpen) {
        // A new User-agent line after rules already started a fresh group.
        currentAgents = [];
        groupOpen = false;
      }
      currentAgents.push(value.toLowerCase());
      for (const agent of currentAgents) {
        if (!groups.has(agent)) groups.set(agent, { allow: [], disallow: [] });
      }
    } else if (field === "allow" || field === "disallow") {
      groupOpen = true;
      for (const agent of currentAgents) {
        const rules = groups.get(agent);
        if (!rules) continue;
        if (field === "allow") rules.allow.push(value);
        else if (value) rules.disallow.push(value); // empty Disallow means "allow everything"
      }
    }
  }
  return groups;
}

/** Longest-prefix-match wins between allow/disallow rules. Exported for direct unit testing. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let bestLen = -1;
  let bestAllowed = true;
  for (const p of rules.disallow) {
    if (path.startsWith(p) && p.length > bestLen) {
      bestLen = p.length;
      bestAllowed = false;
    }
  }
  for (const p of rules.allow) {
    if (path.startsWith(p) && p.length > bestLen) {
      bestLen = p.length;
      bestAllowed = true;
    }
  }
  return bestAllowed;
}

const OUR_UA_TOKEN = "ariaresearchbot";

/** robots.txt check for a navigation target. Fails CLOSED on network/server errors. */
async function checkRobotsAllowed(target: URL): Promise<{ allowed: boolean; reason?: string }> {
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  let res: Response;
  try {
    res = await fetchPublicUrl(robotsUrl, {
      method: "GET",
      headers: { accept: "text/plain", "user-agent": USER_AGENT },
      redirect: "manual",
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxResponseBytes: 256_000,
    });
  } catch {
    return { allowed: false, reason: "robots.txt unreachable; blocking to be safe." };
  }
  if (res.status === 404) return { allowed: true };
  if (!res.ok) return { allowed: false, reason: `robots.txt returned HTTP ${res.status}; blocking to be safe.` };

  const groups = parseRobotsTxt(await res.text());
  const rules = groups.get(OUR_UA_TOKEN) ?? groups.get("*");
  if (!rules) return { allowed: true };
  const path = target.pathname + target.search;
  return isPathAllowed(rules, path)
    ? { allowed: true }
    : { allowed: false, reason: `Disallowed by robots.txt for ${rules === groups.get(OUR_UA_TOKEN) ? OUR_UA_TOKEN : "*"}.` };
}

/** SSRF guard + robots.txt check, run before browser_open and before every same-session navigation. */
async function assertNavigable(urlRaw: string): Promise<{ ok: boolean; url?: URL; error?: string }> {
  let url: URL;
  try {
    url = new URL(urlRaw);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  const guard = await assertPublicUrl(url.toString());
  if (!guard.ok) return { ok: false, error: guard.reason ?? "URL blocked." };
  const robots = await checkRobotsAllowed(url);
  if (!robots.allowed) return { ok: false, error: robots.reason ?? "Blocked by robots.txt." };
  return { ok: true, url };
}

/* ----------------------------- session registry ---------------------------- */

const sessionRegistry = new Map<string, ObscuraSession>();

function requireSession(sessionId: string): { ok: true; session: ObscuraSession } | { ok: false; error: string } {
  const session = touchObscuraSession(sessionId);
  if (!session) return { ok: false, error: "Session not found or expired." };
  sessionRegistry.set(sessionId, session);
  return { ok: true, session };
}

/* ----------------------------- tools --------------------------------------- */

async function pageTextAndTitle(session: ObscuraSession): Promise<{ title: string; text: string; url: string }> {
  const title = await session.page.title();
  const url = session.page.url();
  const text = await session.page
    .evaluate(() => document.body?.innerText ?? "")
    .catch(() => "");
  return { title, text: text.slice(0, MAX_TEXT), url };
}

async function browserOpen(urlRaw: string): Promise<ToolResult> {
  const nav = await assertNavigable(urlRaw);
  if (!nav.ok || !nav.url) return { ok: false, error: nav.error };

  let session: ObscuraSession;
  try {
    session = await openObscuraSession();
  } catch {
    return { ok: false, error: "Browser sidecar unavailable." };
  }
  sessionRegistry.set(session.id, session);

  try {
    await session.page.goto(nav.url.toString(), { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    await closeObscuraSession(session.id);
    sessionRegistry.delete(session.id);
    return { ok: false, error: err instanceof Error ? err.message : "Navigation failed." };
  }

  const { title, text, url } = await pageTextAndTitle(session);
  return { ok: true, content: { sessionId: session.id, url, title, text, truncated: text.length >= MAX_TEXT } };
}

async function browserAct(sessionId: string, args: Record<string, unknown>): Promise<ToolResult> {
  // Validate the action shape before touching the session table -- fail fast on bad
  // input, and let the vocabulary allowlist be unit-tested without a live session.
  const type = String(args.type ?? "");
  if (!ALLOWED_ACT_TYPES.has(type)) {
    return { ok: false, error: `Action "${type}" is not allowed. Allowed: click, scroll, wait, back, forward.` };
  }

  const found = requireSession(sessionId);
  if (!found.ok) return { ok: false, error: found.error };
  const { session } = found;

  try {
    switch (type) {
      case "click": {
        const selector = String(args.selector ?? "");
        if (!selector) return { ok: false, error: "click requires a selector." };
        // Obscura's CDP Input domain doesn't fully satisfy Playwright's
        // page.click() actionability/hit-test polling (it hangs waiting on
        // protocol responses Obscura's lighter-weight Input/DOM domains don't
        // return in the shape Playwright expects). element.click() is spec'd
        // to dispatch a properly trusted click event -- same effective result
        // for our use case (trigger the element's click handler / link
        // navigation) -- and only needs Runtime.evaluate, which is solid.
        await session.page.waitForSelector(selector, { timeout: NAV_TIMEOUT_MS });
        // The click may trigger a navigation partway through the evaluate() call
        // itself, tearing down its execution context before the `true` return value
        // makes it back -- that's a SUCCESS (the click landed and navigation started),
        // not a failure, so it's distinguished from a genuine evaluate error below.
        let clicked = false;
        try {
          clicked = await session.page.evaluate((sel) => {
            const el = document.querySelector(sel as string) as HTMLElement | null;
            if (!el) return false;
            el.click();
            return true;
          }, selector);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/execution context was destroyed/i.test(msg)) throw err;
          clicked = true;
        }
        // Whether or not a navigation started, wait for it to settle -- if nothing
        // navigated, "load" is already satisfied and this resolves immediately.
        await session.page.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
        if (!clicked) return { ok: false, error: `No element matches selector "${selector}".` };
        break;
      }
      case "scroll": {
        const direction = args.direction === "up" ? -1 : 1;
        await session.page.evaluate((dy) => window.scrollBy(0, dy), direction * 800);
        break;
      }
      case "wait": {
        const selector = args.selector ? String(args.selector) : undefined;
        if (selector) {
          await session.page.waitForSelector(selector, { timeout: NAV_TIMEOUT_MS });
        } else {
          const ms = Math.max(0, Math.min(Number(args.ms ?? 500), NAV_TIMEOUT_MS));
          await session.page.waitForTimeout(ms);
        }
        break;
      }
      case "back":
        await session.page.goBack({ waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        break;
      case "forward":
        await session.page.goForward({ waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        break;
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Action failed." };
  }

  // A click/back/forward may have navigated -- re-check SSRF + robots.txt on the resulting URL.
  const currentUrl = session.page.url();
  if (currentUrl && currentUrl !== "about:blank") {
    const nav = await assertNavigable(currentUrl);
    if (!nav.ok) {
      await closeObscuraSession(session.id);
      sessionRegistry.delete(session.id);
      return { ok: false, error: nav.error ?? "Navigation blocked after action." };
    }
  }

  const { title, text, url } = await pageTextAndTitle(session);
  return { ok: true, content: { url, title, text, truncated: text.length >= MAX_TEXT } };
}

async function browserExtract(sessionId: string): Promise<ToolResult> {
  const found = requireSession(sessionId);
  if (!found.ok) return { ok: false, error: found.error };
  const { title, text, url } = await pageTextAndTitle(found.session);
  return { ok: true, content: { url, title, text, truncated: text.length >= MAX_TEXT } };
}

async function browserScreenshot(sessionId: string): Promise<ToolResult> {
  const found = requireSession(sessionId);
  if (!found.ok) return { ok: false, error: found.error };
  let buf: Buffer;
  try {
    buf = await found.session.page.screenshot({ type: "png" });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Screenshot failed." };
  }
  if (buf.byteLength > MAX_SCREENSHOT_BYTES) {
    return { ok: false, error: "Screenshot too large." };
  }
  return { ok: true, content: { mimeType: "image/png", base64: buf.toString("base64") } };
}

async function browserClose(sessionId: string): Promise<ToolResult> {
  await closeObscuraSession(sessionId);
  sessionRegistry.delete(sessionId);
  return { ok: true, content: { closed: true } };
}

/**
 * Execute a built-in browser tool by name. Same {ok, content, error} contract as
 * runWebTool/callMcpTool, so the tool-loop can dispatch to it interchangeably. Never throws.
 */
export async function runBrowserTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (!browserEgressReady()) {
      if (name === "browser_close") return await browserClose(String(args.sessionId ?? ""));
      return { ok: false, error: "Browser research is disabled until public-only sidecar egress is verified." };
    }
    switch (name) {
      case "browser_open":
        return await browserOpen(String(args.url ?? ""));
      case "browser_act":
        return await browserAct(String(args.sessionId ?? ""), args);
      case "browser_extract":
        return await browserExtract(String(args.sessionId ?? ""));
      case "browser_screenshot":
        return await browserScreenshot(String(args.sessionId ?? ""));
      case "browser_close":
        return await browserClose(String(args.sessionId ?? ""));
      default:
        return { ok: false, error: "Unknown browser tool." };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Browser tool error." };
  }
}
