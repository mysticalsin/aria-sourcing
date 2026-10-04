/**
 * Sealed outreach copy — the exact subject/body a recruiter approved.
 * Downstream LinkedIn / email / WhatsApp delivery MUST type or post this
 * verbatim. Humanizer and invite-fit run only at draft/approve time, never
 * again on the bot send path (that would diverge from the approval hash and
 * from what the recruiter signed off).
 */

import { humanizeText } from "@/lib/humanizer";
import { gateOutbound } from "@/lib/gate";
import {
  fitLinkedInInviteNote,
  LINKEDIN_INVITE_NOTE_MAX,
} from "@/lib/linkedin-invite-note";

export type SealOutreachCopyInput = {
  subject: string;
  body: string;
  channel: "Email" | "LinkedIn" | "WhatsApp" | "SMS";
};

export type SealOutreachCopyResult =
  | { ok: true; subject: string; body: string }
  | {
      ok: false;
      error: string;
      detail: string;
      reasons?: string[];
      max?: number;
      length?: number;
    };

/**
 * Soft-clean + gate + LinkedIn ≤200 fit. Returns the exact sealed copy that
 * must be persisted on the message and hashed for approval.
 */
export function sealOutreachCopy(input: SealOutreachCopyInput): SealOutreachCopyResult {
  let subject = humanizeText(input.subject ?? "");
  let body = humanizeText(input.body ?? "");

  const gate = gateOutbound(body);
  if (!gate.pass) {
    return {
      ok: false,
      error: "outreach-failed-humanizer-gate",
      detail: `Message blocked by humanizer gate: ${gate.reasons.join(", ")}. Rewrite so it reads like a human recruiter.`,
      reasons: gate.reasons,
    };
  }
  body = gate.text;

  if (input.channel === "LinkedIn") {
    const fitted = fitLinkedInInviteNote(body);
    if (fitted.truncated && body.trim().length > LINKEDIN_INVITE_NOTE_MAX + 40) {
      return {
        ok: false,
        error: "linkedin-invite-note-too-long",
        detail: `LinkedIn Connect notes must be ≤ ${LINKEDIN_INVITE_NOTE_MAX} characters (got ${body.trim().length}). Shorten before approve — long notes grey out Send and never land.`,
        max: LINKEDIN_INVITE_NOTE_MAX,
        length: body.trim().length,
      };
    }
    body = fitted.text;
    if (subject.trim().length > 80) subject = subject.slice(0, 80).trim();
  }

  if (!body.trim()) {
    return {
      ok: false,
      error: "outreach-empty-body",
      detail: "Message body is empty after sealing.",
    };
  }

  return { ok: true, subject, body };
}

/** Assert delivery payload matches sealed approval copy (byte-for-byte trim). */
export function deliveryMatchesSealed(opts: {
  sealedSubject: string;
  sealedBody: string;
  deliverySubject: string;
  deliveryBody: string;
}): boolean {
  return (
    opts.sealedSubject.trim() === opts.deliverySubject.trim() &&
    opts.sealedBody.trim() === opts.deliveryBody.trim()
  );
}
