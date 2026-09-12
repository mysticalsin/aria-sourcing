/**
 * LinkedIn free-tier connection invite notes hard-cap at 200 characters.
 * Drafts that ignore this grey out Send and produce zero recipient notification.
 * Shared by prompts, mock drafts, approve, and OpenBot Connect send.
 */
export const LINKEDIN_INVITE_NOTE_MAX = 200;

export type LinkedInInviteNoteFit = {
  text: string;
  length: number;
  /** True when the input already fit (no rewrite/truncation). */
  fitted: boolean;
  /** True when we had to cut; callers that must not mangle meaning should fail closed. */
  truncated: boolean;
};

/**
 * Soft-fit a note for Connect: prefer word boundary, never invent content.
 * Does not claim delivery — only shapes text for the 200-char LinkedIn gate.
 */
export function fitLinkedInInviteNote(raw: string, max = LINKEDIN_INVITE_NOTE_MAX): LinkedInInviteNoteFit {
  const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return { text: cleaned, length: cleaned.length, fitted: true, truncated: false };
  }
  const budget = max - 1; // room for …
  let slice = cleaned.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(budget * 0.6)) {
    slice = slice.slice(0, lastSpace);
  }
  const text = `${slice.trimEnd()}…`;
  return { text, length: text.length, fitted: false, truncated: true };
}

/** Prompt rules injected when drafting LinkedIn Connect / first-touch notes. */
export function linkedInInviteDraftRules(): string {
  return [
    `LinkedIn Connect invite note (mandatory):`,
    `- Keep the note ≤ ${LINKEDIN_INVITE_NOTE_MAX} characters including spaces (LinkedIn greys out Send above this).`,
    `- No subject line. No multi-paragraph email. One short, warm note.`,
    `- Lead with something specific about their recent work; one clear reason; soft ask.`,
    `- Empathic and human — never corporate fog, never AI tells (no em dashes, no "I hope this finds you well").`,
    `- Prefer Connect + note over Message when not 1st-degree; Message/InMail is a separate longer draft.`,
  ].join("\n");
}
