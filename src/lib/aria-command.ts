/* ============================================================================
   Aria Command — a deterministic, offline grammar that turns a single
   natural-language instruction into a previewable, steppable plan.

   Pure and side-effect free: no store imports, no network calls, no
   randomness. Garbage input never throws — it degrades to an empty plan.
   The actual execution of a parsed plan happens elsewhere (store.ts's
   `runAriaPlan`, driven by the Aria Command console) — this module only
   understands the sentence.
   ========================================================================== */

import type { Campaign } from "./types";

export type AriaVerb = "source" | "draft" | "follow-up" | "book" | "pool" | "report";

export interface AriaPlanStep {
  verb: AriaVerb;
  count?: number;
  role?: string;
  city?: string;
  campaignId?: string;
  label: string;
}

export interface AriaPlan {
  steps: AriaPlanStep[];
  matchedCampaignId?: string;
  summary: string;
  raw: string;
}

/** Minimal campaign projection the grammar fuzzy-matches against. Kept
 *  decoupled from the full `Campaign` type so this module never needs a
 *  store/state import — see `campaignToAriaContext` below for the real
 *  mapping used by the UI. */
export interface AriaCampaignCtx {
  id: string;
  role?: string;
  title?: string;
  location?: string;
}

/** Projects a real `Campaign` into the grammar's matching context. Folds
 *  industry experience into `role` (free-text signal for fuzzy matching, e.g.
 *  "fintech") and regions into `location` — the campaign's own title/role stay
 *  the primary, cleanest label. Exported so both the console and the command
 *  palette build the same context the same way. */
export function campaignToAriaContext(c: Campaign): AriaCampaignCtx {
  // Fail-soft: remote/cached blobs can omit `jobAnalysis` (or title). This
  // projection runs from always-mounted shell chrome (Aria Command console);
  // throwing here takes down the whole app via global-error.
  const title = typeof c?.title === "string" ? c.title : "";
  const jd = c?.jobAnalysis;
  const jdTitle = typeof jd?.title === "string" ? jd.title : title;
  const industry = Array.isArray(jd?.industryExperience) ? jd.industryExperience : [];
  const regions = Array.isArray(jd?.regions) ? jd.regions : [];
  return {
    id: typeof c?.id === "string" ? c.id : "",
    role: [jdTitle, ...industry].filter(Boolean).join(" "),
    title,
    location: regions.join(", "),
  };
}

/* ---- verb grammar ---------------------------------------------------------- */

// Logical execution order — a parsed plan is always sorted to this order
// regardless of the order verbs appeared in the sentence.
const VERB_ORDER: AriaVerb[] = ["source", "draft", "follow-up", "book", "pool", "report"];

