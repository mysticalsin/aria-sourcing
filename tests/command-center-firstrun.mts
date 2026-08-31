import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_RUN_GUIDE_STEPS,
  ONBOARDING_TOUR_STEPS,
  commandCenterMode,
  isFirstRunWorkspace,
  resolveCommandCenterNextStep,
} from "../src/lib/command-center-firstrun.ts";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

check("empty workspace is first_run", isFirstRunWorkspace({ campaignCount: 0 }));
check("negative count still first_run", isFirstRunWorkspace({ campaignCount: -1 }));
check("any campaign is returning", !isFirstRunWorkspace({ campaignCount: 1 }));
check("mode maps empty → first_run", commandCenterMode({ campaignCount: 0 }) === "first_run");
check("mode maps campaigns → returning", commandCenterMode({ campaignCount: 2 }) === "returning");

const first = resolveCommandCenterNextStep({ campaignCount: 0 });
check("first-run CTA is paste brief", first.cta === "Paste a job brief");
check("first-run href is intake", first.href === "/intake");
check("first-run reason mentions approve", /approve/i.test(first.reason));

const approve = resolveCommandCenterNextStep({
  campaignCount: 3,
  activeCampaignTitle: "Platform Engineer",
  pendingApprovalCount: 2,
  unrepliedCount: 5,
});
check("approvals beat replies", approve.href === "/outreach" && approve.cta === "Review outreach");
check("approvals plural copy", /2 messages/.test(approve.reason));

const reply = resolveCommandCenterNextStep({
  campaignCount: 1,
  activeCampaignTitle: "Platform Engineer",
  pendingApprovalCount: 0,
  unrepliedCount: 1,
});
check("unreplied routes to replies", reply.href === "/replies" && reply.cta === "Check replies");

const active = resolveCommandCenterNextStep({
  campaignCount: 2,
  activeCampaignTitle: "  SRE Lead  ",
  pendingApprovalCount: 0,
  unrepliedCount: 0,
});
check("active campaign keep sourcing", active.cta === "Keep sourcing");
check("active campaign reason uses title", active.reason === "Acting on SRE Lead");
check("active campaign href campaigns", active.href === "/campaigns");

const idle = resolveCommandCenterNextStep({
  campaignCount: 1,
  activeCampaignTitle: null,
  pendingApprovalCount: 0,
  unrepliedCount: 0,
});
check("no active → open campaigns", idle.href === "/campaigns" && idle.cta === "Open campaigns");

check("guide has exactly 3 steps", FIRST_RUN_GUIDE_STEPS.length === 3);
check(
  "guide ids are brief/people/approve",
  FIRST_RUN_GUIDE_STEPS.map((s) => s.id).join(",") === "brief,people,approve",
);
check("tour has exactly 3 steps", ONBOARDING_TOUR_STEPS.length === 3);

const jargon = /\b(fleet|soul|operations floor|300 agents|vivier|entra|microsoft|m365)\b/i;
for (const step of ONBOARDING_TOUR_STEPS) {
  check(`tour step has no enterprise jargon: ${step.title}`, !jargon.test(`${step.title} ${step.body}`));
}
for (const step of FIRST_RUN_GUIDE_STEPS) {
  check(`guide step has no enterprise jargon: ${step.id}`, !jargon.test(`${step.title} ${step.body}`));
}

const commandCenterPage = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const sourceStart = commandCenterPage.indexOf("async function handleSourceBatch()");
const sourceAction = commandCenterPage.slice(sourceStart, commandCenterPage.indexOf("function handleGenerateReport"));
check("Command Center Source next batch names LinkedIn and Apify", /Connect LinkedIn and Apify/.test(sourceAction));
check("Command Center Source next batch surfaces MISSING_PLUGIN", /MISSING_PLUGIN|peoplePluginFailLoudUi|emptyPeopleFirstShortlistError|missingPeoplePlugins/.test(sourceAction));
check(
  "Command Center toasts MISSING_PLUGIN before calling the agent",
  /if \(missingPeoplePlugins\)/.test(sourceAction) &&
    sourceAction.indexOf("if (missingPeoplePlugins)") < sourceAction.indexOf("sourceNextBatch"),
);
check("Command Center remaps invalid-response on people-first", /peoplePluginFailLoudUi\(/.test(sourceAction) && /jobAnalysis/.test(sourceAction));
check("Command Center does not treat empty GitHub as live success", !/Sourced \$\{pluralize\(result\.accepted\.length/.test(sourceAction) || /emptyPeopleFirst/.test(sourceAction));
check("Command Center shows MISSING_PLUGIN alert before click", /cc-missing-plugin/.test(commandCenterPage));
const strip = readFileSync(new URL("../src/components/dashboard/integration-strip.tsx", import.meta.url), "utf8");
check("Command Center strip uses honest Live display", /integrationShowsLive/.test(strip));
check("Command Center strip does not badge raw integration.mode as Live", !/integration\.mode === "live"/.test(strip));
const candidatesPage = readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8");
check(
  "Candidates Source next batch names LinkedIn and Apify before the agent",
  /missingPeoplePluginsToast/.test(candidatesPage) && /Connect LinkedIn and Apify/.test(candidatesPage),
);

console.log(`RESULT command-center-firstrun: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
