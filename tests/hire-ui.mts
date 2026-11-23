import { readFileSync } from "node:fs";
import {
  API_SYNCED_LABEL,
  ERP_SKIPPED_LABEL,
  LINKEDIN_COMPLETED_LABEL,
  MCP_SYNCED_LABEL,
  ODOO_SYNCED_LABEL,
  SMART_SYNCED_LABEL,
  buildHireRequest,
  closeMatchingVacancy,
  hireStatusText,
  interpretHireBody,
  localHireCompletes,
  postCandidateHire,
  type HireRequest,
} from "../src/lib/hire-ui";
import { applyHireTrail, buildHireTrail, hireTrailNotes } from "../src/lib/hire-trail";
import type { Activity, Campaign, Candidate, HermesState } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const synthetic = buildHireRequest({
  candidateId: "synthetic-candidate-1",
  candidateName: "Ada Lovelace",
  email: "ada@example.test",
  jobName: "Staff Engineer",
  department: "Engineering",
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function post(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(status, body);
  }) as typeof fetch;
  const outcome = await postCandidateHire(synthetic, fetchImpl);
  return { outcome, calls };
}

function postedBody(calls: { init?: RequestInit }[]): HireRequest {
  return JSON.parse(String(calls[0]?.init?.body)) as HireRequest;
}

const odoo = await post({ ok: true, erp: "odoo", linkedIn: true, steps: [] });
ok(
  "Odoo sync is shown from POST /api/hire",
  odoo.outcome.ok === true &&
    odoo.outcome.outcome === "synced" &&
    odoo.outcome.erp === "odoo" &&
    odoo.outcome.label === ODOO_SYNCED_LABEL &&
    hireStatusText(odoo.outcome) === "Odoo synced" &&
    localHireCompletes(odoo.outcome) &&
    odoo.calls.length === 1 &&
    odoo.calls[0]?.url === "/api/hire" &&
    odoo.calls[0]?.init?.method === "POST",
);
ok(
  "the hire request carries only the synthetic applicant",
  postedBody(odoo.calls).applicant.name === "Ada Lovelace" &&
    postedBody(odoo.calls).applicant.email === "ada@example.test" &&
    postedBody(odoo.calls).job.name === "Staff Engineer" &&
    postedBody(odoo.calls).stage === "Hired" &&
    postedBody(odoo.calls).idempotencyKey === "hire.synthetic-candidate-1",
);

const smart = await post({ ok: true, erp: "smart", linkedIn: true, steps: [] });
ok(
  "SMART sync is shown from POST /api/hire",
  smart.outcome.ok === true &&
    smart.outcome.outcome === "synced" &&
    smart.outcome.erp === "smart" &&
    hireStatusText(smart.outcome) === SMART_SYNCED_LABEL &&
    localHireCompletes(smart.outcome) &&
    smart.calls[0]?.url === "/api/hire",
);

const api = await post({ ok: true, erp: "api", linkedIn: true, steps: [] });
ok(
  "generic API sync is shown from POST /api/hire",
  api.outcome.ok === true &&
    api.outcome.outcome === "synced" &&
    api.outcome.erp === "api" &&
    api.outcome.label === API_SYNCED_LABEL &&
    hireStatusText(api.outcome) === API_SYNCED_LABEL &&
    localHireCompletes(api.outcome) &&
    api.calls[0]?.url === "/api/hire",
);

const mcp = await post({ ok: true, erp: "mcp", linkedIn: true, steps: [] });
ok(
  "MCP sync is shown from POST /api/hire",
  mcp.outcome.ok === true &&
    mcp.outcome.outcome === "synced" &&
    mcp.outcome.erp === "mcp" &&
    hireStatusText(mcp.outcome) === MCP_SYNCED_LABEL &&
    localHireCompletes(mcp.outcome) &&
    mcp.calls[0]?.url === "/api/hire",
);

