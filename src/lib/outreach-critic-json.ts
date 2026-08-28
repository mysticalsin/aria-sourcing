/**
 * Parse a live quality-critic LLM reply into { pass, score, reasons }.
 * Tolerates markdown fences, trailing commas, and stringly-typed fields —
 * models often wrap JSON despite "JSON only" instructions.
 */

export type CriticJsonRow = { pass?: boolean; score?: number; reasons?: string[] };

function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

function relaxJson(raw: string): string {
  // Trailing commas before } or ]
  return raw.replace(/,\s*([}\]])/g, "$1");
}

function coercePass(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "pass" || v === "yes" || v === "ok") return true;
    if (v === "false" || v === "fail" || v === "no") return false;
  }
  if (typeof value === "number") return value >= 60;
  return undefined;
}

function coerceScore(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseCriticJson(text: string): CriticJsonRow | null {
  const stripped = stripFences(text);
  const jsonMatch = /\{[\s\S]*\}/.exec(stripped);
  if (!jsonMatch) return null;
  const candidates = [jsonMatch[0], relaxJson(jsonMatch[0])];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const pass = coercePass(parsed.pass);
      const score = coerceScore(parsed.score);
      const reasonsRaw = parsed.reasons;
      const reasons = Array.isArray(reasonsRaw)
        ? reasonsRaw.map(String).filter(Boolean).slice(0, 8)
        : typeof reasonsRaw === "string" && reasonsRaw.trim()
          ? [reasonsRaw.trim()]
          : undefined;
      return {
        ...(pass !== undefined ? { pass } : {}),
        ...(score !== undefined ? { score } : {}),
        ...(reasons ? { reasons } : {}),
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}
