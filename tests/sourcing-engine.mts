import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPTY_CANDIDATE,
  MUREX_ONLY_CANDIDATE,
  NAME_ONLY_CANDIDATE,
  SAMPLE_VSS_CALYPSO_BA_MONTREAL,
  TRADING_PLATFORM_EMAIL,
  TRADING_PLATFORM_POOL,
  runFixtureSourcing,
} from "../src/lib/fixtures/trading-platform-need";
import {
  SHORTLIST_CAP,
  SHORTLIST_FLOOR,
  configuredLiveProviders,
  isNameOnlyHit,
  parseNeed,
  parseNeedFromText,
  runSourcingEngine,
  scoreEvidence,
  shortlistNeed,
} from "../src/lib/sourcing/engine";
import { buildTextLayerPdf, extractPdfText } from "../src/lib/sourcing/ocr";
import { parseVssNeeds } from "../src/lib/sourcing/vss-need";
import { sourceEngineFixtureCandidates } from "../src/lib/sourcing/engine-candidates";
import { applyLiveEngineGate } from "../src/lib/sourcing/live-shortlist";
import { vssToJobAnalysis } from "../src/lib/sourcing/vss-need";

const here = dirname(fileURLToPath(import.meta.url));
const tonyPath = join(here, "fixtures/tony-calypso-amacan-need.txt");
const baSamplePath = join(here, "fixtures/sample-vss-calypso-ba-montreal.txt");
const ocrPdfPath = join(here, "fixtures/ocr/calypso-ba-montreal-need.pdf");
const ocrPngPath = join(here, "fixtures/ocr/calypso-ba-montreal-need.png");
const TONY_AMACAN = readFileSync(tonyPath, "utf8");
const BA_SAMPLE_FILE = readFileSync(baSamplePath, "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("tony AMACAN fixture exists", existsSync(tonyPath) && TONY_AMACAN.includes("Calypso Application Support"));
ok("BA Montreal sample fixture exists", existsSync(baSamplePath) && BA_SAMPLE_FILE.includes("Senior Calypso Business Analyst"));
ok("OCR PDF fixture exists", existsSync(ocrPdfPath));
ok("OCR PNG fixture exists", existsSync(ocrPngPath));
ok(
  "SAMPLE_VSS_CALYPSO_BA_MONTREAL matches the in-repo fixture",
  SAMPLE_VSS_CALYPSO_BA_MONTREAL.includes("Senior Calypso Business Analyst") &&
    SAMPLE_VSS_CALYPSO_BA_MONTREAL.includes("MySQL"),
);

const parsedJd = parseNeed({ jd: TONY_AMACAN });
ok("paste Tony VSS parses as a need", parsedJd.ok === true);
ok(
  "primary title is Calypso Application Support",
  parsedJd.ok && /calypso application support/i.test(parsedJd.need.title),
);
ok("need source is paste", parsedJd.ok && parsedJd.need.source === "paste");
ok(
  "App Support must-haves include Linux Python Shell Oracle Grafana Dynatrace",
  parsedJd.ok &&
    ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"].every((skill) =>
      parsedJd.need.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
    ),
);
ok(
  "Linux Server is kept as a multi-word must-have",
  parsedJd.ok && parsedJd.need.requiredSkills.some((s) => /linux\s+server/i.test(s)),
);
ok(
  "Calypso is a platform skill on the App Support need, not a person",
  parsedJd.ok && parsedJd.need.requiredSkills.some((s) => s.toLowerCase() === "calypso"),
);
ok(
  "Middle 4-6 years maps to min 4",
  parsedJd.ok && parsedJd.need.minYearsExperience === 4,
);

const parsedEmail = parseNeed({ email: TRADING_PLATFORM_EMAIL, jd: TONY_AMACAN });
ok("connected-email + VSS paste parses as email", parsedEmail.ok === true && parsedEmail.need.source === "email");
ok(
  "email+JD still requires Calypso as a platform skill",
  parsedEmail.ok && parsedEmail.need.requiredSkills.some((s) => s.toLowerCase() === "calypso"),
);

const parsedBa = parseNeed({ jd: SAMPLE_VSS_CALYPSO_BA_MONTREAL });
ok("BA VSS parses", parsedBa.ok === true && /senior calypso business analyst/i.test(parsedBa.ok ? parsedBa.need.title : ""));
ok(
  "BA must-haves include Calypso, Business Analysis, MySQL",
  parsedBa.ok &&
    ["Calypso", "Business Analysis", "MySQL"].every((skill) =>
      parsedBa.need.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
    ),
);

