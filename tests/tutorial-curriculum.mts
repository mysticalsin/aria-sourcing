// Tutorial mode: the curriculum stays in step with the pages it teaches.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  TUTORIAL_CHAPTERS,
  chapterProgress,
  isOnStepRoute,
  nextPosition,
  previousPosition,
  resumePosition,
  routeLocation,
  stepAt,
  tutorialCounts,
  type TutorialCounts,
} from "../src/lib/tutorial/curriculum.js";
import { buildSeedState } from "../src/lib/seed.js";

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

const steps = TUTORIAL_CHAPTERS.flatMap((c) => c.steps);

/* ---- Content ------------------------------------------------------------- */

ok("five chapters", TUTORIAL_CHAPTERS.length === 5);
ok("step ids are unique", new Set(steps.map((s) => s.id)).size === steps.length);
ok("chapter ids are unique", new Set(TUTORIAL_CHAPTERS.map((c) => c.id)).size === TUTORIAL_CHAPTERS.length);
ok(
  "every step explains itself in a few sentences",
  steps.every((s) => s.title.length > 3 && s.body.length >= 60 && s.body.length <= 360),
);
ok("every chapter has a summary and a time estimate", TUTORIAL_CHAPTERS.every((c) => c.summary && c.minutes > 0));
ok("a step that checks completion also says what happened", steps.every((s) => !s.done || Boolean(s.doneText)));
ok("a step that checks completion gives an exercise", steps.every((s) => !s.done || Boolean(s.tryIt)));
const retired = /\b(TAnIA|Top Gun|A Player|TOFU|MOFU|#Vivier|Path [AB]|Winlog|Intake page|Launch page)\b/;
ok("copy uses the current vocabulary", steps.every((s) => !retired.test(`${s.title} ${s.body} ${s.tryIt ?? ""}`)));

/* ---- Routes and targets exist ------------------------------------------- */

function pageExists(pathname: string): boolean {
  if (pathname === "/") return existsSync("src/app/page.tsx");
  let dir = "src/app";
  for (const segment of pathname.split("/").filter(Boolean)) {
    if (existsSync(join(dir, segment))) dir = join(dir, segment);
    else {
      const dynamic = readdirSync(dir).find((d) => d.startsWith("[") && statSync(join(dir, d)).isDirectory());
      if (!dynamic) return false;
      dir = join(dir, dynamic);
    }
  }
  return existsSync(join(dir, "page.tsx"));
}
ok("every step route is a real page", steps.every((s) => pageExists(routeLocation(s.route).pathname)));
const seed = buildSeedState();
ok(
  "campaign steps point at a seeded campaign",
  steps.every((s) => {
    const m = routeLocation(s.route).pathname.match(/^\/campaigns\/(camp_[\w-]+)$/);
    return !m || seed.campaigns.some((c) => c.id === m[1]);
  }),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
const source = sourceFiles("src").map((f) => readFileSync(f, "utf8")).join("\n");
const settingsPage = readFileSync("src/app/settings/page.tsx", "utf8");

function targetExists(selector: string): boolean {
  const tour = selector.match(/^\[data-tour="([\w-]+)"\]$/);
  if (tour) return source.includes(`data-tour="${tour[1]}"`);
  const label = selector.match(/^nav\[aria-label="([^"]+)"\]$/);
  if (label) return source.includes(`aria-label="${label[1]}"`);
  const section = selector.match(/^#settings-section-(\d+)$/);
  if (section) return settingsPage.includes(`n="${section[1]}"`);
  return false;
}
const missing = steps.flatMap((s) => (s.target ?? []).filter((t) => !targetExists(t)).map((t) => `${s.id}: ${t}`));
ok(`every highlighted area exists in the pages${missing.length ? ` (missing ${missing.join(", ")})` : ""}`, missing.length === 0);
ok(
  "settings steps open the section they highlight",
  steps.filter((s) => s.route.startsWith("/settings#")).every((s) => s.target?.[0] === `#${s.route.split("#")[1]}`),
);

/* ---- Navigation ---------------------------------------------------------- */

ok("starts at the first step", stepAt({ chapter: 0, step: 0 })?.id === steps[0].id);
ok("next stays inside a chapter", nextPosition({ chapter: 0, step: 0 })?.step === 1);
const lastOfFirst = TUTORIAL_CHAPTERS[0].steps.length - 1;
ok("next crosses into the following chapter", JSON.stringify(nextPosition({ chapter: 0, step: lastOfFirst })) === '{"chapter":1,"step":0}');
const last = { chapter: TUTORIAL_CHAPTERS.length - 1, step: TUTORIAL_CHAPTERS.at(-1)!.steps.length - 1 };
ok("there is nothing after the last step", nextPosition(last) === null);
ok("back crosses into the previous chapter", JSON.stringify(previousPosition({ chapter: 1, step: 0 })) === JSON.stringify({ chapter: 0, step: lastOfFirst }));
ok("there is nothing before the first step", previousPosition({ chapter: 0, step: 0 }) === null);

const doneFirstChapter = new Set(TUTORIAL_CHAPTERS[0].steps.map((s) => s.id));
ok("progress counts finished steps", chapterProgress(0, doneFirstChapter).done === TUTORIAL_CHAPTERS[0].steps.length);
ok("continue lands on the first unfinished step", JSON.stringify(resumePosition(doneFirstChapter)) === '{"chapter":1,"step":0}');
ok("continue is empty once everything is done", resumePosition(new Set(steps.map((s) => s.id))) === null);

const several = steps.find((s) => s.id === "campaign-several")!;
ok("a route with a query needs that query", !isOnStepRoute(several, "/campaigns/new", ""));
ok("a route with a query matches it", isOnStepRoute(several, "/campaigns/new", "?roles=several"));
const settingsStep = steps.find((s) => s.id === "control-ai")!;
ok("the hash does not decide the page", isOnStepRoute(settingsStep, "/settings", "?tab=ai"));

/* ---- Completion checks --------------------------------------------------- */

const base = tutorialCounts(seed);
ok("seed counts are readable", base.campaigns > 0 && base.outreach > 0);
const bump = (patch: Partial<TutorialCounts>): TutorialCounts => ({ ...base, ...patch });
const step = (id: string) => steps.find((s) => s.id === id)!;
ok("nothing is done when nothing changed", steps.every((s) => !s.done || !s.done(base, base)));
ok("creating a campaign completes that step", step("campaign-create").done!(bump({ campaigns: base.campaigns + 1 }), base));
ok("one campaign is not a multi-role launch", !step("campaign-several").done!(bump({ campaigns: base.campaigns + 1 }), base));
ok("approving a draft completes that step", step("engage-approve").done!(bump({ approved: base.approved + 1 }), base));
ok("recording a contact basis completes that step", step("engage-basis").done!(bump({ contactBasis: base.contactBasis + 1 }), base));
ok("the basis step comes right before approval", steps.findIndex((s) => s.id === "engage-basis") + 1 === steps.findIndex((s) => s.id === "engage-approve"));
ok("a reply draft completes the triage step", step("engage-replies").done!(bump({ replyDrafts: base.replyDrafts + 1 }), base));

/* ---- Opened from the menu only ------------------------------------------ */

const panel = readFileSync("src/components/tutorial/tutorial.tsx", "utf8");
ok("the tutorial starts closed for a new visitor", /const CLOSED: TutorialMemory = \{\s*open: false,/.test(panel));
ok("only an explicit action opens it", (panel.match(/open: true/g) ?? []).length === 2 && panel.includes("const openTutorial = React.useCallback"));
const sidebar = readFileSync("src/components/app/sidebar.tsx", "utf8");
const topbar = readFileSync("src/components/app/topbar.tsx", "utf8");
const search = readFileSync("src/components/app/command-search.tsx", "utf8");
ok("the sidebar has a Tutorial entry", sidebar.includes("onClick={tutorial.openTutorial}") && sidebar.includes(">Tutorial<"));
ok("the mobile menu has a Tutorial entry", topbar.includes("tutorial.openTutorial()") && topbar.includes(">Tutorial<"));
ok("the command search finds the tutorial", search.includes('label: "Tutorial"') && search.includes("tutorial.openTutorial()"));
ok("the welcome modal stays away while the tutorial is open", readFileSync("src/components/app/onboarding.tsx", "utf8").includes('pathname !== "/" || tutorial.open'));

console.log(`RESULT tutorial-curriculum: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
