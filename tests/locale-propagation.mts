import { buildOutreachPrompt } from "../src/lib/ai/hermes";
import { detectLanguage, detectLanguageWithHermes, BUSINESS_LANGUAGE_CATALOG } from "../src/lib/i18n";
import { extractLocaleContext } from "../src/lib/mantu-need-parse";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("business language catalog has ~60 entries", BUSINESS_LANGUAGE_CATALOG.length >= 58);

ok("detect FR", detectLanguage("Bonjour, merci pour votre message, cordialement") === "fr");
ok("detect DE", detectLanguage("Hallo, danke für Ihre Nachricht") === "de");
ok("detect JA script", detectLanguage("こんにちは、ご連絡ありがとうございます") === "ja");
ok("detect AR", detectLanguage("مرحبا شكرا على رسالتكم") === "ar");

const jaHint = detectLanguageWithHermes("こんにちは、ご連絡ありがとうございます");
ok("JA hermes hint false when detected", jaHint.code === "ja" && jaHint.hermesHint === false);

const locale = extractLocaleContext(
  {
    city: "Paris",
    clientSector: "Banking",
    languagesMust: ["French"],
    languagesNice: ["English"],
    client: "BNP Paribas",
    type: "Consulting",
  },
  "Bonjour, nous recrutons un consultant Murex à Paris.",
);
ok("locale primary FR from languagesMust", locale.primaryLanguage === "fr");
ok("locale work city", locale.workCity === "Paris");
ok("locale sector", locale.clientSector === "Banking");

const frPrompt = buildOutreachPrompt({
  candidateName: "Marie",
  candidateTitle: "Engineer",
  candidateCompany: "Acme",
  techStack: ["Java"],
  recentActivity: "Open source",
  yearsExperience: 5,
  roleTitle: "Consultant",
  locationType: "Hybrid",
  regions: ["Paris"],
  requiredSkills: ["Java"],
  tone: "Casual Professional",
  channel: "Email",
  language: "fr",
  localeContext: locale,
});
ok("FR outreach prompt names language", /ISO code\): fr/.test(frPrompt));
ok("FR outreach prompt carries locale city", /Work city: Paris/.test(frPrompt));

const dePrompt = buildOutreachPrompt({
  candidateName: "Hans",
  candidateTitle: "Engineer",
  candidateCompany: "Acme",
  techStack: ["SAP"],
  recentActivity: "n/a",
  yearsExperience: 8,
  roleTitle: "Berater",
  locationType: "Remote",
  regions: ["DE"],
  requiredSkills: ["SAP"],
  tone: "Casual Professional",
  channel: "Email",
  language: "de",
  localeContext: { primaryLanguage: "de", formality: "formal", marketCountry: "Germany" },
});
ok("DE outreach prompt carries market", /Market country: Germany/.test(dePrompt));

console.log(`RESULT locale-propagation: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
