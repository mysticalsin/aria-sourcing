import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateListHireStatus } from "../src/components/candidates/candidate-list-hire";
import { candidateListHire } from "../src/lib/candidate-list-hire";

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

const list = readFileSync(new URL("../src/lib/candidate-list-hire.ts", import.meta.url), "utf8");
const table = readFileSync(new URL("../src/components/candidates/candidate-table.tsx", import.meta.url), "utf8");
ok(
  "the candidate list reads the in-memory row and does not call the network",
  table.includes("CandidateListHireStatus") && !list.includes("fetch(") && !/\bhttps?:\/\//.test(list),
);

console.log(`RESULT candidate-list-hire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
