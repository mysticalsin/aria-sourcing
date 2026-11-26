import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateListHireStatus } from "../src/components/candidates/candidate-list-hire";
import { candidateListHire, storeHiredEmployeeId } from "../src/lib/candidate-list-hire";
import { createEmployeeForStage, FakeOdooEmployeeClient, type OdooEmployeeClient } from "../src/lib/hire-employee";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const hired = { stage: "Hired" as const, odooEmployeeId: 7 };
const shown = candidateListHire(hired);
const hiredMarkup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: hired }));
ok(
  "the candidate list shows a hired candidate as hired and shows the stored employee id",
  shown.hired === true &&
    shown.employeeId === 7 &&
    hiredMarkup.includes("Hired") &&
    hiredMarkup.includes("Employee 7") &&
    hiredMarkup.includes('data-testid="candidate-employee-id"'),
);

const hiredWithoutId = { stage: "Hired" as const };
const missing = candidateListHire(hiredWithoutId);
const missingMarkup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: hiredWithoutId }));
ok(
  "a hired candidate with no stored employee id is still hired",
  missing.hired === true &&
    missing.employeeId === null &&
    missingMarkup.includes("Hired") &&
    !missingMarkup.includes("candidate-employee-id"),
);

const offer = { stage: "Offer" as const, odooEmployeeId: 7 };
const notHired = candidateListHire(offer);
const offerMarkup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: offer }));
ok(
  "a candidate who is not hired is not shown as hired and shows no employee id",
  notHired.hired === false &&
    notHired.employeeId === null &&
    offerMarkup.includes("Offer") &&
    !offerMarkup.includes("Hired") &&
    !offerMarkup.includes("candidate-employee-id") &&
    !offerMarkup.includes("Employee 7"),
);

for (const id of [0, -3, 1.5, Number.NaN]) {
  const invalid = candidateListHire({ stage: "Hired", odooEmployeeId: id });
  ok(`a stored id of ${id} is not shown`, invalid.hired === true && invalid.employeeId === null);
}

const memory = new FakeOdooEmployeeClient();
const created = await createEmployeeForStage(
  "Hired",
  { applicantId: "42", name: "Fixture Candidate North" },
  memory,
);
const saved = storeHiredEmployeeId({ stage: "Hired" }, created.employeeId);
const savedShown = candidateListHire(saved);
const savedMarkup = renderToStaticMarkup(createElement(CandidateListHireStatus, { candidate: saved }));
ok(
  "a successful in-memory hire stores the employee id the list shows",
  created.employeeId === 1 &&
    memory.createCount === 1 &&
    memory.findCount === 1 &&
    memory.employees.length === 1 &&
    saved.odooEmployeeId === 1 &&
    savedShown.hired === true &&
    savedShown.employeeId === 1 &&
    savedMarkup.includes("Hired") &&
    savedMarkup.includes("Employee 1") &&
    savedMarkup.includes('data-testid="candidate-employee-id"'),
);

const replay = await createEmployeeForStage(
  "Hired",
  { applicantId: "42", name: "Fixture Candidate North" },
  memory,
);
const savedAgain = storeHiredEmployeeId(saved, replay.employeeId);
ok(
  "hiring the same applicant again keeps the same stored employee id",
  replay.employeeId === 1 &&
    savedAgain === saved &&
    savedAgain.odooEmployeeId === 1 &&
    memory.createCount === 1 &&
    memory.employees.length === 1,
);

const offerClient = new FakeOdooEmployeeClient();
const offerResult = await createEmployeeForStage(
  "Offer",
  { applicantId: "42", name: "Fixture Candidate North" },
  offerClient,
);
const offerRow = storeHiredEmployeeId({ stage: "Offer" }, offerResult.employeeId);
ok(
  "a stage other than Hired stores no employee id and does not call the client",
  offerResult.employeeId === null &&
    offerRow.odooEmployeeId == null &&
    offerClient.findCount === 0 &&
    offerClient.createCount === 0 &&
    offerClient.employees.length === 0,
);

const unconfigured = await createEmployeeForStage(
  "Hired",
  { applicantId: "42", name: "Fixture Candidate North" },
  null,
);
const kept = storeHiredEmployeeId({ stage: "Hired", odooEmployeeId: 4 }, unconfigured.employeeId);
ok(
  "a hire with no client leaves the stored employee id untouched",
  unconfigured.employeeId === null && kept.odooEmployeeId === 4,
);

const failing: OdooEmployeeClient = {
  async findByApplicant() {
    return null;
  },
  async create() {
    throw new Error("create failed");
  },
};
const failed = await createEmployeeForStage(
  "Hired",
  { applicantId: "42", name: "Fixture Candidate North" },
  failing,
);
const failedRow = storeHiredEmployeeId({ stage: "Hired" }, failed.employeeId);
ok(
  "a failed in-memory hire stores no employee id",
  failed.employeeId === null && failedRow.odooEmployeeId == null,
);

const list = readFileSync(new URL("../src/lib/candidate-list-hire.ts", import.meta.url), "utf8");
const table = readFileSync(new URL("../src/components/candidates/candidate-table.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const stageFn = store.slice(store.indexOf("const setCandidateStage"), store.indexOf("const setCandidatePhone"));
ok(
  "the candidate list reads the in-memory row and does not call the network",
  table.includes("CandidateListHireStatus") && !list.includes("fetch(") && !/\bhttps?:\/\//.test(list),
);
ok(
  "setCandidateStage writes the hire employee id onto the candidate and does not call the network",
  /createEmployeeForStage\(stage, \{ applicantId: id, name \}, client\)[\s\S]*storeHiredEmployeeId\(c, employeeId\)/.test(stageFn) &&
    !stageFn.includes("fetch(") &&
    !/\bhttps?:\/\//.test(stageFn),
);

console.log(`RESULT candidate-list-hire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