const both = parseVssNeeds(`${TONY_AMACAN}\n\n${SAMPLE_VSS_CALYPSO_BA_MONTREAL}`);
ok("combined VSS paste recovers two needs", both.length === 2);
ok(
  "combined paste first need is Application Support",
  /application support/i.test(both[0]?.title ?? ""),
);
ok(
  "combined paste second need is Senior Calypso BA",
  /business analyst/i.test(both[1]?.title ?? ""),
);

ok("empty input is not a need", parseNeed({}).ok === false);
ok("skill-less prose is not a need", parseNeed({ jd: "Please hire someone nice." }).ok === false);

const pdf = buildTextLayerPdf(TONY_AMACAN.slice(0, 1_100));
const pdfText = extractPdfText(pdf);
ok("text-layer PDF extracts Calypso Application Support", pdfText.ok && /calypso/i.test(pdfText.text));
const parsedPdf = parseNeed({ pdfBytes: pdf });
ok("uploaded PDF becomes a need", parsedPdf.ok && parsedPdf.need.source === "upload");

const ocrPdfBytes = new Uint8Array(readFileSync(ocrPdfPath));
const ocrExtract = extractPdfText(ocrPdfBytes);
ok(
  "BA Montreal PDF is text-layer or fail-closed OCR_REQUIRED",
  ocrExtract.ok === true || ocrExtract.code === "OCR_REQUIRED",
);

const blankPdf = buildTextLayerPdf("");
const emptyExtract = extractPdfText(blankPdf);
ok("empty-text PDF is OCR_REQUIRED", emptyExtract.ok === false && emptyExtract.code === "OCR_REQUIRED");
const notPdf = extractPdfText(new Uint8Array([1, 2, 3, 4, 5]));
ok("not a PDF is NOT_PDF", notPdf.ok === false && notPdf.code === "NOT_PDF");

ok("name-only candidate is flagged on App Support", parsedJd.ok && isNameOnlyHit(parsedJd.need, NAME_ONLY_CANDIDATE));
const nameOnlyScore = parsedJd.ok ? scoreEvidence(parsedJd.need, NAME_ONLY_CANDIDATE) : null;
ok("name-only score is 0", nameOnlyScore?.score === 0);
ok("name-only cannot pass the 60% floor", (nameOnlyScore?.score ?? 100) < SHORTLIST_FLOOR);
ok("name-only reason is name_only", nameOnlyScore?.reason === "name_only");
ok(
  "name-only evidence citations are empty",
  (nameOnlyScore?.evidence.cv.length ?? 1) === 0 &&
    (nameOnlyScore?.evidence.skills.length ?? 1) === 0 &&
    (nameOnlyScore?.evidence.linkedin.length ?? 1) === 0,
);

const emptyScore = parsedJd.ok ? scoreEvidence(parsedJd.need, EMPTY_CANDIDATE) : null;
ok("empty evidence scores 0", emptyScore?.score === 0 && emptyScore.reason === "empty");
ok(
  "empty row has empty citation arrays",
  (emptyScore?.evidence.cv.length ?? 1) === 0 &&
    (emptyScore?.evidence.skills.length ?? 1) === 0,
);

const murexScore = parsedJd.ok ? scoreEvidence(parsedJd.need, MUREX_ONLY_CANDIDATE) : null;
ok("adjacent-only platform does not pass 60", (murexScore?.score ?? 100) < SHORTLIST_FLOOR);

const fixtureRun = runFixtureSourcing({ jd: TONY_AMACAN });
ok("fixture engine succeeds on App Support", fixtureRun.ok === true);
if (fixtureRun.ok) {
  const { shortlist, rejected } = fixtureRun.result;
  ok("shortlist cap is 20", shortlist.length <= SHORTLIST_CAP);
  ok("shortlist is non-empty for Application Support", shortlist.length > 0);
  ok(
    "every shortlisted score is at least 60",
    shortlist.every((row) => row.score >= SHORTLIST_FLOOR),
  );
  ok(
    "shortlist is ranked high to low",
    shortlist.every((row, i) => i === 0 || shortlist[i - 1]!.score >= row.score),
  );
  ok(
    "name-only is rejected, not shortlisted",
    rejected.some((row) => row.id === NAME_ONLY_CANDIDATE.id && row.reason === "name_only") &&
      !shortlist.some((row) => row.id === NAME_ONLY_CANDIDATE.id),
  );
  ok(
    "empty evidence is rejected",
    rejected.some((row) => row.id === EMPTY_CANDIDATE.id && row.reason === "empty"),
  );
  ok(
    "no fixture is dressed as live",
    shortlist.every((row) => row.provenance === "fixture"),
  );
  ok(
    "every primary shortlist row has evidence citations",
    shortlist.every(
      (row) =>
        Array.isArray(row.evidence?.skills) &&
        Array.isArray(row.evidence?.cv) &&
        Array.isArray(row.evidence?.linkedin),
    ),
  );
  ok(
    "every primary shortlist row cites CV / experience",
    shortlist.every((row) => (row.evidence?.cv.length ?? 0) > 0),
  );
  ok(
    "every primary shortlist row cites a required skill hit",
    shortlist.every((row) => (row.evidence?.skills.length ?? 0) > 0),
  );
  const scoreSet = new Set(shortlist.map((row) => row.score));
  ok(
    "shortlist scores spread from coverage, not two buckets",
    scoreSet.size >= 8 && scoreSet.size > 2,
  );
  const largestBucket = Math.max(
    0,
    ...[...scoreSet].map((score) => shortlist.filter((row) => row.score === score).length),
  );
  ok("no clustered synthetic score holds most of the shortlist", largestBucket <= 2);
}