const skipped = await post({ ok: true, erp: "skipped", linkedIn: true, steps: [] });
ok(
  "a skipped ERP still completes LinkedIn and the local hire",
  skipped.outcome.ok === true &&
    skipped.outcome.outcome === "skipped" &&
    skipped.outcome.linkedIn === true &&
    skipped.outcome.label === ERP_SKIPPED_LABEL &&
    hireStatusText(skipped.outcome) === `${ERP_SKIPPED_LABEL}. ${LINKEDIN_COMPLETED_LABEL}` &&
    localHireCompletes(skipped.outcome) &&
    skipped.calls.length === 1 &&
    skipped.calls[0]?.url === "/api/hire",
);

const secret = "Bearer synthetic-token-value";
const key = "sk-syntheticvalue123456";
const failed = await post(
  { ok: false, erp: "odoo", linkedIn: true, error: `odoo auth failed ${secret} ${key}` },
  502,
);
ok(
  "an ERP error is shown with the secret scrubbed",
  failed.outcome.ok === false &&
    failed.outcome.outcome === "error" &&
    !localHireCompletes(failed.outcome) &&
    failed.outcome.label.includes("odoo auth failed") &&
    failed.outcome.label.includes("Bearer ***") &&
    !failed.outcome.label.includes(secret) &&
    !failed.outcome.label.includes(key) &&
    failed.outcome.label.length <= 200 &&
    hireStatusText(failed.outcome) === failed.outcome.label &&
    failed.calls[0]?.url === "/api/hire",
);

const thrownSecret = "Bearer synthetic-network-token";
const calls: string[] = [];
const thrown = await postCandidateHire(synthetic, (async (url: string) => {
  calls.push(url);
  throw new Error(`network ${thrownSecret}`);
}) as typeof fetch);
ok(
  "a transport failure stays on /api/hire and scrubs the message",
  calls.length === 1 &&
    calls[0] === "/api/hire" &&
    thrown.ok === false &&
    thrown.outcome === "error" &&
    !thrown.label.includes(thrownSecret) &&
    thrown.label.includes("Bearer ***"),
);

const hireUi = readFileSync(new URL("../src/lib/hire-ui.ts", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url), "utf8");
ok(
  "the client posts only to the hire route",
  hireUi.includes('"/api/hire"') &&
    !/process\.env|ODOO_URL|ODOO_API_KEY|SMART_URL|SMART_TOKEN|LINKEDIN_RSC|https?:\/\//.test(hireUi),
);
const recordStart = drawer.indexOf("const recordHire = async");
const recordHired = drawer.indexOf("actions.recordHiredCandidate(candidateIdForHire, trail)", recordStart);
const recordBody = drawer.slice(recordStart, recordHired);
ok(
  "Hire calls the route and records one trail only after it completes",
  recordStart > 0 &&
    recordHired > recordStart &&
    recordBody.includes("await postCandidateHire(") &&
    recordBody.includes("if (!localHireCompletes(outcome))") &&
    recordBody.includes("buildHireTrail(") &&
    !recordBody.includes("setCandidateStage") &&
    drawer.includes("hireStatusText(hireResult)") &&
    drawer.includes("data-hire-outcome={hireResult.outcome}") &&
    drawer.includes("data-hire-trail") &&
    drawer.includes('void recordHire()'),
);
const vacancies = [
  { id: "need-a", status: "Interviewing", title: "Need Alpha" },
  { id: "need-b", status: "Sourcing", title: "Need Beta" },
];
const closed = closeMatchingVacancy(vacancies, "need-a");
ok(
  "one hire closes that vacancy and leaves a different vacancy open",
  closed[0]?.status === "Filled" &&
    closed[0]?.title === "Need Alpha" &&
    closed[1]?.status === "Sourcing" &&
    closed[1]?.id === "need-b" &&
    vacancies[0]?.status === "Interviewing",
);
ok(
  "the drawer closes the hired vacancy in the one trail write",
  !drawer.includes("Consider marking") &&
    drawer.includes("closeMatchingVacancy") &&
    drawer.includes("recordHiredCandidate") &&
    !drawer.includes("updateCampaign") &&
    drawer.includes('data-vacancy-status="filled"') &&
    drawer.includes("is filled and closed."),
);

