/**
 * AI generation client tests.
 *
 * Verifies:
 *  - no setting of the retired external agent runtime survives (seed, migration)
 *  - the "Aria Agent" key provider is registered
 *  - the parser tolerates Aria replies and falls back when unusable
 *  - browser settings never bypass named human review for a generated message
 */
import { buildSeedState, defaultSettings, STATE_VERSION } from "../src/lib/seed.js";
import { parseHermesOutreach, buildOutreachPrompt } from "../src/lib/ai/hermes.js";
import { migrateToCurrentVersion, normalizeHermesState } from "../src/lib/store/migrations.js";
import { newOutreachMessage } from "../src/lib/mock-ai.js";
import { API_KEY_PROVIDERS } from "../src/lib/types.js";
import type { GeneratedOutreach } from "../src/lib/mock-ai.js";
import type { HermesState } from "../src/lib/types.js";

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

/* ---- 1. The retired agent runtime left no setting behind ---------------- */

const RETIRED_RUNTIME_SETTINGS = ["hermesLiveMode", "hermesApiUrl", "hermesApiKeyId", "hermesWebUrl"];
const hasRetired = (settings: object) => RETIRED_RUNTIME_SETTINGS.some((key) => key in settings);

const seed = buildSeedState();
ok("seed version is current", seed.version === STATE_VERSION);
ok("seed settings carry no retired runtime field", !hasRetired(seed.settings));
ok("default settings carry no retired runtime field", !hasRetired(defaultSettings()));

const savedWithRuntime = {
  ...seed,
  settings: {
    ...seed.settings,
    hermesLiveMode: true,
    hermesApiUrl: "http://127.0.0.1:8642",
    hermesApiKeyId: "key_runtime",
    hermesWebUrl: "http://127.0.0.1:8643",
  },
} as HermesState;
const normalized = normalizeHermesState(savedWithRuntime);
ok("a saved workspace drops the retired runtime fields", !hasRetired(normalized.settings));
ok("dropping them keeps the other settings", normalized.settings.operatorName === seed.settings.operatorName);
ok(
  "an older saved workspace drops them during migration too",
  !hasRetired(migrateToCurrentVersion({ ...savedWithRuntime, version: 7 }).settings),
);

const defs = defaultSettings();

/* ---- 2. "Aria Agent" key provider registered -------------------------- */

ok("API_KEY_PROVIDERS includes 'Aria Agent'", (API_KEY_PROVIDERS as readonly string[]).includes("Aria Agent"));

/* ---- 3. parseHermesOutreach --------------------------------------------- */

const parsed = parseHermesOutreach(
  "Subject: Loved your async runtime work\n\nHi Maya, your recent commits caught my eye. 15 minutes?",
  "Email",
  "fallback subject",
);
ok("parser extracts subject", parsed?.subject === "Loved your async runtime work");
ok("parser strips subject line from body", !!parsed && !parsed.body.toLowerCase().startsWith("subject:"));
ok("parser keeps body", !!parsed && parsed.body.includes("Hi Maya"));

const noSubject = parseHermesOutreach("Hi there, quick note about a role.", "Email", "fallback subject");
ok("parser synthesizes subject from first line when none", !!noSubject && noSubject.subject.length > 0);

ok("parser returns null on empty text (→ caller falls back to mock)", parseHermesOutreach("", "Email", "fb") === null);
ok("parser returns null on whitespace-only text", parseHermesOutreach("   \n  ", "Email", "fb") === null);
ok(
  "parser rejects a draft with an unfilled slot (→ caller keeps the template)",
  parseHermesOutreach("Subject: Hello\n\nHi Maya, I'm [Name] from [Company]. 15 minutes?", "Email", "fb") === null &&
    parseHermesOutreach("Subject: Hello\n\nHi {{first_name}}, quick note.", "Email", "fb") === null,
);
ok(
  "parser keeps ordinary punctuation and links",
  parseHermesOutreach("Subject: Hello\n\nHi Maya (Go, Rust): see https://example.com/a?b=1. 15 minutes?", "Email", "fb") !== null,
);

/* ---- 6. buildOutreachPrompt is self-contained --------------------------- */

const prompt = buildOutreachPrompt({
  candidateName: "Maya Okafor",
  candidateTitle: "Staff Engineer",
  candidateCompany: "Brightloop",
  techStack: ["Go", "Kubernetes"],
  recentActivity: "Shipped a zero-downtime migration tool",
  yearsExperience: 9,
  roleTitle: "Principal Platform Engineer",
  locationType: "Remote",
  regions: ["EU"],
  requiredSkills: ["Go", "Distributed Systems"],
  tone: "Casual Professional",
  channel: "Email",
  language: "en",
  persona: "Warm peer-to-peer recruiter",
  signature: "— Aria",
});
ok("prompt mentions the candidate", prompt.includes("Maya Okafor"));
ok("prompt mentions the role", prompt.includes("Principal Platform Engineer"));
ok("prompt requests Subject: format", prompt.includes("Subject:"));

/* ---- 7. Approval-authority invariant on a live-drafted-shaped message ---- */

const cand = seed.candidates[0];
const camp = seed.campaigns.find((c) => c.id === cand?.campaignId) ?? seed.campaigns[0];
if (cand && camp) {
  const gen: GeneratedOutreach = {
    subject: "Live subject",
    body: "Live body from Aria runtime.",
    personalizationEvidence: ["specific recent work"],
    channel: "Email",
  };

  // Gate ON → message must be "Needs Approval" (never auto-sent).
  const gated = newOutreachMessage(cand, camp, gen, "Casual Professional", { ...defs, humanApprovalGate: true });
  ok("approval gate ON → status 'Needs Approval'", gated.status === "Needs Approval");
  ok("live-drafted message has no sentAt", gated.sentAt === null);
  ok("live-drafted message has no approvedBy", gated.approvedBy === null);

  // A legacy browser flag cannot grant delivery authority.
  const ungated = newOutreachMessage(cand, camp, gen, "Casual Professional", { ...defs, humanApprovalGate: false });
  ok("legacy approval flag OFF still requires human review", ungated.status === "Needs Approval");
  ok("legacy flag cannot mark a message sent", ungated.sentAt === null);

  // LinkedIn live messages never auto-send — they wait for manual copy/paste.
  const linkedInGen: GeneratedOutreach = { ...gen, channel: "LinkedIn" };
  const linkedInGated = newOutreachMessage(cand, camp, linkedInGen, "Casual Professional", { ...defs, humanApprovalGate: true, dryRunMode: false });
  ok("linkedin live + gate ON requires human review", linkedInGated.status === "Needs Approval");

  const linkedInUngated = newOutreachMessage(cand, camp, linkedInGen, "Casual Professional", { ...defs, humanApprovalGate: false, dryRunMode: false });
  ok("linkedin live + legacy gate OFF still requires human review", linkedInUngated.status === "Needs Approval");
  ok("linkedin generated message is not auto-sent", linkedInUngated.sentAt === null);
} else {
  ok("seed has a candidate + campaign for the gate test", false);
}

/* ---- Report ------------------------------------------------------------- */

console.log(`RESULT hermes-live: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