const VERB_PATTERNS: Record<AriaVerb, RegExp> = {
  source: /\b(source|sourcing|find|search|scout|look for)\b/i,
  draft: /\b(draft|drafting|outreach|message|email|reach out|compose|write to|contact)\b/i,
  "follow-up": /\b(follow[\s-]?up|followup|nudge|re-?engage|check in|ping again)\b/i,
  book: /\b(book|schedule|interview|invite)\b/i,
  pool: /\b(pool|shortlist|talent pool|#?vivier|save for later|stash)\b/i,
  report: /\b(report|summary|summarize|summarise|status update|weekly report)\b/i,
};

/* ---- number words ----------------------------------------------------------- */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const TENS_ALT = Object.keys(TENS).join("|");
const ONES_ALT = Object.keys(ONES).join("|");
const COMPOUND_NUMBER = new RegExp(`\\b(${TENS_ALT})(?:[\\s-](${ONES_ALT}))?\\b`, "i");
const ONES_ONLY_NUMBER = new RegExp(`\\b(${ONES_ALT})\\b`, "i");

/** Parses "15" / "fifteen" / "twenty-five" style counts out of free text.
 *  Digits win when present (least ambiguous); otherwise falls back to a small
 *  number-word grammar (0-99), plus a couple of common colloquialisms.
 *  Returns undefined when nothing looks like a count. */
function extractCount(text: string): number | undefined {
  const digit = text.match(/\b(\d{1,4})\b/);
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const compound = text.match(COMPOUND_NUMBER);
  if (compound) {
    const base = TENS[compound[1].toLowerCase()] ?? 0;
    const extra = compound[2] ? ONES[compound[2].toLowerCase()] ?? 0 : 0;
    if (base + extra > 0) return base + extra;
  }
  const onesOnly = text.match(ONES_ONLY_NUMBER);
  if (onesOnly) {
    const n = ONES[onesOnly[1].toLowerCase()];
    if (n > 0) return n;
  }
  if (/\ba\s+dozen\b/i.test(text)) return 12;
  if (/\ba\s+couple\b/i.test(text)) return 2;
  if (/\b(a\s+few|several|a\s+handful)\b/i.test(text)) return 5;
  return undefined;
}

/** Sensible default batch size for a "source" step with no explicit count. */
const DEFAULT_SOURCE_COUNT = 10;

/* ---- clause splitting -------------------------------------------------------- */

/** Splits a sentence into rough clauses on commas/semicolons and sequencing
 *  words ("and", "then") — good enough to separate "source X, draft Y, and
 *  book Z" into three independently-classifiable fragments. Not a real parser:
 *  a role phrase containing "and" (e.g. "backend and frontend engineers") will
 *  over-split, which just means that fragment won't match a verb and is
 *  silently dropped — never a crash, never a wrong step. */
function splitClauses(text: string): string[] {
  return text
    .split(/[,;]+|\band\s+then\b|\bthen\b|\band\b/gi)
    .map((c) => c.trim())
    .filter(Boolean);
}

/* ---- fuzzy campaign matching -------------------------------------------------- */

const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "and", "or", "then", "please", "kindly",
  "that", "who", "whom", "any", "anyone", "anybody", "ones", "one", "some", "all", "our", "their",
  "its", "is", "are", "be", "been", "with", "from", "into", "onto", "role", "position", "req",
  "opening", "strong", "perfect", "best", "great", "good", "top", "new", "source", "sourcing",
  "find", "search", "look", "scout", "draft", "drafting", "outreach", "message", "email", "reach",
  "out", "compose", "write", "contact", "follow", "up", "followup", "nudge", "re-engage",
  "reengage", "check", "in", "again", "book", "schedule", "interview", "interviews", "invite",
  "set", "pool", "shortlist", "talent", "vivier", "save", "later", "stash", "report", "summary",
  "summarize", "summarise", "status", "update", "weekly",
]);

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** True when two tokens are "the same word" for matching purposes — exact, or
 *  one is a simple plural/suffix of the other (covers engineer/engineers). */
function tokensOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return a.startsWith(b) || b.startsWith(a);
  return false;
}

/** Fuzzy substring/token match against the campaign list — picks the campaign
 *  with the most overlapping significant tokens. Returns undefined when no
 *  campaign shares any token with the instruction (never guesses). */
