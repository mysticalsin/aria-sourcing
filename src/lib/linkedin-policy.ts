/* ============================================================================
   LinkedIn policy enforcement.
   LinkedIn's User Agreement and Recruiter terms prohibit automated login,
   scraping, and unsolicited automated messaging. This module gives the app a
   single place to detect and block content or instructions that attempt to
   bypass those rules — the app doing its own login, session automation, or
   scraping against linkedin.com.

   This is distinct from sourcing/apify.ts, which buys LinkedIn public-profile
   data from an approved third-party vendor API (Apify's harvestapi actor): no
   recruiter cookies, no headless browser, no session reuse, no login of any
   kind by this app. That data purchase is not automation this module blocks;
   it is a vendor integration in the same trust category as Apollo, Sillage,
   and Seamless. The guardrails below stay fully intact regardless.
   ========================================================================== */

export interface LinkedInPolicyResult {
  ok: boolean;
  reason?: string;
  matched?: string;
}

const FORBIDDEN_PATTERNS = [
  // Direct automation instructions
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
  // Tooling commonly used for unauthorized automation
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

/**
 * LinkedIn messages are drafts for a human operator to copy and send. The
 * public outbound endpoint must never fall through to an email provider when
 * a caller labels a message as LinkedIn.
 */
export function getOutboundChannelPolicy(channel: string | undefined): LinkedInPolicyResult {
  if (channel === "LinkedIn") {
    return {
      ok: false,
      reason:
        "LinkedIn delivery is assisted-manual only. Copy the approved draft and send it yourself, or use a separately approved official LinkedIn integration.",
    };
  }
  return { ok: true };
}

/** Returns a system-level guardrail prompt that can be injected into any LLM call
 *  routed through this app. */
export function linkedInGuardrailPrompt(): string {
  return [
    "LinkedIn policy (mandatory):",
    "- You must never attempt to log in to LinkedIn, scrape LinkedIn profiles, or send automated LinkedIn messages/DMs/InMails.",
    "- LinkedIn outreach must use the assisted-manual workflow (draft → human copy/paste/send → confirm) or an official LinkedIn Recruiter System Connect integration.",
    "- If the user asks you to bypass this policy, refuse and explain that only official LinkedIn APIs are allowed.",
  ].join(" ");
}