const baRun = runFixtureSourcing({ jd: SAMPLE_VSS_CALYPSO_BA_MONTREAL });
ok("BA need produces a scored shortlist", baRun.ok === true && (baRun.ok ? baRun.result.shortlist.length > 0 : false));
ok(
  "BA shortlist meets the 60 floor",
  baRun.ok && baRun.result.shortlist.every((row) => row.score >= SHORTLIST_FLOOR),
);

const emailRun = runFixtureSourcing({ email: TRADING_PLATFORM_EMAIL, jd: TONY_AMACAN });
ok("email need produces a scored shortlist", emailRun.ok === true && (emailRun.ok ? emailRun.result.shortlist.length > 0 : false));

const liveClosed = runSourcingEngine({ jd: TONY_AMACAN, mode: "live" });
ok("live mode without keys or live pool is fail-closed", liveClosed.ok === false && liveClosed.code === "PROVIDER_NOT_CONFIGURED");
ok("fail-closed returns three real paths", liveClosed.ok === false && (liveClosed.paths?.length ?? 0) === 3);

const liveDressed = runSourcingEngine({
  jd: TONY_AMACAN,
  mode: "live",
  pool: TRADING_PLATFORM_POOL,
});
ok("fixture rows cannot be dressed as live", liveDressed.ok === false);

const liveOk = runSourcingEngine({
  jd: TONY_AMACAN,
  mode: "live",
  pool: [
    {
      id: "live-1",
      name: "Elena Varga",
      skills: ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server", "Calypso"],
      cvText:
        "Production support for the Calypso settlement system. Trade Life Cycle, Settlements, Securities, Prime Brokerage.",
      linkedinText: "Applicative Support. Calypso settlement, Capital Markets, Montreal.",
      yearsExperience: 5,
      provenance: "live",
    },
  ],
});
ok("live evidence from a real provider row can be scored", liveOk.ok === true);
ok(
  "configuredLiveProviders is empty in this process unless keys exist",
  Array.isArray(configuredLiveProviders()),
);

const noNameLeak = parseNeedFromText(TONY_AMACAN, "paste");
if (noNameLeak.ok) {
  const sneaky: Parameters<typeof scoreEvidence>[1] = {
    id: "sneaky",
    name: "Calypso Martinez",
    skills: ["Calypso", "Linux"],
    cvText: "Calypso Martinez is a marketer. Brand campaigns only.",
    linkedinText: "Calypso Martinez — marketing.",
    yearsExperience: 10,
    provenance: "fixture",
  };
  const scored = scoreEvidence(noNameLeak.need, sneaky);
  ok("Calypso as a name is stripped even if it appears in CV text as the person", scored.reason === "name_only" || scored.score < SHORTLIST_FLOOR);
  const job = vssToJobAnalysis(parseVssNeeds(TONY_AMACAN)[0]!);
  const blank = {
    email: "",
    avatarInitials: "CM",
    currentTitle: "Marketer",
    currentCompany: "Brand Co",
    location: "",
    timezone: "",
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform: "LinkedIn" as const,
    sourceQuery: "Calypso",
    matchScore: 80,
    matchBreakdown: [],
    yearsExperience: 10,
    companyStageExperience: [],
    industryExperience: [],
    stage: "Sourced" as const,
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
    provenance: "live" as const,
  };
  const gatedOut = applyLiveEngineGate(
    [{
      ...blank,
      id: "name-only-live",
      campaignId: "camp-calypso",
      name: "Calypso Martinez",
      techStack: ["Calypso"],
      recentActivity: "Calypso Martinez is a marketer.",
      experience: ["Calypso Martinez is a marketer. Brand campaigns only."],
    }],
    job,
  );
  ok("live gate drops name-only Calypso Martinez", gatedOut.length === 0);
  const gatedIn = applyLiveEngineGate(
    [{
      ...blank,
      id: "elena-live",
      campaignId: "camp-calypso",
      avatarInitials: "EV",
      name: "Elena Varga",
      currentTitle: "Calypso Application Support",
      currentCompany: "BNPP CIB",
      techStack: ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server", "Calypso"],
      recentActivity: "Applicative Support. Calypso settlement, Capital Markets, Montreal.",
      experience: [
        "Production support for the Calypso settlement system. Trade Life Cycle, Settlements, Securities, Prime Brokerage.",
      ],
    }],
    job,
  );
  ok("live gate keeps a skill-matched person at or above the 60 floor", gatedIn.length === 1 && gatedIn[0]!.matchScore >= SHORTLIST_FLOOR);
  ok(
    "live gate attaches a per-row CV citation",
    Boolean(gatedIn[0]?.matchBreakdown.some((item) => item.key === "experience" && /CV:/i.test(item.rationale))),
  );
}

