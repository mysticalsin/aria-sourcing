import type { StageId } from "../pipeline/stages";

/**
 * Synthetic gallery data. Every address is on example.test.
 * Nothing here is a real person, a customer, or a send.
 */

export type SyntheticLanguage = "EN" | "FR" | "PT";

export type SyntheticSource = "Candidate-supplied" | "Recruiter CSV" | "RSC/ATS";

export type SyntheticCandidate = {
  id: string;
  name: string;
  email: string;
  role: string;
  location: string;
  language: SyntheticLanguage;
  score: number;
  stage: StageId;
  skills: readonly string[];
  source: SyntheticSource;
};

export const SYNTHETIC_CANDIDATES: readonly SyntheticCandidate[] = [
  {
    id: "p-jordan",
    name: "Jordan Example",
    email: "jordan.example@example.test",
    role: "Platform engineer",
    location: "Lisbon",
    language: "EN",
    score: 86,
    stage: "to-assess",
    skills: ["TypeScript", "Postgres", "Kubernetes"],
    source: "Candidate-supplied",
  },
  {
    id: "p-sam",
    name: "Sam Rivera",
    email: "sam.rivera@example.test",
    role: "Data engineer",
    location: "Lyon",
    language: "FR",
    score: 74,
    stage: "to-rate",
    skills: ["Python", "dbt", "BigQuery"],
    source: "Recruiter CSV",
  },
  {
    id: "p-noor",
    name: "Noor Haddad",
    email: "noor.haddad@example.test",
    role: "Product designer",
    location: "São Paulo",
    language: "PT",
    score: 91,
    stage: "to-interview",
    skills: ["Figma", "Research", "Design systems"],
    source: "RSC/ATS",
  },
  {
    id: "p-alex",
    name: "Alex Nguyen",
    email: "alex.nguyen@example.test",
    role: "Site reliability engineer",
    location: "Berlin",
    language: "EN",
    score: 68,
    stage: "shoot",
    skills: ["Go", "Terraform", "Observability"],
    source: "Recruiter CSV",
  },
  {
    id: "p-riley",
    name: "Riley Okonkwo",
    email: "riley.okonkwo@example.test",
    role: "Engagement manager",
    location: "Paris",
    language: "FR",
    score: 81,
    stage: "qm",
    skills: ["Discovery", "Facilitation", "French"],
    source: "Candidate-supplied",
  },
  {
    id: "p-casey",
    name: "Casey Moreau",
    email: "casey.moreau@example.test",
    role: "Finance transformation lead",
    location: "Brussels",
    language: "FR",
    score: 77,
    stage: "to-hire",
    skills: ["SAP", "Controls", "Stakeholder mapping"],
    source: "RSC/ATS",
  },
  {
    id: "p-quinn",
    name: "Quinn Alves",
    email: "quinn.alves@example.test",
    role: "Backend engineer",
    location: "Porto",
    language: "PT",
    score: 83,
    stage: "to-rate",
    skills: ["Java", "Kafka", "SQL"],
    source: "Candidate-supplied",
  },
  {
    id: "p-harper",
    name: "Harper Silva",
    email: "harper.silva@example.test",
    role: "People partner",
    location: "Madrid",
    language: "EN",
    score: 90,
    stage: "hired",
    skills: ["Coaching", "Policy", "Spanish"],
    source: "RSC/ATS",
  },
];

export type KpiFixture = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  deltaPercent: number;
  period: string;
  series: readonly number[];
};

export const KPI_FIXTURE: readonly KpiFixture[] = [
  {
    id: "to-rate",
    label: "In To Rate",
    value: 128,
    deltaPercent: 12.4,
    period: "vs last week",
    series: [72, 80, 76, 90, 98, 110, 128],
  },
  {
    id: "strong",
    label: "Suggestion 80 or higher",
    value: 46,
    deltaPercent: 4.1,
    period: "vs last week",
    series: [30, 32, 31, 36, 40, 44, 46],
  },
  {
    id: "drafts",
    label: "Drafts waiting",
    value: 9,
    deltaPercent: -18.2,
    period: "vs last week",
    series: [16, 15, 14, 13, 12, 11, 9],
  },
  {
    id: "mirrored",
    label: "Mirrored to Odoo",
    value: 121,
    deltaPercent: 6.1,
    period: "vs last week",
    series: [90, 96, 100, 104, 110, 116, 121],
  },
];

export const FUNNEL_FIXTURE: readonly { stage: string; count: number }[] = [
  { stage: "To Rate", count: 128 },
  { stage: "To Assess", count: 74 },
  { stage: "To Interview", count: 41 },
  { stage: "Shoot", count: 22 },
  { stage: "QM", count: 14 },
  { stage: "To Hire", count: 6 },
  { stage: "Hired", count: 2 },
];

export const WEEKLY_DRAFTS: readonly { day: string; count: number }[] = [
  { day: "Mon", count: 4 },
  { day: "Tue", count: 7 },
  { day: "Wed", count: 5 },
  { day: "Thu", count: 9 },
  { day: "Fri", count: 6 },
  { day: "Sat", count: 1 },
  { day: "Sun", count: 0 },
];

export type ScoreBand = "all" | "80+" | "under-80";

export type CandidateFilters = {
  stage: StageId | "all";
  language: SyntheticLanguage | "all";
  score: ScoreBand;
};

export const EMPTY_FILTERS: CandidateFilters = {
  stage: "all",
  language: "all",
  score: "all",
};

export function applyCandidateFilters(
  people: readonly SyntheticCandidate[],
  filters: CandidateFilters,
): SyntheticCandidate[] {
  return people.filter((person) => {
    if (filters.stage !== "all" && person.stage !== filters.stage) return false;
    if (filters.language !== "all" && person.language !== filters.language) return false;
    if (filters.score === "80+" && person.score < 80) return false;
    if (filters.score === "under-80" && person.score >= 80) return false;
    return true;
  });
}

export function activeFilterCount(filters: CandidateFilters): number {
  return [filters.stage, filters.language, filters.score].filter((value) => value !== "all").length;
}
