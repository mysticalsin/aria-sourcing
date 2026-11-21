import type { LeadSource, SourcePlatform } from "@/lib/types";

/** Closed source list the Odoo adapter will accept. Anything else stays blocked. */
export const ODOO_SYNC_SOURCES = [
  "LinkedIn Recruiter CSV",
  "RSC/ATS",
  "Candidate-supplied",
  "Job application",
] as const;

export type OdooSyncSource = (typeof ODOO_SYNC_SOURCES)[number];

export type OdooIntake = "recruiter-csv" | "rsc" | "job-application" | "candidate-supplied";

export interface OdooSyncInput {
  id: string;
  campaignId: string;
  email: string;
  name: string;
  leadSource?: LeadSource | null;
  sourcePlatform?: SourcePlatform | null;
  /** Closed intake label. When set, it selects the Odoo source directly. */
  intake?: OdooIntake | null;
}

export interface OdooSyncRecord {
  idempotencyKey: string;
  candidateId: string;
  campaignId: string;
  name: string;
  email: string;
  source: OdooSyncSource | null;
  status: "ready" | "blocked";
  reason: string | null;
}

export interface OdooSyncView {
  records: OdooSyncRecord[];
  ready: number;
  blocked: number;
}

function sanctionedSource(input: OdooSyncInput): OdooSyncSource | null {
  if (input.intake === "recruiter-csv") return "LinkedIn Recruiter CSV";
  if (input.intake === "rsc") return "RSC/ATS";
  if (input.intake === "job-application") return "Job application";
  if (input.intake === "candidate-supplied") return "Candidate-supplied";
  if (input.leadSource === "Applicant") return "Job application";
  if (input.leadSource === "Referral") return "Candidate-supplied";
  if (input.leadSource === "Outbound" && input.sourcePlatform === "Manual") return "Candidate-supplied";
  return null;
}

/**
 * Local preview of the people a workspace would hand to Odoo.
 * Reads the current records only. It does not write, send, or open a network call.
 */
export function projectOdooSync(candidates: readonly OdooSyncInput[]): OdooSyncView {
  const records = candidates.map((candidate): OdooSyncRecord => {
    const email = candidate.email.trim();
    const source = sanctionedSource(candidate);
    if (!email) {
      return {
        idempotencyKey: `applicant_${candidate.id}`,
        candidateId: candidate.id,
        campaignId: candidate.campaignId,
        name: candidate.name,
        email,
        source: null,
        status: "blocked",
        reason: "missing recipient",
      };
    }
    if (!source) {
      return {
        idempotencyKey: `applicant_${candidate.id}`,
        candidateId: candidate.id,
        campaignId: candidate.campaignId,
        name: candidate.name,
        email,
        source: null,
        status: "blocked",
        reason: "unsanctioned source",
      };
    }
    return {
      idempotencyKey: `applicant_${candidate.id}`,
      candidateId: candidate.id,
      campaignId: candidate.campaignId,
      name: candidate.name,
      email,
      source,
      status: "ready",
      reason: null,
    };
  });
  return {
    records,
    ready: records.filter((record) => record.status === "ready").length,
    blocked: records.filter((record) => record.status === "blocked").length,
  };
}
