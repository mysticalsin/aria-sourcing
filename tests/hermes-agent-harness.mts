import {
  buildHermesHarnessSystemPrompt,
  HERMES_TASK_SKILL,
  HERMES_TASK_SYSTEM,
  resolveSkillPlaybook,
} from "../src/lib/agents/hermes-agent-harness";
import {
  HERMES_QUALITY_CRITICS,
  HERMES_RECRUITING_AGENTS,
  MANTU_SOURCING_MISSION,
} from "../src/lib/agents/hermes-agent-registry";
import { defaultSkills, getSkill } from "../src/lib/skills";
import type { AgentSkill } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const tasks = ["outreach", "classify", "sourcing", "chat"] as const;

ok("shared mission present", MANTU_SOURCING_MISSION.includes("qualified candidates"));
ok("four agents + three critics", HERMES_RECRUITING_AGENTS.length === 4 && HERMES_QUALITY_CRITICS.length === 3);

for (const task of tasks) {
  const prompt = HERMES_TASK_SYSTEM[task];
  ok(`${task} harness includes mission`, prompt.includes("Mission:"));
  ok(`${task} harness includes skill playbook`, prompt.includes("Skill playbook"));
  ok(`${task} maps to a skill key`, Boolean(HERMES_TASK_SKILL[task]));
  const playbook = resolveSkillPlaybook(task);
  ok(`${task} default playbook key matches`, playbook.key === HERMES_TASK_SKILL[task]);
}

const outreach = buildHermesHarnessSystemPrompt("outreach");
ok("outreach harness names Mantu Group", /Mantu Group/.test(outreach));
ok("outreach harness bans salary disclosure", /salary|Never disclose salary/i.test(outreach));
ok("outreach harness bans generic openers", /I hope this finds you well|generic openers/i.test(outreach));
ok("outreach harness requires Subject format", /Subject:/.test(outreach));
ok("outreach agent uses candidate-thread memory", /candidate thread/i.test(outreach));

const classify = buildHermesHarnessSystemPrompt("classify");
ok("classify harness marks reply untrusted", /untrusted/i.test(classify));
ok("classify harness requires JSON", /JSON only/.test(classify));

const sourcing = buildHermesHarnessSystemPrompt("sourcing");
ok("sourcing harness forbids invented profiles", /never invent/i.test(sourcing));

const custom: AgentSkill[] = defaultSkills().map((s) =>
  s.key === "outreach_skill"
    ? { ...s, version: 9, content: "# Outreach\n\n- CUSTOM_PLAYBOOK_MARKER for harness test.\n" }
    : s,
);
const customPrompt = buildHermesHarnessSystemPrompt("outreach", custom);
ok("workspace skill content wins over defaults", customPrompt.includes("CUSTOM_PLAYBOOK_MARKER"));
ok("workspace skill version surfaces in harness", customPrompt.includes("v9"));

const defaults = defaultSkills();
ok("default outreach skill requires Mantu Group brand", /Mantu Group/.test(getSkill(defaults, "outreach_skill")!.content));
ok(
  "default outreach skill bans generic openers",
  /I hope this finds you well/.test(getSkill(defaults, "outreach_skill")!.content),
);
ok(
  "default sourcing skill forbids invented profiles",
  /never invent/i.test(getSkill(defaults, "sourcing_skill")!.content),
);

console.log(`RESULT hermes-agent-harness: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
