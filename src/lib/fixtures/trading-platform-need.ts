/**
 * Acceptance fixtures for the AMACAN / BNPP CIB Calypso needs.
 * Calypso is the client JD, not a product name and not a person.
 *
 * Keep in sync with:
 *   tests/fixtures/tony-calypso-amacan-need.txt
 *   tests/fixtures/sample-vss-calypso-ba-montreal.txt
 */

import {
  runSourcingEngine,
  type CandidateEvidence,
  type EngineRunInput,
  type EngineRunResult,
} from "@/lib/sourcing/engine";

/** Colon-form VSS — Senior Calypso BA (second need). Restored from SAMPLE_VSS_CALYPSO_BA_MONTREAL. */
export const SAMPLE_VSS_CALYPSO_BA_MONTREAL = `Summary
Title: Senior Calypso Business Analyst
Type: Consulting
Category: Active
Priority: 1 - Urgent and critical
Reason: Opening Position
Status: Running

Recruitment Need Purpose
Main Manager: AMACAN Lead
Secondary Managers:
Main Recruiter: ROUSSEAU Emma
Secondary Recruiters:
Company Employed by: Mantu
City: Montreal
Client: BNPP CIB Canada
Company Billing To: AMACAN

Project Information
Contract Type: Consulting
Freelancer: No
Start Date: 01/09/2026
Number of people: 1
Remote: Hybrid
Client Sector: Banking / CIB
Project Type: Business Analysis
Project Duration: 12 months

Candidate Requirement
Profiles: Senior Calypso Business Analyst
Skill (Must): Calypso Business Analysis, MySQL
Skill (Nice to have): Settlements, Trade lifecycle, Prime Brokerage, SQL
Language (Must): English - Fluent
Language (Nice to have): French - Intermediate
Level of Experience: Senior (7-10 years)

Mission Description / Profile Synthesis:
Senior Calypso Business Analyst for AMACAN / BNPP CIB Canada (Montreal).
Must: Calypso Business Analysis and MySQL. Domain: CIB/MOA, Settlements,
Trade lifecycle, Calypso BO, SQL, T+1, Prime Brokerage/FI/Equities bridge,
offshore coordination Mumbai, European business units. Partially remote OK.
Prefer Open to Work candidates when scores are close.

Candidate Search Support
Target School:
Ideal profile Id: CAL-BA-AMACAN-2026
LinkedIn Profile:
Boolean: ("Calypso") AND ("Business Analyst" OR "BA") AND (MySQL OR SQL) AND (Montreal OR Canada)
`;

/** Connected-email shape wrapping the Application Support need. */
export const AMACAN_APP_SUPPORT_EMAIL = `From: MUNERA ALZATE Jacobo <jacobo.munera@amaris.com>
Subject: Need is now ACTIVE — Calypso Application Support (AMACAN / Montreal)

Please source against the attached VSS. Recruiter: MUNERA ALZATE Jacobo
Client: BNPP CIB - Canada
`;

const APP_SUPPORT_SKILLS = [
  "Linux",
  "Python",
  "Shell",
  "Oracle",
  "Grafana",
  "Dynatrace",
  "Linux Server",
  "Calypso",
];

const BA_SKILLS = ["Calypso", "Business Analysis", "MySQL", "SQL"];

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

function appSupportConsultant(index: number, strength: "strong" | "solid"): CandidateEvidence {
  const name = NAMES[index] ?? `Consultant ${index + 1}`;
  const years = strength === "strong" ? 5 + (index % 2) : 4;
  const skills =
    strength === "strong"
      ? APP_SUPPORT_SKILLS
      : ["Linux", "Python", "Shell", "Oracle", "Calypso"];
  const monitors =
    strength === "strong"
      ? "Grafana and Dynatrace on Linux Server. Python and Shell automation. Oracle."
      : "Oracle and Shell on Linux. Learning Grafana.";
  return {
    id: `fixture-app-support-${index + 1}`,
    name,
    skills,
    cvText:
      `${years} years production support for the Calypso settlement system in Capital Markets. ` +
      `Trade Life Cycle, Settlements, Securities, Prime Brokerage. 24/7 global. ${monitors}`,
    linkedinText:
      `IS&D Applicative Support · Calypso settlement · Capital Markets · Montreal. ${monitors}`,
    yearsExperience: years,
    provenance: "fixture",
  };
}

function baConsultant(index: number): CandidateEvidence {
  const name = NAMES[16 + (index % 6)] ?? `BA ${index + 1}`;
  const years = 7 + (index % 4);
  return {
    id: `fixture-calypso-ba-${index + 1}`,
    name,
    skills: BA_SKILLS,
    cvText:
      `${years} years as a Senior Calypso Business Analyst. BA/MOA, T+1, Prime Brokerage/FI/Equities, ` +
      `SQL, MySQL, Calypso back office, Settlements, Trade lifecycle.`,
    linkedinText:
      `Senior Calypso BA · AMACAN / CIB. Business Analysis, MySQL, T+1, Prime Brokerage.`,
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
  ...Array.from({ length: 12 }, (_, index) => appSupportConsultant(index, "strong")),
  ...Array.from({ length: 4 }, (_, index) => appSupportConsultant(12 + index, "solid")),
  ...Array.from({ length: 6 }, (_, index) => baConsultant(index)),
  NAME_ONLY_CANDIDATE,
  EMPTY_CANDIDATE,
  MUREX_ONLY_CANDIDATE,
];

/** @deprecated Use the AMACAN VSS fixtures. Kept as a colon-form parse smoke. */
export const TRADING_PLATFORM_JD = SAMPLE_VSS_CALYPSO_BA_MONTREAL;
export const TRADING_PLATFORM_EMAIL = AMACAN_APP_SUPPORT_EMAIL;

export function runFixtureSourcing(
  input: Omit<EngineRunInput, "mode" | "pool"> & { pool?: CandidateEvidence[] },
): EngineRunResult {
  return runSourcingEngine({
    ...input,
    mode: "fixture",
    pool: input.pool ?? TRADING_PLATFORM_POOL,
  });
}