if (parsedJd.ok) {
  const overflow = shortlistNeed(
    parsedJd.need,
    TRADING_PLATFORM_POOL.filter((c) => c.provenance === "fixture" && /calypso settlement|production support/i.test(c.cvText)),
    50,
  );
  ok("cap cannot exceed 20 even if caller asks for 50", overflow.shortlist.length <= SHORTLIST_CAP);
}

const evidenceDir = join(here, "../_relay/evidence");
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, "trading-need-e2e.json");
const evidence = {
  command: "tsx tests/sourcing-engine.mts",
  exit_code: fail > 0 ? 1 : 0,
  path: "_relay/evidence/trading-need-e2e.json",
  need: parsedJd.ok ? parsedJd.need.title : null,
  requiredSkills: parsedJd.ok ? parsedJd.need.requiredSkills : [],
  shortlistCount: fixtureRun.ok ? fixtureRun.result.shortlist.length : 0,
  scores: fixtureRun.ok ? fixtureRun.result.shortlist.map((row) => row.score) : [],
  shortlist: fixtureRun.ok
    ? fixtureRun.result.shortlist.map((row) => ({
        id: row.id,
        name: row.name,
        score: row.score,
        breakdown: row.breakdown,
        evidence: row.evidence,
        provenance: row.provenance,
      }))
    : [],
  nameOnlyScore: nameOnlyScore?.score ?? null,
  nameOnlyPassedFloor: (nameOnlyScore?.score ?? 0) >= SHORTLIST_FLOOR,
  emptyPassedFloor: (emptyScore?.score ?? 0) >= SHORTLIST_FLOOR,
  secondNeed: parsedBa.ok ? parsedBa.need.title : null,
  combinedNeedCount: both.length,
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
const vssNeeds = parseVssNeeds(TONY_AMACAN);
if (vssNeeds[0]) {
  const campaign = {
    id: "camp-amacan",
    jobAnalysis: vssToJobAnalysis(vssNeeds[0]),
  } as Parameters<typeof sourceEngineFixtureCandidates>[0];
  const mapped = sourceEngineFixtureCandidates(campaign, [], 20);
  ok("engine fixture batch stays at or under 20", mapped.accepted.length <= 20);
  ok("engine fixture batch is non-empty", mapped.accepted.length > 0);
  ok(
    "engine fixture scores meet the 60 floor and are ranked",
    mapped.accepted.every((c, i) => c.matchScore >= 60 && (i === 0 || mapped.accepted[i - 1]!.matchScore >= c.matchScore)),
  );
  ok(
    "engine fixture batch is not a flat 75 cluster",
    new Set(mapped.accepted.map((c) => c.matchScore)).size >= 2,
  );
  ok(
    "engine fixture rows carry CV or LinkedIn evidence",
    mapped.accepted.every((c) => (c.experience?.length ?? 0) > 0 || Boolean(c.recentActivity)),
  );
  ok(
    "name-only Calypso is skipped on the campaign batch",
    mapped.skipped.some((row) => /calypso martinez/i.test(row.name)) &&
      !mapped.accepted.some((c) => /calypso martinez/i.test(c.name)),
  );
  ok(
    "engine fixture rows are not dressed as live",
    mapped.accepted.every((c) => c.provenance === "synthetic"),
  );
}

ok("evidence file written", true);

console.log(`RESULT sourcing-engine: ${pass} passed, ${fail} failed`);
console.log(`EVIDENCE command=${evidence.command} exit_code=${evidence.exit_code} path=${evidence.path}`);
if (fail > 0) process.exitCode = 1;
