import { createHash } from "node:crypto";

/**
 * Durable candidate identity fingerprints for the agent wiki / second brain.
 * Display names are never sufficient to treat two records as the same person.
 */

export type IdentityStrength =
  | "linkedin"
  | "email"
  | "github"
  | "external"
  | "source_url"
  | "none";

export type CandidateIdentityInput = {
  name?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  externalIds?: Record<string, string> | null;
  currentCompany?: string | null;
};

export type CandidateIdentityFingerprint = {
  fingerprint: string;
  strength: IdentityStrength;
  /** Non-PII operator hint (truncated hash), safe for logs/UI. */
  displayHint: string;
  /** True when name was present but ignored as a merge key. */
  nameIgnored: boolean;
};

function normalizeUrl(raw: string): string {
  return raw.trim().toLowerCase().replace(/\/+$/, "");
}

function linkedInInPath(url: string): string | null {
  const normalized = normalizeUrl(url);
  const match = /linkedin\.com\/in\/([^/?#]+)/i.exec(normalized);
  return match?.[1] ? `linkedin:in:${match[1].toLowerCase()}` : null;
}

function githubPath(url: string): string | null {
  const normalized = normalizeUrl(url);
  const match = /github\.com\/([^/?#]+)/i.exec(normalized);
  if (!match?.[1] || match[1] === "settings" || match[1] === "orgs") return null;
  return `github:${match[1].toLowerCase()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hint(strength: IdentityStrength, hash: string): string {
  return `${strength}:${hash.slice(0, 8)}`;
}

/**
 * Build a durable identity fingerprint. Prefer LinkedIn → email → GitHub →
 * external ids → source URL. Never fingerprint on display name alone.
 */
export function fingerprintCandidateIdentity(
  input: CandidateIdentityInput,
): CandidateIdentityFingerprint {
  const nameIgnored = Boolean(input.name?.trim());

  const li = input.linkedinUrl?.trim() ? linkedInInPath(input.linkedinUrl) : null;
  if (li) {
    const fingerprint = sha256(li);
    return { fingerprint, strength: "linkedin", displayHint: hint("linkedin", fingerprint), nameIgnored };
  }

  const email = input.email?.trim().toLowerCase();
  if (email && email.includes("@")) {
    const fingerprint = sha256(`email:${email}`);
    return { fingerprint, strength: "email", displayHint: hint("email", fingerprint), nameIgnored };
  }

  const gh = input.githubUrl?.trim() ? githubPath(input.githubUrl) : null;
  if (gh) {
    const fingerprint = sha256(gh);
    return { fingerprint, strength: "github", displayHint: hint("github", fingerprint), nameIgnored };
  }

  const external = input.sourceExternalId?.trim()
    || (input.externalIds
      ? Object.entries(input.externalIds)
          .filter(([, v]) => typeof v === "string" && v.trim())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v.trim().toLowerCase()}`)
          .join("|")
      : "");
  if (external) {
    const fingerprint = sha256(`external:${external}`);
    return { fingerprint, strength: "external", displayHint: hint("external", fingerprint), nameIgnored };
  }

  const sourceUrl = input.sourceUrl?.trim() ? normalizeUrl(input.sourceUrl) : "";
  if (sourceUrl) {
    const fingerprint = sha256(`source_url:${sourceUrl}`);
    return {
      fingerprint,
      strength: "source_url",
      displayHint: hint("source_url", fingerprint),
      nameIgnored,
    };
  }

  // Insufficient durable identity — keep candidacies separate (samePerson=false).
  const fingerprint = sha256(
    `none:unlinked:${(input.name ?? "").trim().toLowerCase()}|${(input.currentCompany ?? "").trim().toLowerCase()}`,
  );
  return {
    fingerprint,
    strength: "none",
    displayHint: hint("none", fingerprint),
    nameIgnored,
  };
}

/** True when two inputs should be treated as the same person for wiki/merge. */
export function samePerson(
  a: CandidateIdentityInput,
  b: CandidateIdentityInput,
): boolean {
  const fa = fingerprintCandidateIdentity(a);
  const fb = fingerprintCandidateIdentity(b);
  if (fa.strength === "none" || fb.strength === "none") return false;
  return fa.fingerprint === fb.fingerprint && fa.strength === fb.strength;
}
