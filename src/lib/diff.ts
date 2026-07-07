/* ============================================================================
   Tiny word-level diff — no dependencies. Used to render a red/green
   before/after comparison of a skill playbook's learned language (Workstream
   4.5 "Watch It Learn"). Pure function, safe to call on every render.
   ========================================================================== */

export type DiffTokenType = "same" | "add" | "del";

export interface DiffToken {
  text: string;
  type: DiffTokenType;
}

/** Splits on whitespace runs, keeping the whitespace itself as its own token
 *  so exact spacing survives re-joining the tokens for display. */
function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

// Above this many (before-tokens × after-tokens) cells, the O(n*m) LCS table
// gets expensive — fall back to a coarse whole-string replacement so a
// pathologically large diff can never hang the tab. Ordinary playbook
// before/after strings are a sentence or two and never come close.
const MAX_LCS_CELLS = 200_000;

/**
 * Word-level LCS diff between `before` and `after`, returned as a flat,
 * ordered list of tokens tagged same/add/del. Adjacent tokens of the same
 * type are merged so callers get one span per run of text, not one per word.
 */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length * b.length > MAX_LCS_CELLS) {
    const fallback: DiffToken[] = [];
    if (before) fallback.push({ text: before, type: "del" });
    if (after) fallback.push({ text: after, type: "add" });
    return fallback;
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of the LCS of a[i..] and b[j..]
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ text: a[i], type: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ text: a[i], type: "del" });
      i++;
    } else {
      raw.push({ text: b[j], type: "add" });
      j++;
    }
  }
  while (i < n) raw.push({ text: a[i++], type: "del" });
  while (j < m) raw.push({ text: b[j++], type: "add" });

  const merged: DiffToken[] = [];
  for (const t of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === t.type) {
      last.text += t.text;
    } else {
      merged.push({ ...t });
    }
  }
  return merged;
}
