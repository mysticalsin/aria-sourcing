import {
  parseEmailAndJD,
  generateOutreach,
  classifyReply,
  SAMPLE_INTAKE_EMAIL,
} from "../src/lib/mock-ai";
import { buildSeedState } from "../src/lib/seed";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ------------------------------------------------------------------ */
/* 1. parseEmailAndJD(SAMPLE_INTAKE_EMAIL)                              */
/* NOTE: real signature is parseEmailAndJD({ email, jd? }).            */
/* ------------------------------------------------------------------ */
const parsed = parseEmailAndJD({ email: SAMPLE_INTAKE_EMAIL });

ok("parse: department is Platform", parsed.jobAnalysis.department === "Platform");
ok("parse: employmentType is Full-time", parsed.jobAnalysis.employmentType === "Full-time");
ok("parse: requiredSkills includes Go", parsed.jobAnalysis.requiredSkills.includes("Go"));
ok(
  "parse: requiredSkills includes Kubernetes",
  parsed.jobAnalysis.requiredSkills.includes("Kubernetes"),
);
ok("parse: urgency is ASAP", parsed.urgency === "ASAP");
ok("parse: jobAnalysis.urgency mirrors top-level ASAP", parsed.jobAnalysis.urgency === "ASAP");
ok("parse: at least 3 required skills extracted", parsed.jobAnalysis.requiredSkills.length >= 3);

/* arbitrary text containing C++ must not throw (escapeRegExp handles '+') */
try {
  const cpp = parseEmailAndJD({ email: "We need someone with C++ and embedded systems experience." });
  ok("parse: C++ text does not throw", true);
  ok("parse: C++ text still returns a jobAnalysis", !!cpp && !!cpp.jobAnalysis);
} catch {
  ok("parse: C++ text does not throw", false);
  ok("parse: C++ text still returns a jobAnalysis", false);
}

/* ------------------------------------------------------------------ */
/* 2. generateOutreach(candidate, campaign, 'Casual Professional')     */
/* ------------------------------------------------------------------ */
const state = buildSeedState();
const campaign = state.campaigns[0];
const candidate =
  state.candidates.find((c) => c.campaignId === campaign.id) ?? state.candidates[0];

ok("seed: have a campaign", !!campaign);
ok("seed: have a candidate", !!candidate);

let outreach: ReturnType<typeof generateOutreach> | null = null;
try {
  outreach = generateOutreach(candidate, campaign, "Casual Professional");
  ok("outreach: generateOutreach does not throw", true);
} catch {
  ok("outreach: generateOutreach does not throw", false);
}

if (outreach) {
  ok(
    "outreach: >=1 personalizationEvidence",
    Array.isArray(outreach.personalizationEvidence) && outreach.personalizationEvidence.length >= 1,
  );
  ok(
    "outreach: body has no STOP/opt-out boilerplate",
    !outreach.body.includes("STOP") && !outreach.body.toLowerCase().includes("on behalf"),
  );
  // humanizer strips em/en dashes — none should survive
  ok("outreach: body has no em-dash", !outreach.body.includes("—"));
  ok("outreach: body has no en-dash", !outreach.body.includes("–"));
  ok("outreach: subject is a non-empty string", typeof outreach.subject === "string" && outreach.subject.length > 0);
  ok("outreach: channel defaults to Email", outreach.channel === "Email");
} else {
  ok("outreach: >=1 personalizationEvidence", false);
  ok("outreach: body has no STOP/opt-out boilerplate", false);
  ok("outreach: body has no em-dash", false);
  ok("outreach: body has no en-dash", false);
  ok("outreach: subject is a non-empty string", false);
  ok("outreach: channel defaults to Email", false);
}

const noEvidenceCandidate = {
  ...candidate,
  currentCompany: "",
  techStack: [],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  recentActivity: "",
};
const genericSubjects: Record<string, string> = {
  en: `${campaign.jobAnalysis.title} opportunity`,
  fr: `Opportunité de ${campaign.jobAnalysis.title}`,
  es: `Oportunidad de ${campaign.jobAnalysis.title}`,
  de: `Position als ${campaign.jobAnalysis.title}`,
  pt: `Oportunidade para ${campaign.jobAnalysis.title}`,
  it: `Opportunità come ${campaign.jobAnalysis.title}`,
  nl: `Vacature voor ${campaign.jobAnalysis.title}`,
};

for (const [language, expectedSubject] of Object.entries(genericSubjects)) {
  const noEvidenceOutreach = generateOutreach(
    noEvidenceCandidate,
    campaign,
    "Casual Professional",
    "Email",
    1,
    undefined,
    language,
  );
  ok(
    `outreach: ${language} no-evidence subject is generic and translated`,
    noEvidenceOutreach.subject === expectedSubject,
  );
  ok(
    `outreach: ${language} no-evidence subject makes no unsupported fit claim`,
    !/background|fit|expérience|experiencia|erfahrung|ervaring/i.test(noEvidenceOutreach.subject),
  );
}

const unrelatedSkillOutreach = generateOutreach(
  { ...noEvidenceCandidate, techStack: ["UnrelatedLegacySkill"] },
  campaign,
  "Casual Professional",
  "Email",
  1,
  undefined,
  "en",
);
ok(
  "outreach: unrelated profile skill does not create role-fit evidence",
  unrelatedSkillOutreach.personalizationEvidence.length === 0,
);
ok(
  "outreach: unrelated profile skill keeps the generic subject",
  unrelatedSkillOutreach.subject === genericSubjects.en,
);
ok(
  "outreach: unrelated profile skill keeps the evidence-free salutation",
  unrelatedSkillOutreach.body.startsWith(`Hi ${noEvidenceCandidate.name.split(" ")[0]},\n`),
);

/* ------------------------------------------------------------------ */
/* 3. classifyReply                                                    */
/* ------------------------------------------------------------------ */
const neg = classifyReply("please stop contacting me");
ok("reply: 'please stop contacting me' -> NEGATIVE", neg.intent === "NEGATIVE");
ok("reply: NEGATIVE confidence high", neg.confidence >= 0.8);

const interested = classifyReply("yes I am interested, when can we talk");
ok("reply: 'yes I am interested, when can we talk' -> INTERESTED", interested.intent === "INTERESTED");
ok("reply: INTERESTED confidence high", interested.confidence >= 0.8);

/* Salary/role questions with no decline are QUALIFIED_INTEREST per the
   reply_classification_skill (a standalone branch now implements this). */
const salaryOnly = classifyReply("what is the salary and is it remote?");
ok("reply: salary-only question -> QUALIFIED_INTEREST", salaryOnly.intent === "QUALIFIED_INTEREST");

const qualified = classifyReply("Yes I'm interested! What is the salary and is it remote?");
ok(
  "reply: interest + salary/remote questions -> QUALIFIED_INTEREST",
  qualified.intent === "QUALIFIED_INTEREST",
);

const ooo = classifyReply("out of office until Monday");
ok("reply: 'out of office until Monday' -> OOO", ooo.intent === "OOO");

/* every classification carries the supporting metadata */
for (const r of [neg, interested, salaryOnly, qualified, ooo]) {
  ok(`reply: ${r.intent} has suggestedAction`, typeof r.suggestedAction === "string" && r.suggestedAction.length > 0);
  ok(`reply: ${r.intent} draftResponse has no em-dash`, !r.draftResponse.includes("—"));
}

console.log(`RESULT mock-ai: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
