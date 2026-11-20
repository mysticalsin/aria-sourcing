/**
 * The approval panel shows this string and nothing else as the message.
 * The SHA-256 is of these exact bytes (UTF-8, LF). Editing the text
 * without updating the hash fails tests/design-system.mts.
 */

export const EXACT_OUTREACH_MESSAGE = [
  "Hello Jordan Example,",
  "",
  "This is a suggestion from Aria about the synthetic role Platform engineer at Northwind Example. The note was drafted from candidate-supplied information only. Purpose: to ask if a short conversation is welcome. Retention: the draft is kept with the synthetic campaign until you object or the demo is wiped. You can object at any time by replying stop to recruiter.example@example.test. Aria does not decide hiring.",
  "",
  "Recruiter Example",
  "recruiter.example@example.test",
].join("\n");

export const EXACT_OUTREACH_SHA256 =
  "152cbabadcc1eeaafb43414ee58662a8faa2fb9a33d20ace3cae500103807c4d";

export const SEND_MODES = ["human", "auto_qc"] as const;
export type SendMode = (typeof SEND_MODES)[number];

/** Tony, 20 Nov 2026: manual is the default. Full automatic is opt-in. */
export const DEFAULT_SEND_MODE: SendMode = "human";

export function sendModeLabel(mode: SendMode): string {
  return mode === "human" ? "Manual" : "Full automatic";
}

export function sendModeCopy(mode: SendMode): string {
  if (mode === "human") {
    return "Manual is the default. A person approves this exact text, and that approval is the ledger entry.";
  }
  return "Full automatic is opt-in. A quality-check pass on this same exact text would be the ledger entry. Live send stays off until Tony says otherwise.";
}
