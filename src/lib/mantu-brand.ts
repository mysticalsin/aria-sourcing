/**
 * Mantu Group brand voice and visual tokens for candidate-facing outreach.
 * Derived from mantu-pptx skill (Brand Guidelines V1/2025).
 *
 * Outreach copy should read as one thoughtful human recruiter representing
 * Mantu — never generic AI slop or marketing blast language.
 */

/** Primary Mantu palette (digital). */
export const MANTU_COLORS = {
  purple: "#6600AE",
  purpleBright: "#7F00DA",
  ink: "#17121A",
  white: "#FFFFFF",
  lightGray: "#F8F8F8",
  lilac: "#B764FF",
  lilacLight: "#D791FF",
  yellow: "#F8F060",
  deepGray: "#3D3C3E",
  gray: "#D6D6D6",
} as const;

/** HTML email wrapper for Mantu-branded outreach (inline styles for client compatibility). */
export function mantuEmailHtmlWrapper(bodyPlain: string): string {
  const paragraphs = bodyPlain
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:'Space Grotesk',Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${MANTU_COLORS.ink};">${escapeHtml(p.replace(/\n/g, "<br/>"))}</p>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px;background:${MANTU_COLORS.lightGray};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:${MANTU_COLORS.white};border-radius:12px;overflow:hidden;border:1px solid ${MANTU_COLORS.gray};">
    <tr>
      <td style="padding:20px 24px;background:linear-gradient(135deg,${MANTU_COLORS.purple} 0%,${MANTU_COLORS.purpleBright} 100%);">
        <span style="font-family:'Space Grotesk',Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MANTU_COLORS.lilacLight};">Mantu Group</span>
      </td>
    </tr>
    <tr><td style="padding:28px 24px 8px;">${paragraphs}</td></tr>
    <tr>
      <td style="padding:8px 24px 24px;border-top:1px solid ${MANTU_COLORS.gray};">
        <p style="margin:16px 0 0;font-family:'Space Grotesk',Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:${MANTU_COLORS.deepGray};">
          Mantu Group · Talent & consulting
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Default recruiter persona injected into LLM outreach prompts. */
export const MANTU_RECRUITER_PERSONA = [
  "You write as a senior Mantu Group talent partner — warm, direct, and genuinely curious about the candidate.",
  "Lead with something specific you noticed in their work (one concrete detail, not flattery).",
  "Explain Mantu briefly: a global consulting group that helps clients transform through technology and talent.",
  "Describe the role in one clear sentence — responsibilities, location model, and why it might fit them.",
  "Invite a low-pressure first conversation to explore mutual fit; never pressure or oversell.",
  "Never mention AI, automation, or that this message was generated.",
  "Never state or imply internal salary bands; if compensation comes up, say a recruiter can discuss ranges.",
  "Keep first-touch email under 120 words; LinkedIn under 80 words.",
  "Use sentence case. No exclamation marks unless the candidate used them first.",
].join(" ");

/** Signature block appended when no custom voice signature is set.
 *  Prefer a single-person sign-off — critics flag "Talent Team" as blast/templated. */
export const MANTU_DEFAULT_SIGNATURE = "Best regards,\nAria · Mantu Group";

/** Pre-call recruiter screen (15–20 min dry-run via calendar-authority). */
export function mantuPreCallAgenda(roleTitle: string): string[] {
  return [
    "Brief Mantu Group introduction and how we partner with clients",
    `High-level ${roleTitle} context — team, location model, and timeline`,
    "Recruiter screen: background, motivations, and salary expectations (ranges only if asked)",
    "Confirm mutual interest before scheduling a longer first interview",
  ];
}

/** First-interview booking CTA copy (Teams / calendar, 30–60 min). */
export function mantuFirstInterviewAgenda(roleTitle: string): string[] {
  return [
    "Introduce Mantu Group and our consulting model",
    `Walk through the ${roleTitle} role — scope, team, and expectations`,
    "Understand the candidate's background, motivations, and timing",
    "Answer questions and agree next steps if there is mutual interest",
  ];
}

/** Voice object compatible with generateOutreach(..., voice). */
export function mantuOutreachVoice(signature?: string): { persona: string; signature: string } {
  return {
    persona: MANTU_RECRUITER_PERSONA,
    signature: signature?.trim() || MANTU_DEFAULT_SIGNATURE,
  };
}
