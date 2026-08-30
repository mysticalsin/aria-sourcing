/**
 * Non-Calypso golden need — Senior TypeScript Engineer, Berlin / Europe remote.
 * Proves the same parse → strategy → score → top-K → contact-dedupe pipeline
 * is need-agnostic (skills/boolean/geo come from THIS brief, not Calypso).
 */

export const TS_EUROPE_MUST_SKILLS = [
  "TypeScript",
  "Node.js",
  "PostgreSQL",
] as const;

export const TS_EUROPE_NICE_SKILLS = [
  "React",
  "GraphQL",
  "Kubernetes",
  "AWS",
  "CI/CD",
  "System Design",
] as const;

export const TS_EUROPE_BOOLEAN =
  '("TypeScript" OR "Node.js") AND ("Software Engineer" OR "Backend Engineer") AND (PostgreSQL OR Postgres) AND (Berlin OR Germany OR Europe OR EMEA)';

/** VSS-style need text — paste into Intake / parseEmailAndJD. */
export const SAMPLE_TS_EUROPE_NEED = `Summary
Type: Permanent
Category: Active
Priority: 2 - Urgent
Reason: Opening Position
Status: Running

Recruitment Need Purpose
Main Manager: KLEIN Anna
Main Recruiter: MUNERA ALZATE Jacobo
Company Employed by: Meridian Cloud
City: Berlin
Client: Meridian Cloud - Platform
Company Billing To: Meridian Cloud

Project Information
Contract Type: CDI
Freelancer: No
Start Date: 15/09/2026
Number of people: 1
Remote: Fully remote within Europe (CET overlap required)
Client Sector: Technology
Project Type: Expertise
Project Duration: Permanent

Candidate Requirement
Profiles: IS&D - Software Engineer
Title: Senior TypeScript Engineer
Skill (Must): TypeScript, Node.js, PostgreSQL
Skill (Nice to have): React, GraphQL, Kubernetes, AWS, CI/CD, System Design
Language (Must): English - Fluent
Level of Experience: Senior - From 5 to 10 years

Profile Synthesis:
Senior TypeScript Engineer for Meridian Cloud Platform (Berlin hub, fully remote
across Europe / EMEA with CET working-hours overlap). Own backend services in
TypeScript/Node.js, PostgreSQL data layer, GraphQL APIs, and production
reliability on AWS/Kubernetes. Prefer Open to Work. Shortlist quality over
quantity (best 5–20).

Candidate Search Support
Ideal profile Id: TS-ENG-MERIDIAN-EU-2026
Boolean: ("TypeScript" OR "Node.js") AND ("Software Engineer" OR "Backend Engineer") AND (PostgreSQL OR Postgres) AND (Berlin OR Germany OR Europe OR EMEA)
`;

/** JSON brief — usable for API / campaign intake fixtures. */
export const TS_EUROPE_NEED_JSON = {
  id: "TS-ENG-MERIDIAN-EU-2026",
  title: "Senior TypeScript Engineer",
  client: "Meridian Cloud - Platform",
  employer: "Meridian Cloud",
  city: "Berlin",
  remote: "Fully remote within Europe",
  startDate: "2026-09-15",
  seniority: "Senior",
  minYearsExperience: 5,
  maxYearsExperience: 10,
  requiredSkills: [...TS_EUROPE_MUST_SKILLS],
  niceToHaveSkills: [...TS_EUROPE_NICE_SKILLS],
  requiredLanguages: ["English"],
  searchBoolean: TS_EUROPE_BOOLEAN,
  industryExperience: ["Technology", "SaaS"],
  preferOpenToWork: true,
  shortlistMax: 20,
  shortlistMin: 5,
  qualityFloor: 80,
} as const;
