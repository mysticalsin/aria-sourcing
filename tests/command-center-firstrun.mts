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
check("active campaign reason is context, not the product H1", active.reason !== "SRE Lead");
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

const heroPanel = readFileSync(
  new URL("../src/components/dashboard/hero-panel.tsx", import.meta.url),
  "utf8",
);
const design = readFileSync(new URL("../docs/sourcing-engine/DESIGN.md", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
check(
  "returning H1 is Aria-shaped, never the campaign title",
  /Your next move is ready\./.test(heroPanel) &&
    /cc-acting-on/.test(heroPanel) &&
    !/nextStep\.reason\?\.replace\(\/\^Acting on \//.test(heroPanel),
);
check("first-run H1 stays paste a job", /Paste a job\. Aria finds people\./.test(heroPanel));
check(
  "hero decor is a clipped layer that cannot expand the scroll container",
  /data-testid="cc-hero-decor"/.test(heroPanel) &&
    /absolute inset-0 overflow-hidden/.test(heroPanel) &&
    /pointer-events-none/.test(heroPanel),
);
check(
  "DESIGN Command Center home chrome forbids campaign-title H1 and html overflow-x hide",
  /Command Center home chrome/.test(design) &&
    /NEVER the campaign title/.test(design) &&
    /scrollWidth <= clientWidth/.test(design) &&
    /no first-pass hide/.test(design),
);
check(
  "root layout does not hide overflow-x on html or body",
  !/<html[^>]*className="[^"]*overflow-x-hidden/.test(layoutSource) &&
    !/<body[^>]*className="[^"]*overflow-x-hidden/.test(layoutSource),
);
check(
  "harvest query pins stay Calypso Business Analyst and App Support Linux Python",
  /Calypso Business Analyst/.test(design) &&
    /Calypso Linux Python/.test(design) &&
    /Calypso Business Analysis MySQL/.test(design),
);

const commandCenterPage = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const sourceStart = commandCenterPage.indexOf("async function handleSourceBatch()");
const sourceAction = commandCenterPage.slice(sourceStart, commandCenterPage.indexOf("function handleGenerateReport"));
check("Command Center Source next batch still remaps live-provider failures", /sourceRejectedToast/.test(sourceAction));
check("Command Center Source next batch surfaces people-plugin honesty", /emptyPeopleFirstToast|emptyPeopleFirstShortlistError|missingPeoplePlugins/.test(sourceAction));
check(
  "Command Center does not wall Source next batch behind missingPeoplePlugins",
  !(/if \(missingPeoplePlugins\)/.test(sourceAction) &&
    sourceAction.indexOf("if (missingPeoplePlugins)") < sourceAction.indexOf("sourceNextBatch")),
);
check("Command Center remaps invalid-response on people-first", /sourceRejectedToast\(/.test(sourceAction) && /jobAnalysis/.test(sourceAction));
check("Command Center fail toast carries CTA fields", /href: failLoud\.href/.test(sourceAction) && /actionLabel: failLoud\.actionLabel/.test(sourceAction));
check("Command Center rejected Source next batch stays visible", /source-next-batch-error/.test(commandCenterPage) && /role="alert"/.test(commandCenterPage));
check("Command Center does not treat empty GitHub as live success", !/Sourced \$\{pluralize\(result\.accepted\.length/.test(sourceAction) || /emptyPeopleFirst/.test(sourceAction));
const connectChannels = readFileSync(new URL("../src/components/dashboard/connect-channels.tsx", import.meta.url), "utf8");
check(
  "Command Center shows in-product Connect CTAs",
  /ConnectChannels|cc-connect-channels/.test(commandCenterPage) &&
    /cc-connect-linkedin/.test(connectChannels) &&
    /cc-connect-outlook/.test(connectChannels),
);
const strip = readFileSync(new URL("../src/components/dashboard/integration-strip.tsx", import.meta.url), "utf8");
check("Command Center strip uses honest Live display", /integrationShowsLive/.test(strip));
check("Command Center strip does not badge raw integration.mode as Live", !/integration\.mode === "live"/.test(strip));
const candidatesPage = readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8");
check(
  "Candidates Source next batch names LinkedIn and Apify before the agent",
  /sourceRejectedToast|emptyPeopleFirstToast|peoplePluginFailLoudUi/.test(candidatesPage) && /ConnectChannels|cc-connect-channels/.test(candidatesPage),
);
check(
  "Command Center fail-loud toast carries a CTA href",
  /href: failLoud/.test(sourceAction) || /actionLabel: failLoud/.test(sourceAction),
);

console.log(`RESULT command-center-firstrun: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
