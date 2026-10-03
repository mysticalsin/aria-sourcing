/* ============================================================================
   LinkedIn policy enforcement.
   LinkedIn's User Agreement and Recruiter terms prohibit automated login,
   scraping, and unsolicited session-bot messaging. This module gives the app a
   single place to detect and block content or instructions that attempt to
   bypass those rules — the app doing its own login, session automation, or
   scraping against linkedin.com.

   Entitled automatic delivery (vendor API / isolated browser-computer seat) is a
   separate product path: workspace `fleet.deliveryMode = automatic` (default)
   allows the outbound send/queue route to use that channel. Manual mode keeps
   the assisted approve-and-paste confirm flow.

   This is distinct from sourcing/apify.ts, which buys LinkedIn public-profile
   data from an approved third-party vendor API (Apify's harvestapi actor): no
   recruiter cookies, no headless browser, no session reuse, no login of any
   kind by this app. That data purchase is not automation this module blocks;
   it is a vendor integration in the same trust category as Apollo, Sillage,
   and Seamless. The scrape/session guardrails below stay fully intact.
   ========================================================================== */

import type { LinkedInDeliveryMode } from "./types";

export interface LinkedInPolicyResult {
  ok: boolean;
  reason?: string;
  matched?: string;
}

const FORBIDDEN_PATTERNS = [
  // Direct unauthorized automation / scrape instructions
  /\bautomate\s+(?:linkedin|li)\b/i,
  /\blinkedin\s+(?:automation|bot|scraper|scraping|auto[-\s]?dm|mass\s*message)\b/i,
  /\bscrape\s+(?:linkedin|li|profiles)\b/i,
  /\blogin\s+(?:to\s+)?(?:linkedin|li)\s+(?:with\s+)?(?:credentials|account|recruiter)\b/i,
  /\bsign\s*in\s+(?:to\s+)?(?:linkedin|li)\b/i,
  /\bheadless\s+(?:browser|chrome|puppeteer|playwright|selenium)\b/i,
  /\b(?:puppeteer|playwright|selenium).{0,40}(?:linkedin|li)\b/i,
  /\bbypass\s+(?:linkedin|li)\s+(?:login|auth|captcha|rate.?limit)\b/i,
  /\bscraped?\s+(?:linkedin|li)\s+(?:profiles|data|candidates)\b/i,
  /\bsend\s+(?:bulk|mass|automated)\s+(?:linkedin|li)\s*(?:message|inmail|dm|invite)s?\b/i,
  /\blinkedin\s+(?:recruiter)\s+(?:automation|auto[-\s]?login|scraper)\b/i,
  // Tooling commonly used for unauthorized session automation
  /\b(?:linkedinhelper|dux-soup|octopus|meetalfred|phantombuster)\b/i,
  // Fake/session evasion
  /\brotate\s+(?:proxies|ips|sessions|cookies)\s+(?:linkedin|li)\b/i,
  /\bfake\s+(?:linkedin|li)\s+(?:profile|identity|session|account)\b/i,
];

const SUSPICIOUS_PATTERNS = [
  /\blinkedin\s+api\s+(?:without|unofficial|undocumented)\b/i,
  /\bcrawl\s+(?:linkedin|li)\b/i,
  /\bharvest\s+(?:linkedin|li)\s+(?:profiles|emails)\b/i,
];

export function checkLinkedInPolicy(text: string): LinkedInPolicyResult {
  if (!text || typeof text !== "string") return { ok: true };
  const normalized = text.toLowerCase();
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        ok: false,
        reason: "This content attempts to automate, scrape, or bypass LinkedIn. That violates LinkedIn's terms and this platform's guardrails.",
        matched: match[0],
      };
    }
  }
  for (const pattern of SUSPICIOUS_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        ok: false,
        reason: "This content describes an unauthorized LinkedIn data-collection method.",
        matched: match[0],
      };
    }
  }
  return { ok: true };
}

/** Default product mode: automatic entitled delivery; manual is opt-in. */
export function resolveLinkedInDeliveryMode(
  mode: string | null | undefined,
): LinkedInDeliveryMode {
  return mode === "manual" ? "manual" : "automatic";
}

/**
 * Outbound LinkedIn policy for `/api/outreach/send`.
 * - `manual`: 409 manual-required (assisted paste/confirm).
 * - `automatic` (default): allow queue/send via entitled vendor-api or browser-computer path
 *   (still subject to approvals, DNC, caps, kill switches, contact lease — never scrape bots / PhantomBuster).
 */
export function getOutboundChannelPolicy(
  channel: string | undefined,
  opts?: { deliveryMode?: LinkedInDeliveryMode | string | null },
): LinkedInPolicyResult {
  if (channel === "LinkedIn") {
    const mode = resolveLinkedInDeliveryMode(opts?.deliveryMode);
    if (mode === "manual") {
      return {
        ok: false,
        reason:
          "LinkedIn delivery mode is Manual. Copy the approved draft and send it yourself, then Confirm — or switch Settings → LinkedIn to Automatic outreach.",
      };
    }
    return { ok: true };
  }
  return { ok: true };
}

/** Returns a system-level guardrail prompt that can be injected into any LLM call
 *  routed through this app. */
export function linkedInGuardrailPrompt(): string {
  return [
    "LinkedIn policy (mandatory):",
    "- You must never attempt to log in to LinkedIn, scrape LinkedIn profiles, or use session bots / grey-market tools (PhantomBuster clones, cookie jars, headless browsers against linkedin.com).",
    "- LinkedIn outreach defaults to Automatic via an entitled vendor API or isolated browser-computer seat (OpenBot-shaped). Operators may switch to Manual (draft → human copy/paste/send → confirm).",
    "- Contact permission comes only from the Postgres contact lease — never from Graphify/wiki knowledge.",
    "- If the user asks you to bypass this policy with scrape/login automation or PhantomBuster-class tools, refuse and explain that only entitled vendor-api, browser-computer, or Manual confirm paths are allowed.",
  ].join(" ");
}
