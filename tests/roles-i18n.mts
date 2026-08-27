import { roleFamily, roleProfile } from "../src/lib/roles";
import {
  parseEmailAndJD,
  SAMPLE_MANTU_EMAIL,
  createCampaign,
  sourceCandidates,
  generateOutreach,
  classifyReply,
} from "../src/lib/mock-ai";
import { detectLanguage } from "../src/lib/i18n";
import { buildSeedState } from "../src/lib/seed";
import { historicalSeedState } from "./seed-fixtures.mts";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- role-agnostic ---- */
const finJd = parseEmailAndJD({ email: SAMPLE_MANTU_EMAIL }).jobAnalysis;
ok("Murex/finance need -> finance family", roleFamily(finJd) === "finance");
const finProfile = roleProfile(finJd);
ok("finance titles are finance roles", finProfile.titles.some((t) => /murex|front office|risk|consultant|analyst|markets/i.test(t)));
ok("finance sourced on professional networks first", finProfile.platforms[0] === "LinkedIn");

const finCampaign = createCampaign(finJd, { hiringManager: "X", hiringManagerEmail: "x@y.example" });
const sourced = sourceCandidates(finCampaign, "LinkedIn", 6, []);
ok("finance candidates were produced", sourced.accepted.length > 0);
ok("finance candidates are NOT software engineers", sourced.accepted.every((c) => !/software engineer|developer/i.test(c.currentTitle)));
ok("finance candidate titles are role-appropriate", sourced.accepted.some((c) => /consultant|analyst|murex|risk|specialist/i.test(c.currentTitle)));

const swJd = buildSeedState().campaigns[0].jobAnalysis; // seeded Senior Backend Engineer
ok("software need -> software family", roleFamily(swJd) === "software");

const systemDesignerJd = parseEmailAndJD({
  email: `This need is now ACTIVE: System Designer
Type: Consulting
Client: Magnit Global Canada Ltd
Location: MONTREAL
Profile description:
5+ years of experience in system design within the medical device industry.
Skills: FDA Regulations,Quality Systems Management`,
}).jobAnalysis;
ok("System Designer Mantu need is not finance", roleFamily(systemDesignerJd) !== "finance");
ok("System Designer sources on LinkedIn first", roleProfile(systemDesignerJd).platforms[0] === "LinkedIn");

/* ---- multilingual outreach ---- */
const seed = historicalSeedState();
const cand = seed.candidates[0];
const camp = seed.campaigns.find((c) => c.id === cand.campaignId)!;

const frMsg = generateOutreach(cand, camp, "Casual Professional", "Email", 1, undefined, "fr");
ok("FR outreach is in French", /bonjour|nous recrutons|mantu group recrute/i.test(frMsg.body));
ok("FR outreach has no STOP opt-out", !/STOP/i.test(frMsg.body));

const deMsg = generateOutreach(cand, camp, "Casual Professional", "Email", 1, undefined, "de");
ok("DE outreach is in German", /hallo|wir suchen|mantu group sucht/i.test(deMsg.body));

const enMsg = generateOutreach(cand, camp, "Casual Professional", "Email", 1, undefined, "en");
ok("EN outreach baseline (no opt-out)", /hi /i.test(enMsg.body) && !/reply stop/i.test(enMsg.body));
ok("EN outreach names Mantu Group in body", /\bMantu Group\b/.test(enMsg.body));

/* ---- multilingual classify ---- */
ok("detect FR", detectLanguage("Bonjour, merci pour votre message, cordialement") === "fr");
ok("detect ES", detectLanguage("Hola, gracias por su mensaje") === "es");
ok("FR decline -> NOT_INTERESTED", classifyReply("Non merci, ce n'est pas le moment.").intent === "NOT_INTERESTED");
ok("FR opt-out -> NEGATIVE", classifyReply("Merci de me désinscrire de votre liste.").intent === "NEGATIVE");
ok("ES interest -> INTERESTED/QUALIFIED", ["INTERESTED", "QUALIFIED_INTEREST"].includes(classifyReply("Sí, me encantaría hablar.").intent));
ok("DE out-of-office -> OOO", classifyReply("Ich bin im Urlaub bis Montag.").intent === "OOO");

console.log(`RESULT roles-i18n: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
