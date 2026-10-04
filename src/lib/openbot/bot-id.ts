/**
 * OpenBot bot-id rules (CopilotKit/openbot supervisor + agent-computer).
 * Letters, digits, hyphen, underscore; must start alphanumeric; max 64.
 */

const MAX_BOT_ID = 64;
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isOpenBotBotId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_BOT_ID && ALLOWED.test(value);
}

/**
 * Map an Aria computer/seat id onto a legal OpenBot bot id.
 * Prefer the raw id when already valid; otherwise a stable sanitized form.
 */
export function toOpenBotBotId(raw: string): string {
  const trimmed = raw.trim();
  if (isOpenBotBotId(trimmed)) return trimmed;
  const cleaned = trimmed
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const base = cleaned.length > 0 && /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `c_${cleaned || "bot"}`;
  return base.slice(0, MAX_BOT_ID);
}
