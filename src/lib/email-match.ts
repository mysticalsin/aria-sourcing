import type { Candidate } from "./types";

/** Match an inbound sender address to a candidate by email (case-insensitive),
 *  optionally scoped to a campaign. Returns the first match, or undefined. */
export function matchCandidateByEmail(
  candidates: Candidate[],
  fromAddress: string,
  campaignId?: string,
): Candidate | undefined {
  const addr = fromAddress.trim().toLowerCase();
  if (!addr) return undefined;
  return candidates.find(
    (c) =>
      c.email.trim().toLowerCase() === addr &&
      (!campaignId || c.campaignId === campaignId),
  );
}
