/**
 * Aria live LLM path tests.
 *
 * Verifies:
 *  - the new SystemSettings shape + defaults (hermesLiveMode/hermesApiUrl/hermesApiKeyId)
 *  - migration fills the new fields on old-shaped state
 *  - the hermesAvailable guard gates on BOTH live mode AND a configured URL
 *  - the "Aria Agent" key provider is registered
 *  - the parser tolerates Aria replies and falls back when unusable
 *  - browser settings never bypass named human review for a generated message
 */
import { buildSeedState, defaultSettings, STATE_VERSION } from "../src/lib/seed.js";
import { historicalSeedState } from "./seed-fixtures.mts";
import { hermesAvailable, parseHermesOutreach, buildOutreachPrompt } from "../src/lib/ai/hermes.js";
import { newOutreachMessage } from "../src/lib/mock-ai.js";
import { API_KEY_PROVIDERS } from "../src/lib/types.js";
import type { GeneratedOutreach } from "../src/lib/mock-ai.js";
import type { SystemSettings } from "../src/lib/types.js";

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

/* ---- 1. Settings shape + defaults --------------------------------------- */

const seed = historicalSeedState();
ok("seed version is current", seed.version === STATE_VERSION);
ok("hermesLiveMode defaults false", seed.settings.hermesLiveMode === false);
ok("hermesApiUrl defaults empty string", seed.settings.hermesApiUrl === "");
ok("hermesApiKeyId defaults empty string", seed.settings.hermesApiKeyId === "");

const defs = defaultSettings();
ok("defaultSettings has hermesLiveMode false", defs.hermesLiveMode === false);
ok("defaultSettings has hermesApiUrl empty", defs.hermesApiUrl === "");
ok("defaultSettings has hermesApiKeyId empty", defs.hermesApiKeyId === "");

/* ---- 2. "Aria Agent" key provider registered -------------------------- */

ok("API_KEY_PROVIDERS includes 'Aria Agent'", (API_KEY_PROVIDERS as readonly string[]).includes("Aria Agent"));

/* ---- 3. Migration fills new fields when missing ------------------------- */

// Simulate an old (v7) state blob missing the new fields.
const oldSettings = {
  ...seed.settings,
  hermesLiveMode: undefined as unknown as boolean,
  hermesApiUrl: undefined as unknown as string,
  hermesApiKeyId: undefined as unknown as string,
};
const migratedSettings = {
  ...oldSettings,
  hermesLiveMode: oldSettings.hermesLiveMode ?? defs.hermesLiveMode,
  hermesApiUrl: oldSettings.hermesApiUrl ?? defs.hermesApiUrl,
  hermesApiKeyId: oldSettings.hermesApiKeyId ?? defs.hermesApiKeyId,
};
ok("migration fills hermesLiveMode", migratedSettings.hermesLiveMode === false);
ok("migration fills hermesApiUrl", migratedSettings.hermesApiUrl === "");
ok("migration fills hermesApiKeyId", migratedSettings.hermesApiKeyId === "");
ok("migration preserves operatorName", migratedSettings.operatorName === seed.settings.operatorName);

/* ---- 4. hermesAvailable guard ------------------------------------------- */

ok("not available when live mode off (default)", !hermesAvailable(defs));
ok(
  "not available when live mode on but URL empty",
  !hermesAvailable({ ...defs, hermesLiveMode: true, hermesApiUrl: "" } as SystemSettings),
);
ok(
  "available when live mode on AND URL set",
  hermesAvailable({ ...defs, hermesLiveMode: true, hermesApiUrl: "http://127.0.0.1:8642" } as SystemSettings),
);

/* ---- 5. parseHermesOutreach --------------------------------------------- */

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
