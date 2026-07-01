import type { Candidate } from "./types";

/* ============================================================================
   Candidate confidentiality / data minimization.
   Candidate PII is purpose-limited to outreach. When confidentiality mode is on,
   contact identifiers are masked everywhere except an active outreach context,
   and any reveal is written to the audit trail by the caller.
   ========================================================================== */

export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "•••";
  const [local, domain] = email.split("@");
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  const d = domain.replace(tld, "");
  return `${local[0] ?? "•"}•••@${d[0] ?? "•"}•••${tld}`;
}

export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•••";
  if (parts.length === 1) return `${parts[0][0]}•••`;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function maskUrl(url: string, label: string): string {
  if (!url) return "";
  return `${label}/in/•••`;
}

export function maskPhone(): string {
  return "•••";
}

/**
 * Redact PII inside a free-text email/reply body for display when confidentiality
 * mode is on and the operator has not revealed it. Best-effort: email addresses,
 * links, and phone-like number runs become tokens. Over-redaction is acceptable
 * here (privacy-first) — the operator can reveal, which is audited.
 */
export function maskEmailBody(text: string): string {
  if (!text) return text;
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/https?:\/\/[^\s)]+/g, "[link]")
    .replace(/\+?\d[\d().\-\s]{6,}\d/g, "[phone]");
}

/**
 * Return a candidate with PII masked unless revealed. `reveal` should be true
 * only inside an active outreach/approval context (purpose limitation) or after
 * an explicit, audited operator reveal.
 */
export function applyConfidentiality(
  candidate: Candidate,
  opts: { confidentialityMode: boolean; reveal: boolean },
): Candidate {
  if (!opts.confidentialityMode || opts.reveal) return candidate;
  return {
    ...candidate,
    name: maskName(candidate.name),
    email: maskEmail(candidate.email),
    linkedinUrl: candidate.linkedinUrl ? "•••" : "",
    githubUrl: candidate.githubUrl ? "•••" : "",
    sourceUrl: candidate.sourceUrl ? "•••" : undefined,
    avatarInitials: candidate.avatarInitials ? candidate.avatarInitials[0] + "•" : "•",
  };
}

/** Whether a candidate currently has a legitimate outreach purpose to show PII. */
export function hasOutreachPurpose(stage: Candidate["stage"]): boolean {
  // Contacted onward implies an outreach relationship already exists.
  return ["Contacted", "Replied", "Interested", "Booked", "Interviewed", "Offer", "Hired"].includes(
    stage,
  );
}
