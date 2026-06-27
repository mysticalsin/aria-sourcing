import {
  defaultSkills,
  proposeSkillUpdates,
  learnedParamsFor,
  applyLearning,
  effectiveTone,
  effectiveWeights,
  getSkill,
  SKILL_ORDER,
} from "../src/lib/skills";
import { buildSeedState } from "../src/lib/seed";
import { OUTREACH_TONES } from "../src/lib/types";
import type { AgentSkill, ScoringWeights, SkillKey } from "../src/lib/types";

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

const TONES: readonly string[] = OUTREACH_TONES;
const WEIGHT_KEYS: (keyof ScoringWeights)[] = [
  "skills",
  "experience",
  "companyStage",
  "industry",
  "location",
  "activity",
];

/* ---- defaultSkills() ----------------------------------------------------- */
let skills: AgentSkill[] = [];
try {
  skills = defaultSkills();
  ok("defaultSkills no-throw", true);
} catch (e) {
  ok("defaultSkills no-throw", false);
}

ok("defaultSkills length 4", skills.length === 4);

const expectedKeys: SkillKey[] = [
  "outreach_skill",
  "sourcing_skill",
  "scoring_skill",
  "reply_classification_skill",
];
const keySet = new Set(skills.map((s) => s.key));
for (const k of expectedKeys) {
  ok(`defaultSkills contains key ${k}`, keySet.has(k));
}
ok("SKILL_ORDER matches expected keys", SKILL_ORDER.length === 4 && expectedKeys.every((k) => SKILL_ORDER.includes(k)));

// each default skill is shaped correctly
ok(
  "every default skill version 1",
  skills.every((s) => s.version === 1),
);
ok(
  "every default skill has a history entry",
  skills.every((s) => Array.isArray(s.history) && s.history.length >= 1),
);
ok(
  "outreach default tone is valid",
  TONES.includes(getSkill(skills, "outreach_skill")?.params.preferredTone ?? ""),
);

/* ---- proposeSkillUpdates(buildSeedState()) ------------------------------- */
const state = buildSeedState();
let proposals: ReturnType<typeof proposeSkillUpdates> = [];
try {
  proposals = proposeSkillUpdates(state);
  ok("proposeSkillUpdates no-throw", true);
} catch (e) {
  ok("proposeSkillUpdates no-throw", false);
}
ok("proposeSkillUpdates returns array", Array.isArray(proposals));
ok("proposeSkillUpdates non-empty", proposals.length >= 1);
ok(
  "every proposal has {skill,title,before,after}",
  proposals.every(
    (p) =>
      typeof p.skill === "string" &&
      typeof p.title === "string" &&
      typeof p.before === "string" &&
      typeof p.after === "string",
  ),
);
ok(
  "every proposal skill is a known skill key",
  proposals.every((p) => expectedKeys.includes(p.skill)),
);
// scoring + sourcing proposals are always emitted by the implementation
ok(
  "proposals include a scoring_skill update",
  proposals.some((p) => p.skill === "scoring_skill"),
);
ok(
  "proposals include a sourcing_skill update",
  proposals.some((p) => p.skill === "sourcing_skill"),
);

/* ---- learnedParamsFor('outreach_skill', state) --------------------------- */
let learned: ReturnType<typeof learnedParamsFor> | null = null;
try {
  learned = learnedParamsFor("outreach_skill", state);
  ok("learnedParamsFor outreach no-throw", true);
} catch (e) {
  ok("learnedParamsFor outreach no-throw", false);
}
ok("learnedParamsFor returns object", !!learned && typeof learned === "object");
ok("learnedParamsFor outreach has preferredTone key", !!learned && "preferredTone" in learned);
ok(
  "learnedParamsFor outreach preferredTone is a valid tone",
  !!learned && TONES.includes(learned.preferredTone ?? ""),
);

/* ---- applyLearning(skill, patch, 'x') ------------------------------------ */
const outreachSkill = getSkill(skills, "outreach_skill")!;
const beforeVersion = outreachSkill.version;
const beforeHistoryLen = outreachSkill.history.length;
const beforeApplied = outreachSkill.metrics.applied;

let updated: AgentSkill | null = null;
try {
  updated = applyLearning(outreachSkill, { preferredTone: "Executive" }, "x");
  ok("applyLearning no-throw", true);
} catch (e) {
  ok("applyLearning no-throw", false);
}
ok("applyLearning bumps version by 1", !!updated && updated.version === beforeVersion + 1);
ok("applyLearning merges patch params", !!updated && updated.params.preferredTone === "Executive");
ok(
  "applyLearning preserves untouched params",
  !!updated && updated.params.leadWithArtifact === outreachSkill.params.leadWithArtifact,
);
ok("applyLearning prepends a history entry", !!updated && updated.history.length === beforeHistoryLen + 1);
ok(
  "applyLearning newest history entry is the new version with summary 'x'",
  !!updated && updated.history[0].version === beforeVersion + 1 && updated.history[0].summary === "x",
);
ok("applyLearning increments metrics.applied", !!updated && updated.metrics.applied === beforeApplied + 1);
ok("applyLearning does not mutate the original skill", outreachSkill.version === beforeVersion);

// scoring patch merges weights without dropping existing ones
const scoringSkill = getSkill(skills, "scoring_skill")!;
const updatedScoring = applyLearning(scoringSkill, { weights: { experience: 40 } }, "bump exp");
ok("applyLearning merges weights", updatedScoring.params.weights?.experience === 40);

/* ---- effectiveTone(skills) ----------------------------------------------- */
let tone = "";
try {
  tone = effectiveTone(skills);
  ok("effectiveTone no-throw", true);
} catch (e) {
  ok("effectiveTone no-throw", false);
}
ok("effectiveTone returns a valid tone", TONES.includes(tone));
// when the learned skill carries a tone, that tone wins
const tunedSkills = skills.map((s) =>
  s.key === "outreach_skill" ? { ...s, params: { ...s.params, preferredTone: "Technical" as const } } : s,
);
ok("effectiveTone honors learned preferredTone", effectiveTone(tunedSkills) === "Technical");

/* ---- effectiveWeights(base, skills) -------------------------------------- */
const base: ScoringWeights = {
  skills: 34,
  experience: 22,
  companyStage: 12,
  industry: 12,
  location: 10,
  activity: 10,
};
let weights: ScoringWeights | null = null;
try {
  weights = effectiveWeights(base, skills);
  ok("effectiveWeights no-throw", true);
} catch (e) {
  ok("effectiveWeights no-throw", false);
}
ok(
  "effectiveWeights returns all 6 weight keys",
  !!weights && WEIGHT_KEYS.every((k) => typeof weights![k] === "number"),
);
ok(
  "effectiveWeights falls back to base when no learned overrides",
  !!weights && WEIGHT_KEYS.every((k) => weights![k] === base[k]),
);
// a learned override is overlaid on top of base
const overlaidSkills = skills.map((s) =>
  s.key === "scoring_skill" ? { ...s, params: { ...s.params, weights: { skills: 50 } } } : s,
);
const overlaid = effectiveWeights(base, overlaidSkills);
ok("effectiveWeights overlays learned weights", overlaid.skills === 50 && overlaid.experience === base.experience);

console.log(`RESULT skills: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
