import type { JobAnalysis, SourcePlatform } from "./types";

/* ============================================================================
   ROLE-AGNOSTIC PROFILES
   Aria treats every need on its own terms: it reads the job analysis, infers
   the role family, and adapts the candidate pool + sourcing platforms + query
   style to THAT need — so a Murex/finance consulting need yields finance
   consultants (sourced on professional networks), not software engineers.
   ========================================================================== */

export type RoleFamily =
  | "software"
  | "data"
  | "design"
  | "product"
  | "sales"
  | "finance"
  | "marketing"
  | "generic";

export interface RoleProfile {
  family: RoleFamily;
  label: string;
  titles: string[];
  companies: string[];
  platforms: SourcePlatform[];
  queryStyle: "github" | "linkedin";
}

const PROFILES: Record<RoleFamily, Omit<RoleProfile, "family">> = {
  software: {
    label: "Software engineering",
    titles: ["Software Engineer", "Senior Software Engineer", "Backend Engineer", "Full-Stack Engineer", "Staff Engineer", "Platform Engineer"],
    companies: ["Brightloop", "Helix Data", "Forgepoint", "Aurora Grid", "Meridian Cloud", "Northwind Labs", "Vellum AI", "Cobalt Systems"],
    platforms: ["GitHub", "LinkedIn", "Stack Overflow"],
    queryStyle: "github",
  },
  data: {
    label: "Data & ML",
    titles: ["Data Engineer", "Machine Learning Engineer", "Data Scientist", "Analytics Engineer", "ML Platform Engineer"],
    companies: ["Helix Data", "Vellum AI", "Snowfield Analytics", "Latchkey", "Aurora Grid", "Meridian Cloud"],
    platforms: ["GitHub", "LinkedIn", "Stack Overflow"],
    queryStyle: "github",
  },
  design: {
    label: "Product design",
    titles: ["Product Designer", "Senior Product Designer", "UX Designer", "Design Lead", "Design Systems Lead"],
    companies: ["Brightloop", "Hearthstack", "Tideglass", "Cartograph", "Vellum AI"],
    platforms: ["Dribbble", "Behance", "LinkedIn"],
    queryStyle: "linkedin",
  },
  product: {
    label: "Product management",
    titles: ["Product Manager", "Senior Product Manager", "Group Product Manager", "Principal PM"],
    companies: ["Brightloop", "Meridian Cloud", "Vantage One", "Beacon Holdings", "Latchkey"],
    platforms: ["LinkedIn", "Referral", "Talent Pool"],
    queryStyle: "linkedin",
  },
  sales: {
    label: "Revenue & sales",
    titles: ["Account Executive", "Senior Account Executive", "Enterprise AE", "Sales Manager", "Revenue Lead"],
    companies: ["Atlas Digital", "Vantage One", "Beacon Holdings", "Pillar Tech", "Cygnus Corp"],
    platforms: ["LinkedIn", "Referral", "Talent Pool"],
    queryStyle: "linkedin",
  },
  finance: {
    label: "Finance & consulting",
    titles: [
      "Murex Consultant",
      "Front Office Support Analyst",
      "Trading Systems Specialist",
      "Quant Risk Analyst",
      "Market Risk Consultant",
      "Capital Markets Consultant",
      "Pricing & Valuation Analyst",
    ],
    companies: ["Meridian Capital", "Sablefin Markets", "Voltline Trading", "Cartograph Risk", "Hollweave Advisory", "Crestmont Capital", "Northbank"],
    platforms: ["LinkedIn", "Talent Pool", "Referral"],
    queryStyle: "linkedin",
  },
  marketing: {
    label: "Marketing & growth",
    titles: ["Growth Marketer", "Demand Generation Lead", "Content Strategist", "Performance Marketing Manager", "Brand Lead"],
    companies: ["Atlas Digital", "Beacon Holdings", "Hearthstack", "Vantage One"],
    platforms: ["LinkedIn", "Referral", "Talent Pool"],
    queryStyle: "linkedin",
  },
  generic: {
    label: "Specialist",
    titles: ["Specialist", "Senior Consultant", "Analyst", "Manager", "Lead"],
    companies: ["Granite Industries", "Eastfield Group", "Crestmont", "Bayline", "Vantage One"],
    platforms: ["LinkedIn", "Talent Pool", "Referral"],
    queryStyle: "linkedin",
  },
};

const CODE_SKILLS = /\b(go|golang|python|typescript|javascript|java|kotlin|scala|rust|c\+\+|kubernetes|react|node|graphql|grpc|terraform|aws|gcp)\b/i;
const FINANCE_SIGNALS = /\b(murex|finance|financial|pricing|trading|front office|risk|valuation|capital markets|bonds|derivatives|quant|mx\.iii|treasury|bank)\b/i;

export function roleFamily(jd: JobAnalysis): RoleFamily {
  const hay = `${jd.title} ${jd.department} ${jd.requiredSkills.join(" ")} ${jd.industryExperience.join(" ")}`;
  const dept = jd.department.toLowerCase();

  if (FINANCE_SIGNALS.test(hay) || /consulting|finance|banking/.test(dept)) return "finance";
  if (/design/.test(dept) || /\b(figma|ux|ui|design systems|prototyping)\b/i.test(hay)) return "design";
  if (/\bdata\b|ml|machine learning|analytics/.test(dept) || /\b(tensorflow|pytorch|spark|dbt|snowflake|airflow|llm|rag)\b/i.test(hay)) return "data";
  if (/sales|revenue/.test(dept) || /\b(account executive|quota|pipeline generation|sdr|bdr)\b/i.test(hay)) return "sales";
  if (/product/.test(dept) && !/engineer/i.test(jd.title)) return "product";
  if (/marketing|growth/.test(dept)) return "marketing";
  if (/platform|engineering/.test(dept) || CODE_SKILLS.test(hay) || /engineer|developer|architect/i.test(jd.title)) return "software";
  return "generic";
}

export function roleProfile(jd: JobAnalysis): RoleProfile {
  const family = roleFamily(jd);
  return { family, ...PROFILES[family] };
}
