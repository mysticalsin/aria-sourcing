/**
 * Acceptance need: a capital-markets trading-platform role whose required
 * skill is Calypso. Calypso is the need, not a product name and not a person.
 */

import {
  runSourcingEngine,
  type CandidateEvidence,
  type EngineRunInput,
  type EngineRunResult,
} from "@/lib/sourcing/engine";

export const TRADING_PLATFORM_JD = `Need — Calypso Business Analyst (capital markets trading platform)

We are hiring a Calypso Business Analyst for a trading-platform implementation
at a sell-side bank. This is a product platform (Calypso), not a person.

Required skills: Calypso, Trade Capture, SQL, Capital Markets, FO/BO
Nice to have: Murex, Summit, Risk
Minimum 5 years experience implementing Calypso front-office trade capture
and back-office settlement.

Location: Europe / hybrid.
`;

export const TRADING_PLATFORM_EMAIL = `This need is now ACTIVE: Sell-side bank — Calypso Business Analyst
Recruiter: Jordan Hale
Client: Sell-side capital markets
Skills: Calypso, Trade Capture, SQL, Capital Markets, FO/BO
Nice to have: Murex, Summit
Minimum 5 years
Location: London / Europe
`;

const BANKS = [
  "NatWest Markets",
  "BNP Paribas CIB",
  "SocGen CIB",
  "Crédit Agricole CIB",
  "Barclays CIB",
  "HSBC Markets",
  "Deutsche Bank",
  "UBS IB",
  "ING Markets",
  "Nordea Markets",
  "Danske Bank",
  "ABN Amro",
  "Commerzbank",
  "Intesa CIB",
  "Santander CIB",
  "Lloyds Markets",
  "Standard Chartered",
  "RBC Capital Markets",
  "CIBC Markets",
  "Scotiabank GBM",
  "NAB Markets",
  "ANZ Markets",
];

const NAMES = [
  "Elena Varga",
  "Marc Dupont",
  "Priya Raman",
  "Jonas Berg",
  "Amira Haddad",
  "Luca Ferraro",
  "Sofia Lindqvist",
  "Owen Clarke",
  "Mei Chen",
  "Hugo Moreau",
  "Nadia Petrov",
  "Ibrahim Kale",
  "Clara Weiss",
  "Theo Nielsen",
  "Hana Sato",
  "Ravi Mehta",
  "Ingrid Holm",
  "Diego Alvarez",
  "Leila Hassan",
  "Sven Bauer",
  "Camille Fontaine",
  "Arjun Patel",
];

function consultant(index: number, strength: "strong" | "solid"): CandidateEvidence {
  const name = NAMES[index] ?? `Consultant ${index + 1}`;
  const bank = BANKS[index] ?? "European CIB";
  const years = strength === "strong" ? 8 + (index % 5) : 5 + (index % 3);
  const extras = strength === "strong" ? "Murex adjacency, risk reports, collateral." : "SQL extracts and FO/BO workflows.";
  return {
    id: `fixture-calypso-${index + 1}`,
    name,
    skills: ["Calypso", "Trade Capture", "SQL", "Capital Markets", "FO/BO"],
    cvText:
      `${years} years as a Calypso Business Analyst at ${bank}. ` +
      `Led Calypso trading platform implementation: trade capture, FO/BO, settlement. ${extras}`,
    linkedinText:
      `Calypso Business Analyst · ${bank}. Capital markets trading platform, trade capture, SQL.`,
    yearsExperience: years,
    provenance: "fixture",
  };
}

/** Name-only hit: the string Calypso appears as a given name, not as a platform. */
export const NAME_ONLY_CANDIDATE: CandidateEvidence = {
  id: "fixture-name-only",
  name: "Calypso Martinez",
  skills: ["Marketing", "Brand", "Content"],
  cvText: "Brand marketing lead. Campaigns, content calendars, social strategy. No trading systems.",
  linkedinText: "Marketing Manager at a consumer brand. Brand and content, not capital markets.",
  yearsExperience: 9,
  provenance: "fixture",
};

export const EMPTY_CANDIDATE: CandidateEvidence = {
  id: "fixture-empty",
  name: "Jordan Miles",
  skills: [],
  cvText: "",
  linkedinText: "",
  yearsExperience: null,
  provenance: "fixture",
};

/** Adjacent platform, no Calypso on CV/LinkedIn — must not sneak in on a name. */
export const MUREX_ONLY_CANDIDATE: CandidateEvidence = {
  id: "fixture-murex-only",
  name: "Alex Moreau",
  skills: ["Murex", "Pricing"],
  cvText: "Murex MX.3 support. Pricing and market data. No Calypso implementation.",
  linkedinText: "Murex consultant. Front-office pricing.",
  yearsExperience: 7,
  provenance: "fixture",
};

export const TRADING_PLATFORM_POOL: CandidateEvidence[] = [
  ...Array.from({ length: 22 }, (_, index) => consultant(index, index < 12 ? "strong" : "solid")),
  NAME_ONLY_CANDIDATE,
  EMPTY_CANDIDATE,
  MUREX_ONLY_CANDIDATE,
];

export function runFixtureSourcing(
  input: Omit<EngineRunInput, "mode" | "pool"> & { pool?: CandidateEvidence[] },
): EngineRunResult {
  return runSourcingEngine({
    ...input,
    mode: "fixture",
    pool: input.pool ?? TRADING_PLATFORM_POOL,
  });
}
