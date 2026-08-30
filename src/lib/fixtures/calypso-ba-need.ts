/**
 * Canonical Senior Calypso BA need — AMACAN / BNPP CIB Canada / Montreal.
 * Used by intake fixtures, scoring quality tests, and live campaign seeding.
 */

/** Structured JobAnalysis-ready fields for this need. */
export const CALYPSO_BA_MUST_SKILLS = [
  "Calypso",
  "Business Analysis",
  "MySQL",
] as const;

export const CALYPSO_BA_NICE_SKILLS = [
  "Settlements",
  "MOA",
  "SQL",
  "T+1",
  "Clearing",
  "CCP",
  "Trade Lifecycle",
  "Capital Markets",
  "Prime Brokerage",
  "Equities",
  "UAT",
  "NRT",
  "L3 Support",
] as const;

export const CALYPSO_BA_SCREEN_HARD = [
  "Calypso BO/FO/reporting",
  "BA lifecycle (specs, UAT, NRT)",
  "CIB / capital markets / PB / FI / Equities / trade lifecycle",
  "Settlements / clearing / CCP",
  "SQL/MySQL reconciliation",
  "L3 support",
  "T+1 / projects",
  "EU + Mumbai offshore coordination",
] as const;

export const CALYPSO_BA_BOOLEAN =
  '("Calypso") AND ("Business Analyst" OR BA) AND (MySQL OR SQL OR Settlements)';

/** VSS-style need text — paste into Intake. */
export const SAMPLE_CALYPSO_BA_NEED = `Summary
Type: Consulting
Category: Active
Priority: 1 - Urgent and critical
Reason: Opening Position
Status: Running

Recruitment Need Purpose
Main Manager: MARGIOTTA Lisa
Secondary Managers: SOUSA ALVES Sara
Main Recruiter: MUNERA ALZATE Jacobo
Company Employed by: AMACAN
City: Montreal
Client: BNPP CIB - Canada
Company Billing To: AMACAN

Project Information
Contract Type: CDI/CTI
Freelancer: No
Start Date: 05/10/2026
Number of people: 1
Remote: Possible partially remote
Client Sector: Bank & Finance
Project Type: Expertise
Project Duration: 12 Month

Candidate Requirement
Profiles: IS&D - Business Analyst
Title: Senior Calypso Business Analyst
Skill (Must): Calypso, Business Analysis, MySQL
Skill (Nice to have): Settlements, MOA, SQL, T+1, Clearing, CCP, Trade Lifecycle, Capital Markets, Prime Brokerage, Equities, UAT, NRT, L3 Support
Language (Must): English - Fluent
Level of Experience: Senior - From 7 to 10 years

Profile Synthesis:
Senior Calypso Business Analyst for BNPP CIB Canada via AMACAN (Montreal, partial remote).
Own BA work on Calypso BO/FO/reporting and settlements, MOA coordination, SQL/MySQL
reconciliation, CIB / capital markets / PB / FI / Equities / trade lifecycle stakeholder
alignment, clearing/CCP, L3 support, T+1 projects, and EU + Mumbai offshore coordination
including UAT/NRT BA lifecycle (specs → UAT → NRT). Must demonstrate deep Calypso product
BA delivery in banking. Prefer Open to Work. Shortlist quality over quantity (best 5–20).

Candidate Search Support
Ideal profile Id: CAL-BA-AMACAN-BNPP-2026
Boolean: ("Calypso") AND ("Business Analyst" OR BA) AND (MySQL OR SQL OR Settlements)
`;

/** JSON brief — usable for API / campaign intake fixtures. */
export const CALYPSO_BA_NEED_JSON = {
  id: "CAL-BA-AMACAN-BNPP-2026",
  title: "Senior Calypso Business Analyst",
  client: "BNPP CIB - Canada",
  employer: "AMACAN",
  city: "Montreal",
  remote: "Possible partially remote",
  startDate: "2026-10-05",
  seniority: "Senior",
  minYearsExperience: 7,
  maxYearsExperience: 10,
  requiredSkills: [...CALYPSO_BA_MUST_SKILLS],
  niceToHaveSkills: [...CALYPSO_BA_NICE_SKILLS],
  requiredLanguages: ["English"],
  screenHard: [...CALYPSO_BA_SCREEN_HARD],
  searchBoolean: CALYPSO_BA_BOOLEAN,
  industryExperience: ["Bank & Finance", "Capital Markets", "CIB"],
  preferOpenToWork: true,
  shortlistMax: 20,
  shortlistMin: 5,
  qualityFloor: 80,
} as const;

/** Normalized consulting_recruitment envelope (Calypso / AMACAN shape). */
export const CALYPSO_BA_CONSULTING_RECRUITMENT_JSON = {
  consulting_recruitment: {
    id: CALYPSO_BA_NEED_JSON.id,
    title: CALYPSO_BA_NEED_JSON.title,
    client: CALYPSO_BA_NEED_JSON.client,
    employer: CALYPSO_BA_NEED_JSON.employer,
    city: CALYPSO_BA_NEED_JSON.city,
    remote: CALYPSO_BA_NEED_JSON.remote,
    startDate: CALYPSO_BA_NEED_JSON.startDate,
    seniority: CALYPSO_BA_NEED_JSON.seniority,
    minYearsExperience: CALYPSO_BA_NEED_JSON.minYearsExperience,
    maxYearsExperience: CALYPSO_BA_NEED_JSON.maxYearsExperience,
    mandatory_requirements: [...CALYPSO_BA_MUST_SKILLS],
    requiredSkills: [...CALYPSO_BA_MUST_SKILLS],
    niceToHaveSkills: [...CALYPSO_BA_NICE_SKILLS],
    requiredLanguages: ["English"],
    screening_criteria: [...CALYPSO_BA_SCREEN_HARD],
    boolean_search: CALYPSO_BA_BOOLEAN,
    industryExperience: [...CALYPSO_BA_NEED_JSON.industryExperience],
    preferOpenToWork: true,
    qualityFloor: 80,
  },
} as const;
