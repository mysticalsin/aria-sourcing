import { z } from "zod";
import type { CandidateLawfulBasis, HermesState } from "./types";
import { candidateEnrichmentBlocker } from "./candidate-review";
import { candidateProfileIdentity } from "./rules";
import { computeCoverage } from "./enrichment/merge";
import { scoreCandidate } from "./scoring";
import { effectiveWeights } from "./skills";

export interface VerifiedEvidenceInput { email: string; linkedinUrl: string; source: string; skills?: string[]; yearsExperience?: number | null; lawfulBasis?: CandidateLawfulBasis }

export function recordVerifiedEvidence(state: HermesState, id: string, input: VerifiedEvidenceInput, at: string, noteId: string): { ok: true; state: HermesState } | { ok: false; error: string } {
  const candidate = state.candidates.find((c) => c.id === id);
  const campaign = state.campaigns.find((c) => c.id === candidate?.campaignId);
  if (!candidate || candidateEnrichmentBlocker(candidate, campaign)) return { ok: false, error: "An active, non-excluded candidate is required." };
  const email = input.email.trim();
  if (email && !z.email().safeParse(email).success) return { ok: false, error: "Enter a valid email address." };
  let linkedinUrl = input.linkedinUrl.trim();
  if (linkedinUrl) {
    try {
      const url = new URL(linkedinUrl);
      if (url.protocol !== "https:" || (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) || url.username || url.password || url.port || !/^\/in\/[A-Za-z0-9%_.-]+\/?$/.test(url.pathname)) throw new Error();
      linkedinUrl = `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
    } catch { return { ok: false, error: "Enter an HTTPS LinkedIn /in/ profile URL." }; }
  }
  const source = input.source.trim();
  if (input.lawfulBasis !== undefined && input.lawfulBasis !== "consent" && input.lawfulBasis !== "legitimate_interest") return { ok: false, error: "Select an explicit contact basis." };
  if (source.length < 8 || source.length > 500) return { ok: false, error: "Record where you verified these facts (8-500 characters)." };
  const skills = input.skills ? [...new Map(input.skills.map((s) => [s.trim().toLowerCase(), s.trim()])).values()].filter(Boolean) : candidate.techStack;
  const yearsExperience = input.yearsExperience === undefined ? candidate.yearsExperience : input.yearsExperience;
  if (skills.length > 100 || skills.some((s) => s.length > 100)) return { ok: false, error: "Use at most 100 observed skills, each at most 100 characters." };
  if (yearsExperience !== null && (!Number.isFinite(yearsExperience) || yearsExperience < 0 || yearsExperience > 80)) return { ok: false, error: "Verified experience must be 0-80 years, or left unknown." };
  if (!email && !linkedinUrl && !skills.length && yearsExperience === null && !input.lawfulBasis) return { ok: false, error: "Provide at least one verified profile or contact fact." };
  if (state.candidates.some((other) => other.id !== id && ((email && other.email.trim().toLowerCase() === email.toLowerCase()) || (linkedinUrl && candidateProfileIdentity(other.linkedinUrl) === candidateProfileIdentity(linkedinUrl))))) {
    return { ok: false, error: "These details match another candidate. Review the existing record before merging identities." };
  }
  let updated = { ...candidate, email, linkedinUrl, techStack: skills, yearsExperience,
    ...(input.lawfulBasis ? { lawfulBasis: input.lawfulBasis, lawfulBasisSource: "operator_selection" as const, lawfulBasisRecordedAt: at } : {}),
    notes: [{ id: noteId, text: `${input.lawfulBasis ? `Contact basis ${input.lawfulBasis}` : "Profile/contact facts"} recorded by operator. Evidence: ${source}`, at }, ...(candidate.notes ?? [])] };
  if (updated.enrichment) {
    const fieldProvenance = { ...updated.enrichment.fieldProvenance };
    if (email !== candidate.email) {
      delete fieldProvenance.email;
      if (email) fieldProvenance.email = { provider: "Manual", at };
    }
    if (input.skills) {
      delete fieldProvenance.skills;
      if (skills.length) fieldProvenance.skills = { provider: "Manual", at };
    }
    updated = { ...updated, enrichment: { ...updated.enrichment, fieldProvenance } };
    updated = { ...updated, enrichment: { ...updated.enrichment!, coverage: computeCoverage(updated) } };
  }
  const score = scoreCandidate(updated, campaign!.jobAnalysis, effectiveWeights(campaign!.scoringWeights, state.skills));
  updated = { ...updated, matchScore: score.score, matchBreakdown: score.breakdown };
  // Facts never imply consent; only the separate explicit basis input records it.
  // Neither operation changes the stage, approves a message or sends anything.
  return { ok: true, state: { ...state, candidates: state.candidates.map((c) => c.id === id ? updated : c) } };
}
