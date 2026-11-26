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

const { CandidateDrawerEmployeeId } = await import("../src/components/candidates/candidate-drawer-employee.tsx");
const { CANDIDATE_STAGES } = await import("../src/lib/types.ts");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function markup(candidate: { stage: CandidateStage; odooEmployeeId?: number }) {
  return renderToStaticMarkup(createElement(CandidateDrawerEmployeeId, { candidate }));
}

const hired = { stage: "Hired" as const, odooEmployeeId: 7 };
const hiredMarkup = markup(hired);
ok(
  "the candidate drawer shows a hired candidate's stored employee id",
  hiredMarkup.includes("Employee 7") && hiredMarkup.includes('data-testid="drawer-employee-id"'),
);

const hiredWithoutId = markup({ stage: "Hired" });
ok("a hired candidate with no stored employee id shows no employee id", hiredWithoutId === "");

for (const stage of CANDIDATE_STAGES) {
  if (stage === "Hired") continue;
  const html = markup({ stage, odooEmployeeId: 7 });
  ok(
    `a ${stage} candidate shows no employee id`,
    html === "" && !html.includes("Employee") && !html.includes("drawer-employee-id") && !html.includes("7"),
  );
}

for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const html = markup({ stage: "Hired", odooEmployeeId: id });
  ok(`a stored id of ${id} is not shown in the drawer`, html === "");
}

const drawer = readFileSync(new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/candidates/candidate-drawer-employee.tsx", import.meta.url),
  "utf8",
);
const stagePanel = drawer.slice(drawer.indexOf('title="Interview stage"'), drawer.indexOf("<SourcingHirePanel"));
ok(
  "the candidate drawer stage panel renders the stored employee id from the in-memory candidate",
  stagePanel.includes("<CandidateDrawerEmployeeId candidate={c} />") &&
    component.includes("candidateListHire(candidate)") &&
    component.includes("hire.employeeId") &&
    !component.includes("fetch(") &&
    !component.includes("createEmployee") &&
    !component.includes("net.") &&
    !/\bhttps?:\/\//.test(component) &&
    socketOpens === 0,
);

console.log(`RESULT candidate-drawer-employee: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