const odooBody = interpretHireBody({
  ok: true,
  erp: "odoo",
  linkedIn: true,
  steps: [
    { action: "job", ok: true, id: "11", model: "hr.job" },
    { action: "applicant", ok: false, id: "99" },
    { action: "applicant", ok: true, id: "12", model: "hr.applicant" },
    { action: "stage", ok: true, id: "12" },
    { action: "hire", ok: true, id: "12" },
    { action: "close", ok: true, id: "11" },
  ],
});
const odooTrail = odooBody.ok
  ? buildHireTrail({
      who: "  Operator  ",
      when: "2026-11-23T20:00:00.000Z",
      need: "Senior Backend Engineer",
      erp: odooBody.erp,
      stageFrom: "Offer",
      stageTo: "Hired",
      steps: odooBody.steps,
      vacancyClosed: odooBody.vacancyClosed,
    })
  : null;
ok(
  "an Odoo hire keeps the ids, stage change, and vacancy close already in the response",
  odooTrail?.who === "Operator" &&
    odooTrail.when === "2026-11-23T20:00:00.000Z" &&
    odooTrail.need === "Senior Backend Engineer" &&
    odooTrail.odooJobId === "11" &&
    odooTrail.odooApplicantId === "12" &&
    odooTrail.stageFrom === "Offer" &&
    odooTrail.stageTo === "Hired" &&
    odooTrail.vacancyClosed === true &&
    hireTrailNotes(odooTrail).includes("Odoo job: 11") &&
    hireTrailNotes(odooTrail).includes("Odoo applicant: 12") &&
    hireTrailNotes(odooTrail).includes("Stage: Offer → Hired") &&
    hireTrailNotes(odooTrail).includes("Vacancy: closed"),
);

const openBody = interpretHireBody({
  ok: true,
  erp: "odoo",
  linkedIn: true,
  vacancyClosed: false,
  steps: [
    { action: "job", ok: true, id: "11" },
    { action: "applicant", ok: true, id: "12" },
    { action: "stage", ok: true, id: "12" },
    { action: "hire", ok: true, id: "12" },
  ],
});
const openTrail = openBody.ok
  ? buildHireTrail({
      who: "Operator",
      when: "2026-11-23T20:00:00.000Z",
      need: "Senior Backend Engineer",
      erp: "odoo",
      stageFrom: "Offer",
      stageTo: "Hired",
      steps: openBody.steps,
      vacancyClosed: openBody.vacancyClosed,
    })
  : null;
ok("a hire write without a close step leaves the vacancy open", openTrail?.vacancyClosed === false && openTrail.odooJobId === "11");

const positional = interpretHireBody({
  ok: true,
  erp: "odoo",
  linkedIn: true,
  steps: [
    { action: "job", ok: true, id: "11", model: "hr.job" },
    { action: "applicant", ok: true, id: "12", model: "hr.applicant" },
    { action: "stage", ok: true, skipped: true, reason: "Hired stage id is not configured." },
    { action: "hire", ok: true, id: "11", model: "hr.job" },
  ],
});
const positionalTrail = positional.ok
  ? buildHireTrail({
      who: "Operator",
      when: "2026-11-23T20:00:00.000Z",
      need: "Senior Backend Engineer",
      erp: "odoo",
      stageFrom: "Offer",
      stageTo: "Hired",
      steps: positional.steps,
      vacancyClosed: positional.vacancyClosed,
    })
  : null;
ok(
  "the Odoo job hire write is the vacancy close and keeps both ids",
  positional.ok === true &&
    positional.vacancyClosed === true &&
    positionalTrail?.odooJobId === "11" &&
    positionalTrail.odooApplicantId === "12" &&
    positionalTrail.vacancyClosed === true &&
    hireTrailNotes(positionalTrail).includes("Odoo stage: not written") &&
    !hireTrailNotes(positionalTrail).includes("skipped"),
);

