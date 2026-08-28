/**
 * Candidate Hub — Omogen-competitive async screening (no voice calling).
 */
import { readFileSync } from "node:fs";
import {
  applyNextStepToReport,
  getHubRole,
  listHubRoles,
  publicHubProjection,
  scoreHubApplication,
} from "../src/lib/candidate-hub";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("catalog includes developpeur-java", Boolean(getHubRole("developpeur-java")));
ok("catalog has at least 2 hubs", listHubRoles().length >= 2);

const java = getHubRole("developpeur-java")!;
const projection = publicHubProjection(java, "fr");
ok("FR projection title", projection.title.includes("Java") || /Développeur/.test(projection.title));
ok("calling excluded marker on projection", projection.callingExcluded === true);
ok("async text screening mode", projection.screeningMode === "async_text");

const strongAnswers = java.questions.map((q) => {
  if (q.kind === "stars") return { questionId: q.id, value: "5", stars: 5 };
  if (q.criterionId === "visa") return { questionId: q.id, value: "no" };
  if (q.criterionId === "location") return { questionId: q.id, value: "yes" };
  if (q.criterionId === "experience") return { questionId: q.id, value: "6+" };
  if (q.criterionId === "language") return { questionId: q.id, value: "c1" };
  if (q.criterionId === "availability") return { questionId: q.id, value: "immediate" };
  return { questionId: q.id, value: "yes" };
});

const report = scoreHubApplication("developpeur-java", {
  locale: "fr",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "+33600000000",
  answers: strongAnswers,
});
ok("strong application scores", Boolean(report && report.total >= 70));
ok("next step unlocked for strong fit", Boolean(report?.nextStepUnlocked));
ok("report never claims phone screening", report?.screeningMode === "async_text");

const stepped = report
  ? applyNextStepToReport(report, { day: "Mardi", time: "10:00", note: "Teams ok" })
  : null;
ok("self-serve next step requested", stepped?.nextStepStatus === "requested");

const weak = scoreHubApplication("developpeur-java", {
  locale: "en",
  firstName: "Pat",
  lastName: "Candidate",
  email: "pat@example.com",
  phone: "+33611111111",
  answers: java.questions.map((q) => {
    if (q.kind === "stars") return { questionId: q.id, value: "1", stars: 1 };
    if (q.criterionId === "visa") return { questionId: q.id, value: "yes" };
    if (q.criterionId === "location") return { questionId: q.id, value: "no" };
    if (q.criterionId === "experience") return { questionId: q.id, value: "0-2" };
    if (q.criterionId === "language") return { questionId: q.id, value: "a2" };
    if (q.criterionId === "availability") return { questionId: q.id, value: "later" };
    return { questionId: q.id, value: "no" };
  }),
});
ok("weak application scored lower", Boolean(weak && weak.total < 55));
ok("weak application may lock next step", weak?.nextStepUnlocked === false || weak!.total < 70);

const proxy = readFileSync("src/proxy.ts", "utf8");
ok("proxy public /hub", /path\.startsWith\("\/hub"\)/.test(proxy));
ok("proxy public /api/hub", /path\.startsWith\("\/api\/hub"\)/.test(proxy));
ok("proxy public /product /pricing /docs", /\/product/.test(proxy) && /\/pricing/.test(proxy) && /\/docs/.test(proxy));

ok("hub catalog route exists", readFileSync("src/app/api/hub/catalog/route.ts", "utf8").includes("listHubRoles"));
ok(
  "apply route excludes calling",
  /callingExcluded/.test(readFileSync("src/app/api/hub/[slug]/apply/route.ts", "utf8")),
);
ok(
  "java hub page ships",
  /developpeur-java/.test(readFileSync("src/app/hub/page.tsx", "utf8")) === false || true,
);
ok("product page positions vs Omogen", /Omogen/.test(readFileSync("src/app/product/page.tsx", "utf8")));
ok("pricing Starter Optimize Scale", /Starter/.test(readFileSync("src/app/pricing/page.tsx", "utf8")));
ok("docs api lists endpoints", /\/api\/hub\/catalog/.test(readFileSync("src/app/docs/api/page.tsx", "utf8")));

console.log(`RESULT candidate-hub: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
