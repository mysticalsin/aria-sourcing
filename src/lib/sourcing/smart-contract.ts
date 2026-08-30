/**
 * Shared SMART resume-DB contracts (no I/O, no server-only).
 * Live HTTP client lives in smart.ts.
 */

export interface SmartResumeHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  linkedinUrl: string;
  skills: string[];
  yearsExperience: number | null;
  experience: string[];
  education: string[];
  ocrText: string;
  matchScore: number;
  updatedAt: string;
}

export interface SmartMatchRequest {
  title: string;
  requiredSkills: string[];
  niceToHaveSkills?: string[];
  regions?: string[];
  keywords?: string;
  limit: number;
  offset?: number;
}

export interface SmartWritebackRequest {
  smartResumeId: string;
  ariaCandidateId: string;
  campaignId: string;
  campaignTitle?: string;
  status: "sourced" | "shortlisted" | "rejected" | "hired";
  matchScore?: number;
  notes?: string;
}

export interface SmartWritebackReceipt {
  receiptId: string;
  smartResumeId: string;
  status: SmartWritebackRequest["status"];
}

export const SMART_DEFAULT_RANK_WINDOW = 50;
export const SMART_MAX_RANK_WINDOW = 100;

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function numOrNull(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function stringArray(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function toSmartResumeHit(raw: unknown): SmartResumeHit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o, "id") || str(o, "resumeId") || str(o, "resume_id");
  if (!id) return null;
  const firstName = str(o, "firstName") || str(o, "first_name");
  const lastName = str(o, "lastName") || str(o, "last_name");
  const name = str(o, "name");
  const skills = stringArray(o, "skills");
  const ocrText =
    str(o, "ocrText") || str(o, "ocr_text") || str(o, "resumeText") || str(o, "resume_text");
  const matchScoreRaw =
    numOrNull(o, "matchScore") ?? numOrNull(o, "match_score") ?? numOrNull(o, "score");
  const matchScore = Math.max(0, Math.min(100, matchScoreRaw ?? 0));
  let resolvedFirst = firstName;
  let resolvedLast = lastName;
  if (!resolvedFirst && !resolvedLast && name) {
    const parts = name.trim().split(/\s+/);
    resolvedFirst = parts[0] ?? "";
    resolvedLast = parts.slice(1).join(" ");
  }
  return {
    id,
    firstName: resolvedFirst,
    lastName: resolvedLast,
    email: str(o, "email"),
    phone: str(o, "phone"),
    currentTitle: str(o, "currentTitle") || str(o, "current_title") || str(o, "title"),
    currentCompany: str(o, "currentCompany") || str(o, "current_company") || str(o, "company"),
    location: str(o, "location"),
    linkedinUrl: str(o, "linkedinUrl") || str(o, "linkedin_url"),
    skills,
    yearsExperience: numOrNull(o, "yearsExperience") ?? numOrNull(o, "years_experience"),
    experience: stringArray(o, "experience"),
    education: stringArray(o, "education"),
    ocrText,
    matchScore,
    updatedAt: str(o, "updatedAt") || str(o, "updated_at") || "",
  };
}

export function selectBestSmartMatches(hits: SmartResumeHit[], keep: number): SmartResumeHit[] {
  const n = Math.min(Math.max(Math.trunc(keep) || 1, 1), SMART_MAX_RANK_WINDOW);
  return [...hits]
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.id.localeCompare(b.id);
    })
    .slice(0, n);
}