const flagged = interpretHireBody({
  ok: true,
  erp: "odoo",
  linkedIn: true,
  vacancyClosed: true,
  steps: [{ action: "hire", ok: true, id: "12" }],
});
ok("an explicit vacancyClosed flag is kept without another request", flagged.ok === true && flagged.vacancyClosed === true);

const smartBody = interpretHireBody({
  ok: true,
  erp: "smart",
  linkedIn: true,
  steps: [{ action: "job", ok: true, id: "smart-job" }],
});
const smartTrail = smartBody.ok
  ? buildHireTrail({
      who: "",
      when: "2026-11-23T20:00:00.000Z",
      need: "  ",
      erp: "smart",
      stageFrom: "Offer",
      stageTo: "Hired",
      steps: smartBody.steps,
      vacancyClosed: smartBody.vacancyClosed,
    })
  : null;
ok(
  "a non-Odoo hire does not label its ids as Odoo",
  smartTrail?.odooJobId === undefined &&
    smartTrail?.odooApplicantId === undefined &&
    smartTrail?.who === "Operator" &&
    smartTrail.need === "Open role" &&
    !hireTrailNotes(smartTrail).includes("Odoo"),
);

function workspace(): HermesState {
  const candidate = {
    id: "cand-1",
    name: "Ada Lovelace",
    campaignId: "camp-1",
    stage: "Offer",
    maxStageRank: 6,
    recentActivity: "Interview booked.",
  } as Candidate;
  const campaign = {
    id: "camp-1",
    status: "Interviewing",
    activities: [] as Activity[],
  } as Campaign;
  return { candidates: [candidate], campaigns: [campaign], activities: [] } as unknown as HermesState;
}

const recorded = applyHireTrail(workspace(), {
  candidateId: "cand-1",
  activityId: "act-1",
  trail: odooTrail!,
});
const hireActivity = recorded.activities[0];
ok(
  "one hire writes one activity, the stage, and the closed vacancy",
  recorded.activities.length === 1 &&
    recorded.campaigns[0]?.activities.length === 1 &&
    recorded.campaigns[0]?.activities[0] === hireActivity &&
    hireActivity?.linkedEntityType === "candidate" &&
    hireActivity.linkedEntityId === "cand-1" &&
    hireActivity.campaignId === "camp-1" &&
    hireActivity.createdAt === "2026-11-23T20:00:00.000Z" &&
    hireActivity.outcome === "Hired, vacancy closed" &&
    recorded.candidates[0]?.stage === "Hired" &&
    recorded.candidates[0]?.maxStageRank === 7 &&
    recorded.candidates[0]?.recentActivity === "Hired by Operator for Senior Backend Engineer." &&
    recorded.campaigns[0]?.status === "Filled",
);
const again = applyHireTrail(recorded, { candidateId: "cand-1", activityId: "act-2", trail: odooTrail! });
ok("recording the same trail again does not write a second activity", again === recorded);

const leftOpen = applyHireTrail(workspace(), {
  candidateId: "cand-1",
  activityId: "act-open",
  trail: openTrail!,
});
ok(
  "an open vacancy stays on the current campaign status",
  leftOpen.campaigns[0]?.status === "Interviewing" && leftOpen.activities[0]?.outcome === "Hired",
);
ok("a missing candidate does not write a trail", applyHireTrail(workspace(), { candidateId: "missing", activityId: "act-x", trail: openTrail! }).activities.length === 0);

const trailLib = readFileSync(new URL("../src/lib/hire-trail.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const recordAction = store.slice(store.indexOf("const recordHiredCandidate"), store.indexOf("const setCandidatePhone"));
ok(
  "the trail is one local commit and does not call a connector",
  !/fetch\s*\(|execute_kw|ODOO_|SMART_|HIRE_API|HIRE_MCP/.test(trailLib) &&
    recordAction.includes("commit(") &&
    recordAction.includes("applyHireTrail") &&
    !recordAction.includes("logActivity") &&
    !recordAction.includes("addCandidateNote") &&
    !recordAction.includes("setCandidateStage"),
);

console.log(`RESULT hire-ui: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
