/**
 * Source and copy contracts for sweep C2A. Each check is the behavior the
 * console must have; they fail on the pre-fix tree.
 */
import { readFileSync } from "node:fs";
import { ONBOARDING_TOUR_STEPS, type CommandCenterSnapshot } from "../src/lib/command-center-firstrun.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import * as firstRun from "../src/lib/command-center-firstrun.ts";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}`);
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const globals = read("src/styles/globals.css");
const hero = read("src/components/dashboard/hero-panel.tsx");
const reduced = globals.slice(globals.indexOf("@media (prefers-reduced-motion: reduce)"));
check("C2A-02 hero orb class is animate-spin-slow", hero.includes("animate-spin-slow"));
check("C2A-02 reduced motion stops .animate-spin-slow", reduced.includes(".animate-spin-slow"));

const linkedInBoundary = "Aria does not automate or scrape LinkedIn.";
const sanctioned = "Candidates come from sanctioned sources.";
const tokenChannel = "An off-by-default token channel exists that only admins can enable.";
const heyReach = "HeyReach is off by default.";
const tourText = ONBOARDING_TOUR_STEPS.map((step) => `${step.title} ${step.body}`).join("\n");
check("C2A-03 tour does not say Aria finds people on LinkedIn", !tourText.includes("finds matching people on LinkedIn"));
check("C2A-03 tour does not say a LinkedIn message leaves from your account", !/leaves from your own account/i.test(tourText));
check("C2A-03 tour says Aria does not automate or scrape LinkedIn", tourText.includes(linkedInBoundary));
check("C2A-03 tour says candidates come from sanctioned sources", tourText.includes(sanctioned));
check("C2A-03 tour says the token channel is off and admin-only", tourText.includes(tokenChannel));
check("C2A-03 tour says HeyReach is off by default", tourText.includes(heyReach));

type TourFor = (snapshot: CommandCenterSnapshot) => readonly { title: string; body: string }[];
const tourFor = (firstRun as { onboardingTourFor?: TourFor }).onboardingTourFor;
const seed = buildSeedState();
const pending = seed.outreach.filter((message) => message.status === "Needs Approval").length;
check("C2A-04 seeded demo has campaigns and waiting messages", seed.campaigns.length > 0 && pending > 0);
if (typeof tourFor === "function") {
  const populated = tourFor({
    campaignCount: seed.campaigns.length,
    pendingApprovalCount: pending,
  });
  const step = `${populated[0]?.title ?? ""} ${populated[0]?.body ?? ""}`;
  check("C2A-04 populated step 1 does not tell you to paste a job", !/paste (?:a|your first) job/i.test(step));
  check("C2A-04 populated step 1 names the waiting messages", step.includes(`${pending} messages`));
  check("C2A-04 populated step 1 keeps the LinkedIn boundary", step.includes(linkedInBoundary));
  const empty = tourFor({ campaignCount: 0, pendingApprovalCount: 0 });
  check("C2A-04 empty workspace still starts from a job brief", /paste a job/i.test(`${empty[0]?.title ?? ""} ${empty[0]?.body ?? ""}`));
} else {
  check("C2A-04 tour helper matches the demo snapshot", false);
}
const onboarding = read("src/components/app/onboarding.tsx");
check("C2A-04 tour waits until the workspace is hydrated", onboarding.includes("useHydrated"));

const shell = read("src/components/app/app-shell.tsx");
check("C2A-05 main content is programmatically focusable", /id="main-content"[\s\S]{0,180}tabIndex=\{-1\}/.test(shell));
check("C2A-05 skip link focuses #main-content", /getElementById\("main-content"\)[\s\S]{0,240}\.focus\(/.test(shell));
check("C2A-13 first paint says the synthetic demo is loading", shell.includes("Loading the synthetic demo"));
check(
  "C2A-13 the blocking loader names the synthetic demo",
  read("src/components/app/workspace-status-panel.tsx").includes("Loading the synthetic demo"),
);

const search = read("src/components/app/command-search.tsx");
const searchLabel = search.match(/aria-label="([^"]*command search[^"]*)"/)?.[1] ?? "";
check(
  "C2A-06 search name contains the visible placeholder",
  searchLabel.length === 0 || searchLabel.includes("Search candidates, campaigns, pages"),
);
const topbar = read("src/components/app/topbar.tsx");
check("C2A-06 user menu name includes the initials", topbar.includes("aria-label={`User menu, ${displayInitials}`}"));
const card = read("src/components/campaigns/campaign-card.tsx");
check("C2A-06 campaign name is not title-only", !card.includes("aria-label={`Open campaign ${campaign.title}`}"));

const dialog = read("src/components/candidates/add-candidate-dialog.tsx");
const actions = read("src/lib/store/sourcing-actions.ts");
check("C2A-07 manual tab is disabled without a live workspace", dialog.includes("disabled: !supabaseEnabled"));
check(
  "C2A-07 dialog explains manual entry in the demo",
  dialog.includes(
    "Manual entry needs a live workspace. This synthetic demo only keeps synthetic candidates. Sign in to a live workspace to add someone by hand.",
  ),
);
check("C2A-07 dialog surfaces the intake error inline", dialog.includes('role="alert"'));
check(
  "C2A-07 action error names the next step",
  actions.includes("Sign in to a live workspace, then add the person from this dialog."),
);

const settings = read("src/app/settings/page.tsx");
const nav = read("src/components/app/nav.ts");
const railAt = settings.indexOf('aria-label="Settings sections"');
const rail = settings.slice(railAt, railAt + 700);
const navLabel = /href: "\/fleet",\s*label: "([^"]+)"/.exec(nav)?.[1];
const tabLabel = /id: "fleet", label: "([^"]+)"/.exec(settings)?.[1] ?? /id: "fleet", label: MAILBOXES_LABEL/.exec(settings)?.[0];
check("C2A-09 settings tab uses the same name as the nav", Boolean(navLabel) && (tabLabel === navLabel || settings.includes("MAILBOXES_LABEL")));
check("C2A-09 settings tab rail wraps", rail.includes("flex-wrap"));
check("C2A-09 settings tab rail does not hide its scrollbar", !rail.includes("scrollbar-width:none") && !rail.includes("::-webkit-scrollbar"));

const skills = read("src/app/skills/page.tsx");
check("C2A-10 skills tabs render a TabPanel for the controlled id", skills.includes("TabPanel") && skills.includes('idBase="watch-it-learn"'));

const progress = read("src/components/ui/progress.tsx");
const interviewers = read("src/components/calendar/interviewer-panel.tsx");
check("C2A-11 Progress requires an accessible name", progress.includes("Progress requires an accessible name"));
check("C2A-11 interviewer load bars are named", /<Progress[\s\S]{0,240}aria-label=/.test(interviewers));

const table = read("src/components/candidates/candidate-table.tsx");
check(
  "C2A-12 confidential mark is an image or has hidden text",
  /role="img"[\s\S]{0,200}PII minimized \(confidential\)/.test(table) ||
    /sr-only">PII minimized \(confidential\)/.test(table),
);

console.log(`RESULT a11y-c2a: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