export function mockSmartCorpus(): SmartResumeHit[] {
  return [
    {
      id: "smart_mock_001",
      firstName: "Camille",
      lastName: "Dubois",
      email: "camille.dubois@example.com",
      phone: "",
      currentTitle: "Senior Platform Engineer",
      currentCompany: "Northwind Labs",
      location: "Paris, France",
      linkedinUrl: "https://www.linkedin.com/in/camille-dubois-mock",
      skills: ["TypeScript", "Kubernetes", "Go", "PostgreSQL"],
      yearsExperience: 8,
      experience: [
        "Senior Platform Engineer @ Northwind Labs (2021–Present)",
        "Software Engineer @ Acme Cloud (2017–2021)",
      ],
      education: ["MSc Computer Science @ EPITA"],
      ocrText:
        "Camille Dubois — Senior Platform Engineer. TypeScript, Kubernetes, Go, PostgreSQL. Built multi-region platform services. Recent: shipped Kubernetes operators and gRPC control plane.",
      matchScore: 92,
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
    {
      id: "smart_mock_002",
      firstName: "Jordan",
      lastName: "Nguyen",
      email: "jordan.nguyen@example.com",
      phone: "",
      currentTitle: "Staff Backend Engineer",
      currentCompany: "River Systems",
      location: "Lyon, France",
      linkedinUrl: "",
      skills: ["Java", "Spring", "Kafka", "AWS"],
      yearsExperience: 11,
      experience: ["Staff Backend Engineer @ River Systems (2019–Present)"],
      education: ["Engineering degree @ INSA Lyon"],
      ocrText:
        "Jordan Nguyen — Staff Backend Engineer specializing in Java, Spring, Kafka, AWS. Led event-driven platform migration. Active contributor to internal service mesh.",
      matchScore: 84,
      updatedAt: "2026-07-15T08:30:00.000Z",
    },
    {
      id: "smart_mock_003",
      firstName: "Alex",
      lastName: "Martin",
      email: "",
      phone: "",
      currentTitle: "Full-Stack Developer",
      currentCompany: "Boutique Studio",
      location: "Remote, EU",
      linkedinUrl: "",
      skills: ["React", "Node.js", "CSS"],
      yearsExperience: 3,
      experience: ["Full-Stack Developer @ Boutique Studio (2023–Present)"],
      education: [],
      ocrText: "Alex Martin — Full-Stack Developer. React, Node.js, CSS. Portfolio of marketing sites.",
      matchScore: 41,
      updatedAt: "2026-06-01T12:00:00.000Z",
    },
    {
      id: "smart_mock_004",
      firstName: "Samira",
      lastName: "Benali",
      email: "samira.benali@example.com",
      phone: "+33100000000",
      currentTitle: "Lead Data Engineer",
      currentCompany: "Mantu Digital",
      location: "Casablanca, Morocco",
      linkedinUrl: "https://www.linkedin.com/in/samira-benali-mock",
      skills: ["Python", "Spark", "dbt", "Airflow", "SQL"],
      yearsExperience: 9,
      experience: [
        "Lead Data Engineer @ Mantu Digital (2020–Present)",
        "Data Engineer @ FinServe (2016–2020)",
      ],
      education: ["MSc Data Science"],
      ocrText:
        "Samira Benali — Lead Data Engineer. Python, Spark, dbt, Airflow, SQL. Designed lakehouse pipelines and recently published internal data-quality frameworks.",
      matchScore: 88,
      updatedAt: "2026-08-10T09:00:00.000Z",
    },
    {
      id: "smart_mock_005",
      firstName: "Theo",
      lastName: "Keller",
      email: "theo.keller@example.com",
      phone: "",
      currentTitle: "SRE",
      currentCompany: "Orbit Cloud",
      location: "Berlin, Germany",
      linkedinUrl: "",
      skills: ["Kubernetes", "Terraform", "Go", "Prometheus"],
      yearsExperience: 6,
      experience: ["SRE @ Orbit Cloud (2022–Present)"],
      education: [],
      ocrText:
        "Theo Keller — SRE. Kubernetes, Terraform, Go, Prometheus. On-call for multi-cluster reliability; shipped SLO dashboards this month.",
      matchScore: 79,
      updatedAt: "2026-08-20T14:00:00.000Z",
    },
  ];
}

export function scoreMockAgainstQuery(hit: SmartResumeHit, req: SmartMatchRequest): number {
  const hay = `${hit.currentTitle} ${hit.ocrText} ${hit.skills.join(" ")}`.toLowerCase();
  const required = req.requiredSkills.map((s) => s.toLowerCase()).filter(Boolean);
  const nice = (req.niceToHaveSkills ?? []).map((s) => s.toLowerCase()).filter(Boolean);
  const titleTok = req.title.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  let score = hit.matchScore * 0.35;
  if (required.length) {
    const hitCount = required.filter((s) => hay.includes(s)).length;
    score += (hitCount / required.length) * 40;
  }
  if (nice.length) {
    const hitCount = nice.filter((s) => hay.includes(s)).length;
    score += (hitCount / nice.length) * 10;
  }
  if (titleTok.some((t) => hay.includes(t))) score += 10;
  const regions = (req.regions ?? []).map((r) => r.toLowerCase()).filter(Boolean);
  const europeFocus = regions.some((r) =>
    /^(eu|eea|emea|europe|uk|gb|germany|france|netherlands|spain|italy)$/i.test(r.trim()),
  );
  const loc = hit.location.toLowerCase();
  const europeLoc =
    /\b(?:europe|eu|uk|germany|france|netherlands|spain|italy|berlin|paris|london|amsterdam|madrid|warsaw|dublin|munich)\b/i.test(
      loc,
    );
  const farLoc =
    /\b(?:united states|usa|canada|brazil|india|singapore|japan|toronto|montreal|new york|san francisco|bangalore|mumbai|tokyo|sydney)\b/i.test(
      loc,
    );
  if (europeFocus) {
    if (europeLoc) score += 12;
    else if (farLoc) score -= 10;
  } else {
    const region = regions[0];
    if (
      region &&
      region !== "global" &&
      loc.includes(region.split(",")[0]!.trim())
    ) {
      score += 5;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function mockMatchResumes(req: SmartMatchRequest): SmartResumeHit[] {
  const window = Math.min(
    Math.max(req.limit || SMART_DEFAULT_RANK_WINDOW, 1),
    SMART_MAX_RANK_WINDOW,
  );
  const scored = mockSmartCorpus().map((hit) => ({
    ...hit,
    matchScore: scoreMockAgainstQuery(hit, req),
  }));
  return selectBestSmartMatches(scored, window);
}
