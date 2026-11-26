import { readFileSync } from "node:fs";
import net from "node:net";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateStage } from "../src/lib/types";

let socketOpens = 0;
function refuseSocket(): never {
  socketOpens += 1;
  throw new Error("socket open");
}
net.Socket.prototype.connect = refuseSocket as typeof net.Socket.prototype.connect;
net.connect = refuseSocket as typeof net.connect;
net.createConnection = refuseSocket as typeof net.createConnection;
globalThis.fetch = refuseSocket as typeof fetch;

const { CommandHireEmployeeId, commandHireEmployeeId } = await import(
  "../src/components/hire/command-hire-employee-id.tsx"
);
const { SourcingHirePanel } = await import("../src/components/hire/sourcing-hire-panel.tsx");
const { CANDIDATE_STAGES } = await import("../src/lib/types.ts");
const { createEmployeeForStage, FakeOdooEmployeeClient } = await import("../src/lib/hire-employee.ts");
const { storeHiredEmployeeId } = await import("../src/lib/candidate-list-hire.ts");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function markup(
  candidate: { stage: CandidateStage; odooEmployeeId?: number } | null,
  result?: { ok?: boolean; erp?: string; transport?: string } | null,
) {
  return renderToStaticMarkup(createElement(CommandHireEmployeeId, { candidate, result }));
}

const created = await createEmployeeForStage(
  "Hired",
  { applicantId: "command-1", name: "Fixture Candidate North" },
  new FakeOdooEmployeeClient(),
);
const saved = storeHiredEmployeeId({ stage: "Hired" }, created.employeeId);
const hiredMarkup = markup(saved);
ok(
  "a successful in-memory hire shows its employee id on the command center hire result",
  created.employeeId === 1 &&
    saved.odooEmployeeId === 1 &&
    commandHireEmployeeId(saved) === 1 &&
    hiredMarkup.includes("Employee 1") &&
    hiredMarkup.includes('data-testid="command-hire-employee-id"'),
);

const hiredWithoutId = markup({ stage: "Hired" });
ok("a hired candidate with no returned employee id shows no employee id", hiredWithoutId === "");

for (const stage of CANDIDATE_STAGES) {
  if (stage === "Hired") continue;
  const html = markup({ stage, odooEmployeeId: 7 });
  ok(
    `a ${stage} candidate shows no employee id`,
    html === "" && !html.includes("Employee") && !html.includes("command-hire-employee-id") && !html.includes("7"),
  );
}

for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const html = markup({ stage: "Hired", odooEmployeeId: id });
  ok(`a returned id of ${id} is not shown`, html === "" && commandHireEmployeeId({ stage: "Hired", odooEmployeeId: id }) === null);
}

const skippedStage = await createEmployeeForStage(
  "Offer",
  { applicantId: "command-2", name: "Fixture Candidate North" },
  new FakeOdooEmployeeClient(),
);
const skippedRow = storeHiredEmployeeId({ stage: "Offer" }, skippedStage.employeeId);
ok(
  "a skipped hire shows no employee id",
  skippedStage.employeeId === null &&
    skippedRow.odooEmployeeId == null &&
    markup(skippedRow) === "" &&
    markup(saved, { ok: true, erp: "skipped" }) === "",
);

const unconfigured = await createEmployeeForStage(
  "Hired",
  { applicantId: "command-3", name: "Fixture Candidate North" },
  null,
);
const unconfiguredRow = storeHiredEmployeeId({ stage: "Hired" }, unconfigured.employeeId);
ok(
  "a hire with no client shows no employee id",
  unconfigured.employeeId === null && unconfiguredRow.odooEmployeeId == null && markup(unconfiguredRow) === "",
);

const failed = await createEmployeeForStage(
  "Hired",
  { applicantId: "command-4", name: "Fixture Candidate North" },
  {
    async findByApplicant() {
      return null;
    },
    async create() {
      throw new Error("create failed");
    },
  },
);
const failedRow = storeHiredEmployeeId({ stage: "Hired" }, failed.employeeId);
ok(
  "a failed hire shows no employee id",
  failed.employeeId === null &&
    failedRow.odooEmployeeId == null &&
    markup(failedRow) === "" &&
    markup(saved, { ok: false, erp: "odoo", transport: "live" }) === "",
);

const fixtureMarkup = markup(saved, { ok: true, erp: "skipped", transport: "fixture" });
ok(
  "a successful fixture hire result shows the employee id the in-memory hire returned",
  fixtureMarkup.includes("Employee 1") && commandHireEmployeeId(saved, { ok: true, erp: "skipped", transport: "fixture" }) === 1,
);

const panelMarkup = renderToStaticMarkup(
  createElement(SourcingHirePanel, {
    screen: "command",
    label: "Command center hire",
    candidate: {
      id: "command-1",
      name: "Fixture Candidate North",
      jobName: "Fixture Platform Role",
    },
    storedHire: saved,
  }),
);
const otherScreen = renderToStaticMarkup(
  createElement(SourcingHirePanel, {
    screen: "search",
    label: "Search hire",
    candidate: {
      id: "command-1",
      name: "Fixture Candidate North",
      jobName: "Fixture Platform Role",
    },
    storedHire: saved,
  }),
);
ok(
  "the command center hire panel shows the id and does not put it on the candidate name",
  panelMarkup.includes('data-testid="command-hire-employee-id"') &&
    panelMarkup.includes("Employee 1") &&
    panelMarkup.includes("Fixture Candidate North · Fixture Platform Role") &&
    panelMarkup.indexOf("Fixture Candidate North · Fixture Platform Role") < panelMarkup.indexOf("Employee 1") &&
    !otherScreen.includes("command-hire-employee-id") &&
    !otherScreen.includes("Employee 1"),
);

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/hire/sourcing-hire-panel.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/hire/command-hire-employee-id.tsx", import.meta.url),
  "utf8",
);
const nameLine = panel.slice(panel.indexOf("${candidate.name}"), panel.indexOf("Hire into ERP"));
const resultLine = panel.slice(panel.indexOf("Hire into ERP"));
ok(
  "the command center passes the in-memory hire into the hire result and nowhere else",
  page.includes("stage: commandCandidate.stage") &&
    page.includes("odooEmployeeId: commandCandidate.odooEmployeeId") &&
    page.includes("storedHire={") &&
    !nameLine.includes("CommandHireEmployeeId") &&
    !nameLine.includes("employeeId") &&
    resultLine.includes("<CommandHireEmployeeId candidate={storedHire} result={result} />") &&
    resultLine.includes("screen === \"command\"") &&
    panel.includes("commandHireEmployeeId(storedHire, result)") &&
    panel.includes("employeeId == null ? shownBase : { ...shownBase, employeeId }") &&
    !panel.includes("createEmployee") &&
    !panel.includes("storeHiredEmployeeId") &&
    component.includes("candidateListHire(candidate)") &&
    component.includes("hire.employeeId") &&
    !component.includes("fetch(") &&
    !component.includes("createEmployee") &&
    !component.includes("storeHiredEmployeeId") &&
    !component.includes("net.") &&
    !/\bhttps?:\/\//.test(component) &&
    socketOpens === 0,
);

console.log(`RESULT command-hire-employee-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
