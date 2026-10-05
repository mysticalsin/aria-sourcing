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

/** Must-haves on the App Support need. "Linux Server" also hits "Linux" (substring). */
const APP_SUPPORT_SKILLS = [
  "Calypso",
  "Linux",
  "Python",
  "Shell",
  "Oracle",
  "Grafana",
  "Dynatrace",
  "Linux Server",
];

const BA_SKILLS = ["Calypso", "Business Analysis", "MySQL", "SQL"];

/**
 * Distinct App Support coverage — not two clone buckets.
 * Skills / CV phrases / LinkedIn phrases differ so composites spread.
 * Every CV keeps "production support" + a Calypso citation.
 */
const APP_SUPPORT_PROFILES: Array<{
  name: string;
  skills: string[];
  cv: string[];
  li: string[];
  years: number;
}> = [
  {
    name: "Elena Varga",
    skills: APP_SUPPORT_SKILLS,
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    li: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    years: 6,
  },
  {
    name: "Marc Dupont",
    skills: APP_SUPPORT_SKILLS,
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
    ],
    li: ["Calypso", "Capital Markets", "Grafana", "Dynatrace", "Prime Brokerage"],
    years: 6,
  },
  {
    name: "Priya Raman",
    skills: APP_SUPPORT_SKILLS,
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Grafana",
    ],
    li: ["Calypso", "Capital Markets", "Grafana"],
    years: 5,
  },
  {
    name: "Jonas Berg",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    li: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
    ],
    years: 6,
  },
  {
    name: "Amira Haddad",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Grafana",
    ],
    li: ["Calypso", "Capital Markets", "Grafana", "Dynatrace"],
    years: 5,
  },
  {
    name: "Luca Ferraro",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"],
    cv: ["production support", "Calypso", "Trade Life Cycle", "Settlements", "Prime Brokerage", "Capital Markets"],
    li: ["Calypso", "production support", "Prime Brokerage", "Capital Markets", "Back Office"],
    years: 5,
  },
  {
    name: "Sofia Lindqvist",
    skills: APP_SUPPORT_SKILLS,
    cv: ["production support", "Calypso", "Trade Life Cycle", "Settlements", "Prime Brokerage", "Grafana"],
    li: ["Calypso", "Capital Markets", "Grafana", "Dynatrace"],
    years: 5,
  },
  {
    name: "Owen Clarke",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    li: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
    ],
    years: 6,
  },
  {
    name: "Mei Chen",
    skills: APP_SUPPORT_SKILLS,
    cv: ["production support", "Calypso", "Settlements", "Capital Markets", "Grafana"],
    li: ["Calypso", "Capital Markets"],
    years: 4,
  },
  {
    name: "Hugo Moreau",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"],
    cv: ["production support", "Calypso", "Trade Life Cycle", "Prime Brokerage", "Grafana"],
    li: ["Calypso", "Capital Markets", "Grafana"],
    years: 5,
  },
  {
    name: "Nadia Petrov",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Grafana",
    ],
    li: ["Calypso", "Capital Markets", "Grafana", "Dynatrace", "Prime Brokerage"],
    years: 5,
  },
  {
    name: "Ibrahim Kale",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    li: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Prime Brokerage",
      "Capital Markets",
      "Back Office",
      "Grafana",
      "Dynatrace",
    ],
    years: 6,
  },
  {
    name: "Clara Weiss",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana"],
    cv: ["production support", "Calypso", "Trade Life Cycle", "Settlements", "Prime Brokerage", "Capital Markets"],
    li: ["Calypso", "Capital Markets", "Grafana"],
    years: 4,
  },
  {
    name: "Theo Nielsen",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle"],
    cv: [
      "production support",
      "Calypso",
      "Trade Life Cycle",
      "Settlements",
      "Securities",
      "Prime Brokerage",
      "Capital Markets",
      "Grafana",
    ],
    li: ["Calypso", "production support", "Prime Brokerage", "Capital Markets", "Back Office", "Grafana"],
    years: 5,
  },
  {
    name: "Hana Sato",
    skills: APP_SUPPORT_SKILLS,
    cv: ["production support", "Calypso", "Settlements", "Grafana"],
    li: ["Calypso", "Grafana"],
    years: 4,
  },
  {
    name: "Ravi Mehta",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Dynatrace"],
    cv: ["production support", "Calypso", "Trade Life Cycle", "Settlements", "Capital Markets", "Dynatrace"],
    li: ["Calypso", "Capital Markets", "Dynatrace"],
    years: 5,
  },
  {
    name: "Ingrid Holm",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle"],
    cv: ["production support", "Calypso", "Trade Life Cycle", "Settlements", "Prime Brokerage", "Capital Markets", "Grafana"],
    li: ["Calypso", "Capital Markets", "Grafana"],
    years: 4,
  },
  {
    name: "Diego Alvarez",
    skills: ["Calypso", "Linux", "Python", "Shell", "Oracle", "Grafana"],
    cv: ["production support", "Calypso", "Settlements", "Prime Brokerage", "Grafana"],
    li: ["Calypso", "Grafana"],
    years: 4,
  },
];

