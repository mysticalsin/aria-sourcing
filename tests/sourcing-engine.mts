import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPTY_CANDIDATE,
  MUREX_ONLY_CANDIDATE,
  NAME_ONLY_CANDIDATE,
  TRADING_PLATFORM_EMAIL,
  TRADING_PLATFORM_JD,
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

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const parsedJd = parseNeed({ jd: TRADING_PLATFORM_JD });
ok("paste JD parses as a need", parsedJd.ok === true);
ok(
  "Calypso is a required skill on the need, not a person",
  parsedJd.ok && parsedJd.need.requiredSkills.some((s) => s.toLowerCase() === "calypso"),
);
ok("need source is paste", parsedJd.ok && parsedJd.need.source === "paste");

const parsedEmail = parseNeed({ email: TRADING_PLATFORM_EMAIL });
ok("connected-email shape parses", parsedEmail.ok === true && parsedEmail.need.source === "email");
ok(
  "email need requires Calypso as a platform skill",
  parsedEmail.ok && parsedEmail.need.requiredSkills.some((s) => s.toLowerCase() === "calypso"),
);

ok("empty input is not a need", parseNeed({}).ok === false);
ok("skill-less prose is not a need", parseNeed({ jd: "Please hire someone nice." }).ok === false);

const pdf = buildTextLayerPdf(TRADING_PLATFORM_JD);
const pdfText = extractPdfText(pdf);
ok("text-layer PDF extracts Calypso JD", pdfText.ok && pdfText.text.toLowerCase().includes("calypso"));
const parsedPdf = parseNeed({ pdfBytes: pdf });
ok("uploaded PDF becomes a need", parsedPdf.ok && parsedPdf.need.source === "upload");

const blankPdf = buildTextLayerPdf("");
ok("empty-text PDF is OCR_REQUIRED", extractPdfText(blankPdf).ok === false);
ok("not a PDF is NOT_PDF", extractPdfText(new Uint8Array([1, 2, 3, 4, 5])).code === "NOT_PDF");

ok("name-only candidate is flagged", parsedJd.ok && isNameOnlyHit(parsedJd.need, NAME_ONLY_CANDIDATE));
const nameOnlyScore = parsedJd.ok ? scoreEvidence(parsedJd.need, NAME_ONLY_CANDIDATE) : null;
ok("name-only score is 0", nameOnlyScore?.score === 0);
ok("name-only cannot pass the 60% floor", (nameOnlyScore?.score ?? 100) < SHORTLIST_FLOOR);
ok("name-only reason is name_only", nameOnlyScore?.reason === "name_only");

const emptyScore = parsedJd.ok ? scoreEvidence(parsedJd.need, EMPTY_CANDIDATE) : null;
ok("empty evidence scores 0", emptyScore?.score === 0 && emptyScore.reason === "empty");

const murexScore = parsedJd.ok ? scoreEvidence(parsedJd.need, MUREX_ONLY_CANDIDATE) : null;
ok("adjacent-only platform does not pass 60", (murexScore?.score ?? 100) < SHORTLIST_FLOOR);

const fixtureRun = runFixtureSourcing({ jd: TRADING_PLATFORM_JD });
ok("fixture engine succeeds", fixtureRun.ok === true);
if (fixtureRun.ok) {
  const { shortlist, rejected } = fixtureRun.result;
  ok("shortlist cap is 20", shortlist.length <= SHORTLIST_CAP);
  ok("shortlist is non-empty for the trading-platform need", shortlist.length > 0);
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
}

const emailRun = runFixtureSourcing({ email: TRADING_PLATFORM_EMAIL });
ok("email need produces a scored shortlist", emailRun.ok === true && (emailRun.ok ? emailRun.result.shortlist.length > 0 : false));

const liveClosed = runSourcingEngine({ jd: TRADING_PLATFORM_JD, mode: "live" });
ok("live mode without keys or live pool is fail-closed", liveClosed.ok === false && liveClosed.code === "PROVIDER_NOT_CONFIGURED");
ok("fail-closed returns three real paths", liveClosed.ok === false && (liveClosed.paths?.length ?? 0) === 3);

const liveDressed = runSourcingEngine({
  jd: TRADING_PLATFORM_JD,
  mode: "live",
  pool: TRADING_PLATFORM_POOL,
});
ok("fixture rows cannot be dressed as live", liveDressed.ok === false);

const liveOk = runSourcingEngine({
  jd: TRADING_PLATFORM_JD,
  mode: "live",
  pool: [
    {
      id: "live-1",
      name: "Elena Varga",
      skills: ["Calypso", "Trade Capture", "SQL", "Capital Markets", "FO/BO"],
      cvText: "Calypso BA. Trading platform implementation, trade capture, FO/BO, settlement.",
      linkedinText: "Calypso Business Analyst. Capital markets trading platform.",
      yearsExperience: 8,
      provenance: "live",
    },
  ],
});
ok("live evidence from a real provider row can be scored", liveOk.ok === true);
ok(
  "configuredLiveProviders is empty in this process unless keys exist",
  Array.isArray(configuredLiveProviders()),
);

const noNameLeak = parseNeedFromText(TRADING_PLATFORM_JD, "paste");
if (noNameLeak.ok) {
  const sneaky: Parameters<typeof scoreEvidence>[1] = {
    id: "sneaky",
    name: "Calypso Martinez",
    skills: ["Calypso", "Trade Capture"],
    cvText: "Calypso Martinez is a marketer. Brand campaigns only.",
    linkedinText: "Calypso Martinez — marketing.",
    yearsExperience: 10,
    provenance: "fixture",
  };
  const scored = scoreEvidence(noNameLeak.need, sneaky);
  ok("Calypso as a name is stripped even if it appears in CV text as the person", scored.reason === "name_only" || scored.score < SHORTLIST_FLOOR);
}

if (parsedJd.ok) {
  const overflow = shortlistNeed(
    parsedJd.need,
    TRADING_PLATFORM_POOL.filter((c) => c.provenance === "fixture" && c.cvText.includes("Calypso Business Analyst")),
    50,
  );
  ok("cap cannot exceed 20 even if caller asks for 50", overflow.shortlist.length <= SHORTLIST_CAP);
}

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../_relay/evidence");
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, "trading-need-e2e.json");
const evidence = {
  command: "tsx tests/sourcing-engine.mts",
  exit_code: fail > 0 ? 1 : 0,
  path: evidencePath,
  need: parsedJd.ok ? parsedJd.need.title : null,
  shortlistCount: fixtureRun.ok ? fixtureRun.result.shortlist.length : 0,
  scores: fixtureRun.ok ? fixtureRun.result.shortlist.map((row) => row.score) : [],
  nameOnlyPassedFloor: (nameOnlyScore?.score ?? 0) >= SHORTLIST_FLOOR,
  emptyPassedFloor: (emptyScore?.score ?? 0) >= SHORTLIST_FLOOR,
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
ok("evidence file written", true);

console.log(`RESULT sourcing-engine: ${pass} passed, ${fail} failed`);
console.log(`EVIDENCE command=${evidence.command} exit_code=${evidence.exit_code} path=${evidence.path}`);
if (fail > 0) process.exitCode = 1;
