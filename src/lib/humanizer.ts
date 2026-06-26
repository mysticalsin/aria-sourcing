/* ============================================================================
   HUMANIZER — strips AI tells from every generated word. ALWAYS applied to
   outreach, reply drafts, and clarification emails. No AI slop, ever.
   Deterministic so output is stable and reviewable.
   ========================================================================== */

// Banned AI-isms → plain human phrasing. [pattern, replacement]
const REPLACEMENTS: [RegExp, string][] = [
  [/\bleverage\b/gi, "use"],
  [/\bleveraging\b/gi, "using"],
  [/\butilize\b/gi, "use"],
  [/\butilizing\b/gi, "using"],
  [/\bdelve into\b/gi, "dig into"],
  [/\bdelve\b/gi, "dig"],
  [/\brobust\b/gi, "solid"],
  [/\bseamless(ly)?\b/gi, "smooth"],
  [/\belevate\b/gi, "lift"],
  [/\bcutting[- ]edge\b/gi, "modern"],
  [/\bbest[- ]in[- ]class\b/gi, "strong"],
  [/\bstate[- ]of[- ]the[- ]art\b/gi, "modern"],
  [/\bsynerg(y|ies)\b/gi, "fit"],
  [/\bgame[- ]changer\b/gi, "big deal"],
  [/\bunlock\b/gi, "open up"],
  [/\bempower(s|ing)?\b/gi, "help"],
  [/\btailored\b/gi, "built for you"],
  [/\bpassionate about\b/gi, "into"],
  [/\bthrilled\b/gi, "glad"],
  [/\bexcited to\b/gi, "keen to"],
  [/\bfurthermore\b/gi, "also"],
  [/\bmoreover\b/gi, "and"],
  [/\badditionally\b/gi, "also"],
  [/\bin order to\b/gi, "to"],
  [/\bplethora\b/gi, "plenty"],
  [/\bmyriad\b/gi, "many"],
  [/\bnavigate\b/gi, "handle"],
  [/\bfoster(ing)?\b/gi, "build"],
  [/\bembark\b/gi, "start"],
  [/\brealm\b/gi, "space"],
  [/\bvibrant\b/gi, "lively"],
  [/\bnestled\b/gi, "set"],
  [/\bbustling\b/gi, "busy"],
  [/\bever[- ]evolving\b/gi, "changing"],
];

// Whole filler phrases to delete.
const DELETIONS: RegExp[] = [
  /\bI hope this (email|message|note) finds you well[.,]?\s*/gi,
  /\bin today'?s (fast[- ]paced |digital |modern )?world[.,]?\s*/gi,
  /\bI just wanted to\b\s*/gi,
  /\bneedless to say[,]?\s*/gi,
  /\bit goes without saying that\b\s*/gi,
  /\bat the end of the day[,]?\s*/gi,
];

export interface HumanizeResult {
  text: string;
  removed: string[];
}

export function humanize(input: string): HumanizeResult {
  if (!input) return { text: input, removed: [] };
  const removed: string[] = [];
  let out = input;

  // em / en dashes — a classic AI tell
  if (/[—–]/.test(out)) {
    out = out.replace(/\s*[—–]\s*/g, ", ");
    removed.push("em-dash");
  }

  for (const re of DELETIONS) {
    if (re.test(out)) {
      removed.push("filler phrase");
      out = out.replace(re, "");
    }
  }

  for (const [re, to] of REPLACEMENTS) {
    if (re.test(out)) {
      const tell = re.source.replace(/\\b|\(|\)|\?|\[|\]|gi|\|/g, "").split(" ")[0];
      removed.push(tell);
      out = out.replace(re, to);
    }
  }

  // collapse exclamation pile-ups + double spaces, tidy punctuation
  out = out
    .replace(/!{2,}/g, "!")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[,.]\s*/gm, "")
    .trim();

  // de-dupe the "removed" list
  return { text: out, removed: Array.from(new Set(removed)) };
}

/** Convenience: humanized text only. */
export function humanizeText(input: string): string {
  return humanize(input).text;
}
