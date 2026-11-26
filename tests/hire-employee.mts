import { readFileSync } from "node:fs";
import {
  createEmployeeForStage,
  createEmployeeWhenHired,
  FakeOdooEmployeeClient,
  namedHiredStage,
  storeHiredEmployee,
  type OdooEmployeeClient,
  type OdooEmployeeRecord,
} from "../src/lib/hire-employee";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const hired = { applicantId: "42", name: "Fixture Candidate North", hired: true };

const created = await createEmployeeWhenHired(new FakeOdooEmployeeClient(), hired);
ok("a hired applicant creates one hr.employee", created.ok === true && created.employee.model === "hr.employee" && created.employee.id === 1 && created.created === true);
ok("the employee is linked to that applicant", created.ok === true && created.employee.applicantId === "42" && created.employee.name === "Fixture Candidate North");

const replayClient = new FakeOdooEmployeeClient();
const first = await createEmployeeWhenHired(replayClient, hired);
const second = await createEmployeeWhenHired(replayClient, hired);
ok(
  "hiring the same applicant again does not create a second employee",
  first.ok === true &&
    second.ok === true &&
    second.created === false &&
    second.employee.id === first.employee.id &&
    replayClient.createCount === 1 &&
    replayClient.employees.length === 1,
);

const other = await createEmployeeWhenHired(replayClient, { applicantId: "43", name: "Fixture Candidate South", hired: true });
ok(
  "a different hired applicant gets a new employee",
  other.ok === true && other.created === true && other.employee.id === 2 && replayClient.employees.length === 2,
);

const refused = new FakeOdooEmployeeClient();
const notHired = await createEmployeeWhenHired(refused, { ...hired, hired: false });
ok(
  "an applicant who is not hired creates no employee",
  notHired.ok === false && notHired.error === "applicant is not hired" && refused.createCount === 0 && refused.findCount === 0 && refused.employees.length === 0,
);

const blank = new FakeOdooEmployeeClient();
const missingId = await createEmployeeWhenHired(blank, { applicantId: "  ", name: "Fixture", hired: true });
const missingName = await createEmployeeWhenHired(blank, { applicantId: "42", name: "  ", hired: true });
ok(
  "a blank applicant id or name is refused before the client is called",
  missingId.ok === false && missingName.ok === false && blank.createCount === 0 && blank.findCount === 0,
);

const failing: OdooEmployeeClient = {
  async findByApplicant() {
    return null;
  },
  async create(): Promise<OdooEmployeeRecord> {
    throw new Error("socket open");
  },
};
const failed = await createEmployeeWhenHired(failing, hired);
ok("a failed create stays a failed result", failed.ok === false && failed.error === "odoo employee create failed");

const unlinked: OdooEmployeeClient = {
  async findByApplicant() {
    return null;
  },
  async create() {
    return { model: "hr.employee", id: 9, name: "Fixture Candidate North", applicantId: "other" };
  },
};
const mismatch = await createEmployeeWhenHired(unlinked, hired);
ok("an employee linked to someone else is not a hire", mismatch.ok === false && mismatch.error === "odoo employee is not linked to the applicant");

const emptyId: OdooEmployeeClient = {
  async findByApplicant() {
    return null;
  },
  async create() {
    return { model: "hr.employee", id: 0, name: "Fixture Candidate North", applicantId: "42" };
  },
};
const noRecord = await createEmployeeWhenHired(emptyId, hired);
ok("a create that returns no employee id fails", noRecord.ok === false && noRecord.error === "odoo employee create returned no record");

ok("this branch already names the hired stage", namedHiredStage() === "Hired");

const stageClient = new FakeOdooEmployeeClient();
const offer = await createEmployeeForStage("Offer", { applicantId: "42", name: "Fixture Candidate North" }, stageClient);
ok(
  "a stage other than Hired does not call the client",
  offer.employeeId === null && stageClient.findCount === 0 && stageClient.createCount === 0,
);

const unconfigured = await createEmployeeForStage("Hired", { applicantId: "42", name: "Fixture Candidate North" }, null);
ok("an unconfigured Odoo client is not called", unconfigured.employeeId === null && stageClient.findCount === 0 && stageClient.createCount === 0);

const hiredStage = await createEmployeeForStage("Hired", { applicantId: "42", name: "Fixture Candidate North" }, stageClient);
const hiredAgain = await createEmployeeForStage("Hired", { applicantId: "42", name: "Fixture Candidate North" }, stageClient);
ok(
  "moving to Hired returns the employee id",
  hiredStage.employeeId === 1 && hiredAgain.employeeId === 1 && stageClient.createCount === 1 && stageClient.employees.length === 1,
);

const storedClient = new FakeOdooEmployeeClient();
const storedFirst = await storeHiredEmployee({ id: "42", name: "Fixture Candidate North" }, "Hired", storedClient);
const storedSecond = await storeHiredEmployee(storedFirst.candidate, "Hired", storedClient);
ok(
  "a successful hire stores the client's hr.employee id and a second hire keeps it",
  storedFirst.employeeId === storedClient.employees[0]?.id &&
    storedFirst.candidate.odooEmployeeId === storedClient.employees[0]?.id &&
    storedClient.employees[0]?.model === "hr.employee" &&
    storedClient.employees[0]?.applicantId === "42" &&
    storedSecond.employeeId === storedFirst.employeeId &&
    storedSecond.candidate.odooEmployeeId === storedFirst.candidate.odooEmployeeId &&
    storedClient.createCount === 1 &&
    storedClient.employees.length === 1,
);

const offerRecord = { id: "42", name: "Fixture Candidate North" };
const offerStored = await storeHiredEmployee(offerRecord, "Offer", storedClient);
ok(
  "a stage other than Hired does not store an employee id",
  offerStored.employeeId === null &&
    offerStored.candidate === offerRecord &&
    storedClient.createCount === 1 &&
    storedClient.findCount === 2,
);

const unstored = await storeHiredEmployee(offerRecord, "Hired", null);
ok("a hire with no client does not store an employee id", unstored.employeeId === null && unstored.candidate === offerRecord);

const stageWriter = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const stageFn = stageWriter.slice(stageWriter.indexOf("const setCandidateStage"), stageWriter.indexOf("const setCandidatePhone"));
ok(
  "the stage writer stores that employee id on the candidate",
  stageFn.includes("storeHiredEmployee") && stageFn.includes("withStoredEmployeeId") && stageFn.includes("odooEmployeeId"),
);

console.log(`RESULT hire-employee: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
