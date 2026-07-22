const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const TOKEN_SUFFIX_CHARACTER = /[+#&]/u;

export type TextEvidence = {
  matchedText: string;
  start: number;
  end: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBoundaryBefore(text: string, start: number): boolean {
  if (start === 0) return true;
  const character = text[start - 1] ?? "";
  return !WORD_CHARACTER.test(character) && !TOKEN_SUFFIX_CHARACTER.test(character) && character !== ".";
}

function hasBoundaryAfter(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const character = text[end] ?? "";
  if (WORD_CHARACTER.test(character) || TOKEN_SUFFIX_CHARACTER.test(character)) return false;
  if (character !== ".") return true;
  const afterPeriod = text[end + 1] ?? "";
  return !WORD_CHARACTER.test(afterPeriod);
}

export function findBoundedTextEvidence(text: string, term: string): TextEvidence | null {
  const candidate = term.trim();
  if (!candidate) return null;
  const expression = new RegExp(escapeRegExp(candidate), "giu");
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    if (start == null) continue;
    const end = start + match[0].length;
    if (hasBoundaryBefore(text, start) && hasBoundaryAfter(text, end)) {
      return { matchedText: match[0], start, end };
    }
  }
  return null;
}

function normalizeEvidenceText(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}_+#&.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function hasBoundedTextEvidence(text: string, term: string): boolean {
  if (findBoundedTextEvidence(text, term)) return true;
  const normalizedText = normalizeEvidenceText(text);
  const normalizedTerm = normalizeEvidenceText(term);
  return Boolean(normalizedTerm && findBoundedTextEvidence(normalizedText, normalizedTerm));
}