function matchCampaign(text: string, campaigns: AriaCampaignCtx[]): AriaCampaignCtx | undefined {
  const needleTokens = significantTokens(text);
  if (needleTokens.length === 0 || campaigns.length === 0) return undefined;
  let best: { campaign: AriaCampaignCtx; score: number } | undefined;
  for (const c of campaigns) {
    const hay = [c.role, c.title, c.location].filter(Boolean).join(" ");
    const hayTokens = significantTokens(hay);
    if (hayTokens.length === 0) continue;
    let score = 0;
    for (const n of needleTokens) {
      if (hayTokens.some((h) => tokensOverlap(n, h))) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { campaign: c, score };
  }
  return best?.campaign;
}

/* ---- step labels -------------------------------------------------------------- */

function targetSuffix(matched?: AriaCampaignCtx): string {
  if (!matched) return "";
  const name = matched.title ?? matched.role;
  return name ? ` for “${name}”` : "";
}

function stepLabel(
  verb: AriaVerb,
  opts: { count?: number; role?: string; matched?: AriaCampaignCtx },
): string {
  const target = targetSuffix(opts.matched);
  switch (verb) {
    case "source": {
      const who = opts.role ?? "candidates";
      return `Source ${opts.count ?? DEFAULT_SOURCE_COUNT} ${who}${target}`;
    }
    case "draft":
      return `Draft outreach to the strongest matches${target}`;
    case "follow-up":
      return `Follow up with candidates who've gone quiet${target}`;
    case "book":
      return `Book interviews for perfect-fit candidates${target}`;
    case "pool":
      return `Add strong candidates to the talent pool${target}`;
    case "report":
      return `Generate a status report${target}`;
    default:
      return String(verb);
  }
}

/** Best-effort role phrase for the label only (e.g. "backend engineers" out of
 *  "source 15 backend engineers for the Berlin fintech role"). Purely
 *  cosmetic — matching a real campaign never depends on this succeeding. */
function extractRolePhrase(clause: string): string | undefined {
  const m = clause.match(/\b(?:\d+|[a-z-]+)\s+([a-z][a-z\s-]*?)\s+for\b/i);
  const phrase = m?.[1]?.trim().replace(/\s+/g, " ");
  return phrase && phrase.length > 1 ? phrase : undefined;
}

function buildStep(verb: AriaVerb, clause: string, wholeText: string, matched?: AriaCampaignCtx): AriaPlanStep {
  const count = verb === "source" ? extractCount(clause) ?? extractCount(wholeText) ?? DEFAULT_SOURCE_COUNT : extractCount(clause);
  // Prefer what the operator actually typed ("backend engineers") over the
  // matched campaign's own (noisier) role text — the campaign name already
  // shows up in the label's "for <campaign>" suffix, so falling back to it
  // here would just repeat itself.
  const role = extractRolePhrase(clause) ?? matched?.title ?? matched?.role;
  const city = matched?.location || undefined;
  const campaignId = matched?.id;
  const label = stepLabel(verb, { count, role: verb === "source" ? role : undefined, matched });
  return { verb, count, role, city, campaignId, label };
}

function buildSummary(steps: AriaPlanStep[], matched?: AriaCampaignCtx): string {
  if (steps.length === 0) return "No actionable command recognized.";
  const target = targetSuffix(matched);
  const verbs = steps.map((s) => s.verb).join(" → ");
  return `${steps.length}-step plan${target}: ${verbs}.`;
}

/* ---- entry point -------------------------------------------------------------- */

/**
 * Parses a single natural-language instruction into a previewable plan. Never
 * throws — any unexpected shape (missing ctx, non-string input, a regex
 * surprise) degrades to an empty, safe plan rather than propagating an error.
 */
export function parseCommand(text: string, ctx: { campaigns: AriaCampaignCtx[] }): AriaPlan {
  const raw = typeof text === "string" ? text : "";
  try {
    const trimmed = raw.trim();
    if (!trimmed) return { steps: [], summary: "No actionable command recognized.", raw };

    const campaigns = Array.isArray(ctx?.campaigns) ? ctx.campaigns : [];
    const matched = matchCampaign(trimmed, campaigns);

    const clauses = splitClauses(trimmed);
    const hits: { verb: AriaVerb; clause: string }[] = [];
    for (const clause of clauses) {
      for (const verb of VERB_ORDER) {
        if (VERB_PATTERNS[verb].test(clause)) {
          hits.push({ verb, clause });
          break;
        }
      }
    }

    if (hits.length === 0) {
      return { steps: [], summary: "No actionable command recognized.", raw };
    }

    const steps = hits
      .map((hit) => buildStep(hit.verb, hit.clause, trimmed, matched))
      .sort((a, b) => VERB_ORDER.indexOf(a.verb) - VERB_ORDER.indexOf(b.verb));

    return {
      steps,
      matchedCampaignId: matched?.id,
      summary: buildSummary(steps, matched),
      raw,
    };
  } catch {
    return { steps: [], summary: "No actionable command recognized.", raw };
  }
}
