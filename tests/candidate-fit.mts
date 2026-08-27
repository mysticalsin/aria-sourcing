import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "../src/lib/sourcing/candidate-fit";
import { buildLinkedInQueryVariants, parseEmailAndJD } from "../src/lib/mock-ai";
import { scoreCandidate, DEFAULT_SCORING_WEIGHTS } from "../src/lib/scoring";
import type { Candidate } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("quality floor is 80", SOURCING_QUALITY_FLOOR === 80);
ok("meets bar at 80", meetsSourcingQualityBar({ matchScore: 80 }));
ok("rejects 79", !meetsSourcingQualityBar({ matchScore: 79 }));
ok(
  "System Designer matches system designer title",
  candidateMatchesRoleTitle(
    { currentTitle: "Senior System Designer", recentActivity: "Medical device product development in Montreal." },
    "System Designer",
  ),
);
ok(
  "Quality manager does not match System Designer",
  !candidateMatchesRoleTitle(
    { currentTitle: "Quality Systems Manager", recentActivity: "FDA and ISO 13485 compliance." },
    "System Designer",
  ),
);
ok(
  "Systems Architect alias matches System Designer role",
  candidateMatchesRoleTitle(
    { currentTitle: "Systems Architect", recentActivity: "Medical device systems in Montreal." },
    "System Designer",
  ),
);
ok(
  "UX Design Systems title does not match System Designer",
  !candidateMatchesRoleTitle(
    {
      currentTitle: "Senior UX Designer | Design Systems Specialist | Product Design Leader",
      recentActivity: "Design systems in Montreal.",
    },
    "System Designer",
  ),
);

const systemDesigner = parseEmailAndJD({
  email: `This need is now ACTIVE: System Designer
Type: Consulting
Client: Magnit Global Canada Ltd
Location: MONTREAL
Profile description:
5+ years of experience in system design and/or product development within the medical device industry.
Skills: Mean Time to Failure (MTTF) Software,Quality Systems Management,FDA Regulations`,
}).jobAnalysis;

const variants = buildLinkedInQueryVariants(systemDesigner, 4);
ok("deep LinkedIn variants >= 4", variants.length >= 4);
ok("every variant includes System Designer", variants.every((q) => /system designer/i.test(q)));

const strongLead = {
  provenance: "live" as const,
  currentTitle: "Senior System Designer",
  currentCompany: "MedTech",
  techStack: ["system design", "medical device", "FDA"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: ["Healthtech"],
  location: "Montreal",
  timezone: "",
  recentActivity: "System Designer medical device FDA MTTF in Montreal.",
} as unknown as Candidate;
const strongScore = scoreCandidate(strongLead, systemDesigner, DEFAULT_SCORING_WEIGHTS);
ok(`strong System Designer lead scores >= 80 (got ${strongScore.score})`, strongScore.score >= 80);
ok("strong lead meets sourcing quality bar", meetsSourcingQualityBar({ matchScore: strongScore.score }));

const weakLead = {
  ...strongLead,
  currentTitle: "Quality Systems Manager",
  techStack: ["FDA"],
  industryExperience: [],
  location: "",
  recentActivity: "FDA quality systems compliance.",
} as unknown as Candidate;
const weakScore = scoreCandidate(weakLead, systemDesigner, DEFAULT_SCORING_WEIGHTS);
ok(`weak lead stays below floor (got ${weakScore.score})`, weakScore.score < SOURCING_QUALITY_FLOOR);

console.log(`RESULT candidate-fit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
