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
  localHireCompletes,
  postCandidateHire,
  type HireRequest,
} from "../src/lib/hire-ui";

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
const recordHired = drawer.indexOf('actions.setCandidateStage(candidateIdForHire, "Hired")', recordStart);
const recordBody = drawer.slice(recordStart, recordHired);
ok(
  "Hire calls the route and advances the checklist only after it completes",
  recordStart > 0 &&
    recordHired > recordStart &&
    recordBody.includes("await postCandidateHire(") &&
    recordBody.includes("if (!localHireCompletes(outcome))") &&
    !recordBody.includes("setCandidateStage") &&
    drawer.includes("hireStatusText(hireResult)") &&
    drawer.includes("data-hire-outcome={hireResult.outcome}") &&
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
  "the drawer closes the hired vacancy and does not ask to mark it filled",
  !drawer.includes("Consider marking") &&
    drawer.includes("closeMatchingVacancy") &&
    drawer.includes('status: "Filled"') &&
    drawer.includes('data-vacancy-status="filled"') &&
    drawer.includes("is filled and closed."),
);

console.log(`RESULT hire-ui: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
