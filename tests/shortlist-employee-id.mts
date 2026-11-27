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

const { ShortlistEmployeeId } = await import("../src/components/tania/shortlist-employee-id.tsx");
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
  return renderToStaticMarkup(createElement(ShortlistEmployeeId, { candidate }));
}

const hired = { stage: "Hired" as const, odooEmployeeId: 7 };
const hiredMarkup = markup(hired);
ok(
  "the shortlist shows a hired candidate's stored employee id",
  hiredMarkup.includes("Employee 7") && hiredMarkup.includes('data-testid="shortlist-employee-id"'),
);

const hiredWithoutId = markup({ stage: "Hired" });
ok("a hired candidate with no stored employee id shows no employee id", hiredWithoutId === "");

for (const stage of CANDIDATE_STAGES) {
  if (stage === "Hired") continue;
  const html = markup({ stage, odooEmployeeId: 7 });
  ok(
    `a ${stage} candidate shows no employee id`,
    html === "" && !html.includes("Employee") && !html.includes("shortlist-employee-id") && !html.includes("7"),
  );
}

for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const html = markup({ stage: "Hired", odooEmployeeId: id });
  ok(`a stored id of ${id} is not shown on the shortlist`, html === "");
}

const page = readFileSync(new URL("../src/app/vivier/page.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/components/tania/vivier-view.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/tania/shortlist-employee-id.tsx", import.meta.url),
  "utf8",
);
const silver = view.slice(view.indexOf("function SilverMedalistCard"), view.indexOf("function WarmRow"));
const warm = view.slice(view.indexOf("function WarmRow"), view.indexOf("function VivierFallback"));
ok(
  "the shortlist page renders the stored employee id from the in-memory candidate",
  page.includes("<VivierView />") &&
    silver.includes("<ShortlistEmployeeId candidate={c} />") &&
    warm.includes("<ShortlistEmployeeId candidate={c} />") &&
    component.includes("candidateListHire(candidate)") &&
    component.includes("hire.employeeId") &&
    !component.includes("fetch(") &&
    !component.includes("createEmployee") &&
    !component.includes("storeHiredEmployeeId") &&
    !component.includes("net.") &&
    !/\bhttps?:\/\//.test(component) &&
    socketOpens === 0,
);

console.log(`RESULT shortlist-employee-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