function appSupportConsultant(
  index: number,
  profile: (typeof APP_SUPPORT_PROFILES)[number],
): CandidateEvidence {
  const cvBody = profile.cv.join("; ");
  const liBody = profile.li.join(" · ");
  return {
    id: `fixture-app-support-${index + 1}`,
    name: profile.name,
    skills: profile.skills,
    cvText: `${profile.years} years. Experience: ${cvBody}. 24/7 global desk.`,
    linkedinText: `IS&D Applicative Support · Montreal. ${liBody}.`,
    yearsExperience: profile.years,
    provenance: "fixture",
  };
}

const BA_NAMES = [
  "Leila Hassan",
  "Sven Bauer",
  "Camille Fontaine",
  "Arjun Patel",
  "Noor Rahman",
  "Pia Kowalski",
];

function baConsultant(index: number): CandidateEvidence {
  const name = BA_NAMES[index % BA_NAMES.length] ?? `BA ${index + 1}`;
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

const DESK_FIRST = ["Amina", "Boris", "Celia", "Dario", "Eva", "Farid", "Gita", "Hiro"];
const DESK_LAST = ["Chen", "Okoye", "Novak", "Silva", "Park", "Khan", "Berg", "Sato"];
const DESK_SKILL_TIERS: string[][] = [
  ["Calypso", "Linux"],
  ["Calypso", "Python"],
  ["Calypso", "Linux", "Python"],
  ["Linux", "Python", "Shell"],
  ["Calypso", "Oracle", "Grafana"],
  ["Calypso", "Linux", "Shell", "Oracle"],
];

/** Extra recall so the matcher considers ≥60 people. Coverage is stepped
 *  below the named App Support / BA desks so the top-20 score spread stays
 *  skill-ranked, not a clone bucket. */
function extraDeskConsultant(index: number): CandidateEvidence {
  const n = index + 1;
  const skills = DESK_SKILL_TIERS[index % DESK_SKILL_TIERS.length] ?? ["Calypso"];
  const years = 3 + (index % 5);
  const cvBits = ["production support", ...skills.slice(0, 1 + (index % 2))];
  const liBits = index % 3 === 0 ? skills.slice(0, 1) : skills.slice(0, 2);
  return {
    id: `fixture-desk-${n}`,
    name: `${DESK_FIRST[index % DESK_FIRST.length]} ${DESK_LAST[index % DESK_LAST.length]} ${n}`,
    skills,
    cvText: `${years} years. ${cvBits.join("; ")}.`,
    linkedinText: `Desk ${n}. ${liBits.join(" · ")}.`,
    yearsExperience: years,
    provenance: "fixture",
  };
}

export const TRADING_PLATFORM_POOL: CandidateEvidence[] = [
  ...APP_SUPPORT_PROFILES.map((profile, index) => appSupportConsultant(index, profile)),
  ...Array.from({ length: 6 }, (_, index) => baConsultant(index)),
  ...Array.from({ length: 40 }, (_, index) => extraDeskConsultant(index)),
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
