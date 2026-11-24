/* ============================================================================
   tests/skill-evidence.mts
   Area: which brief skills a public search result actually names.
   ========================================================================== */

import { skillsObservedIn } from "../src/lib/sourcing/skill-evidence";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const brief = [
  "IT or digital transformation",
  "Enterprise AI programs",
  "AI governance",
  "Responsible AI frameworks",
  "AI adoption and change management at scale",
  "Executive stakeholder management (C-level)",
  "Generative AI",
];

const text = "Head of AI Strategy and Adoption at OpenAI. Generative AI adoption and change management at scale for enterprise AI programs.";
const seen = skillsObservedIn(text, brief);
ok("a skill phrase matches when all its words appear", seen.includes("AI adoption and change management at scale"));
ok("plural and singular forms match", skillsObservedIn("Runs the enterprise AI program", brief).includes("Enterprise AI programs"));
ok("a skill whose words are missing is not observed", !seen.includes("AI governance"));
ok("results come back as written in the brief", seen.every((skill) => brief.includes(skill)));
ok("one 'or' alternative is enough", skillsObservedIn("A digital transformation leader", brief).includes("IT or digital transformation"));
ok("the English word 'it' is not the skill IT", skillsObservedIn("I lead it here", ["IT"]).length === 0);
ok("IT in capitals is the skill IT", skillsObservedIn("Head of IT", ["IT"]).length === 1);
ok("two-letter acronyms need capitals", skillsObservedIn("generative ai", ["Generative AI"]).length === 0);
ok("accents do not block a match", skillsObservedIn("Stratégie données", ["strategie donnees"]).length === 1);
ok("asides in brackets are not required", skillsObservedIn("executive stakeholder management", brief).includes("Executive stakeholder management (C-level)"));
ok("empty text observes nothing", skillsObservedIn("  ", brief).length === 0);

console.log(`RESULT skill-evidence: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
