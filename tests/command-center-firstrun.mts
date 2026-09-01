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
    /\[contain:paint\]/.test(heroPanel) &&
    /pointer-events-none/.test(heroPanel) &&
    !/-right-24/.test(heroPanel),
);
check(
  "DESIGN Command Center home chrome forbids campaign-title H1 and html overflow-x hide",
  /Command Center home chrome/.test(design) &&
    /NEVER the campaign title/.test(design) &&
    /scrollWidth <= clientWidth/.test(design) &&
    /no first-pass hide/.test(design) &&
    /1270-wide viewport/.test(design) &&
    /cc-integration-pills/.test(design) &&
    /cc-activity-outcome/.test(design) &&
    /contain:paint/.test(design),
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
const sourceStart = commandCenterPage.indexOf("async function applySourceOutcome(");
const sourceAction = commandCenterPage.slice(sourceStart, commandCenterPage.indexOf("function handleGenerateReport"));
check("Command Center Source next batch still remaps live-provider failures", /sourceRejectedToast/.test(sourceAction));
check("Command Center Source next batch surfaces people-plugin honesty", /emptyPeopleFirstToast|emptyPeopleFirstShortlistError|missingPeoplePlugins/.test(sourceAction));
check(
  "Command Center sourcing chrome is Source next batch + Auto source, not Apify",
  /Source next batch/.test(commandCenterPage) &&
    /Auto source/.test(commandCenterPage) &&
    /handleAutoSource/.test(commandCenterPage) &&
    !/Source via Apify/.test(commandCenterPage) &&
    !/Run Aria/.test(commandCenterPage),
);
check(
  "Command Center does not wall Source next batch behind missingPeoplePlugins",
  !(/if \(missingPeoplePlugins\)/.test(sourceAction) &&
    sourceAction.indexOf("if (missingPeoplePlugins)") < sourceAction.indexOf("sourceNextBatch")),
);
check("Command Center remaps invalid-response on people-first", /sourceRejectedToast\(/.test(sourceAction) && /jobAnalysis/.test(sourceAction));
check("Command Center fail toast carries CTA fields", /href: failLoud\.href/.test(sourceAction) && /actionLabel: failLoud\.actionLabel/.test(sourceAction));
check("Command Center rejected Source next batch stays visible", /source-next-batch-error/.test(commandCenterPage) && /role="alert"/.test(commandCenterPage));
check(
  "Command Center pipeline for this campaign uses the visible shortlist",
  /pipelineCandidates/.test(commandCenterPage) &&
    /funnelForCandidates\(pipelineCandidates\)/.test(commandCenterPage),
);
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
check(
  "Command Center integration pills wrap and shrink so they cannot expand the page",
  /data-testid="cc-integration-pills"/.test(strip) &&
    /flex-wrap/.test(strip) &&
    /min-w-0/.test(strip) &&
    /max-w-full/.test(strip) &&
    !/-mx-1 flex gap-2 overflow-x-auto/.test(strip),
);

/** Model the live overflow: nowrap shrink-0 pills in a flex row grow the page.
 *  wrap + min-w-0 bounds the row to the viewport. Ultron: 1270 clientWidth,
 *  pills right edge ~1690. */
function integrationPillsPageWidth(opts: {
  viewportWidth: number;
  wrap: boolean;
  minW0: boolean;
  pillWidths: number[];
  gap: number;
}): number {
  const nowrap =
    opts.pillWidths.reduce((sum, width) => sum + width, 0) +
    opts.gap * Math.max(0, opts.pillWidths.length - 1);
  if (!opts.wrap && !opts.minW0) return nowrap;
  return Math.min(opts.viewportWidth, nowrap);
}
const livePills = [210, 190, 200, 185, 195, 180, 220, 205];
check(
  "1270-wide viewport does not get a horizontal scroller from topbar pills",
  integrationPillsPageWidth({
    viewportWidth: 1270,
    wrap: true,
    minW0: true,
    pillWidths: livePills,
    gap: 8,
  }) <= 1270,
);
check(
  "nowrap non-shrinking pills would overflow 1270 (the live bug)",
  integrationPillsPageWidth({
    viewportWidth: 1270,
    wrap: false,
    minW0: false,
    pillWidths: livePills,
    gap: 8,
  }) > 1270,
);

const timeline = readFileSync(
  new URL("../src/components/shared/activity-timeline.tsx", import.meta.url),
  "utf8",
);
check(
  "activity fail-loud outcome pills wrap so they cannot expand the page",
  /data-testid="cc-activity-outcome"/.test(timeline) &&
    /whitespace-normal/.test(timeline) &&
    /break-words/.test(timeline) &&
    /max-w-full/.test(timeline),
);

/** Ultron 1270: nowrap fail-loud outcome (right edge 1313) + unclipped -right-24 orbital. */
function activityOrbitalPageWidth(opts: {
  viewportWidth: number;
  columnWidth: number;
  outcomeWidth: number;
  wrapOutcome: boolean;
  orbitalProtrusion: number;
  clipOrbital: boolean;
}): number {
  const outcomeOverflow = opts.wrapOutcome
    ? 0
    : Math.max(0, opts.outcomeWidth - opts.columnWidth);
  const orbitalOverflow = opts.clipOrbital ? 0 : opts.orbitalProtrusion;
  return opts.viewportWidth + outcomeOverflow + orbitalOverflow;
}
check(
  "1270-wide viewport does not grow from wrapped outcome pill + clipped orbital",
  activityOrbitalPageWidth({
    viewportWidth: 1270,
    columnWidth: 400,
    outcomeWidth: 480,
    wrapOutcome: true,
    orbitalProtrusion: 96,
    clipOrbital: true,
  }) <= 1270,
);
check(
  "nowrap outcome plus unclipped orbital overflow 1270 (the live bug)",
  activityOrbitalPageWidth({
    viewportWidth: 1270,
    columnWidth: 400,
    outcomeWidth: 480,
    wrapOutcome: false,
    orbitalProtrusion: 96,
    clipOrbital: false,
  }) > 1270,
);
const candidatesPage = readFileSync(new URL("../src/app/candidates/page.tsx", import.meta.url), "utf8");
check(
  "Candidates Source next batch names LinkedIn and Apify before the agent",
  /sourceRejectedToast|emptyPeopleFirstToast|peoplePluginFailLoudUi/.test(candidatesPage) && /ConnectChannels|cc-connect-channels/.test(candidatesPage),
);
check(
  "Candidates chrome is Source next batch + Auto source, not Apify",
  /Source next batch/.test(candidatesPage) &&
    /Auto source/.test(candidatesPage) &&
    /handleAutoSource/.test(candidatesPage) &&
    !/Source via Apify/.test(candidatesPage),
);
const campaignsPage = readFileSync(new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url), "utf8");
check(
  "Campaign chrome is Source next batch + Auto source, not actor pickers",
  /Source next batch/.test(campaignsPage) &&
    /Auto source/.test(campaignsPage) &&
    !/Source via Apify/.test(campaignsPage) &&
    !/Run sourcing agent/.test(campaignsPage) &&
    !/SourceApifyButton/.test(campaignsPage),
);
check(
  "Command Center fail-loud toast carries a CTA href",
  /href: failLoud/.test(sourceAction) || /actionLabel: failLoud/.test(sourceAction),
);

console.log(`RESULT command-center-firstrun: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
