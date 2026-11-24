/* Smoke test of the ARIA <-> Odoo integration against a real Odoo (docs/odoo.md).
 *
 *   ODOO_URL=https://odoo.example.com ODOO_DB=prod ODOO_API_KEY_FILE=/path/key \
 *     npx tsx scripts/smoke-odoo.mts           # read-only checks
 *     npx tsx scripts/smoke-odoo.mts --write   # also hand off a synthetic test
 *                                              # person, move it, erase it
 *     ... --write --webhook-url=https://aria.example.com/api/webhooks/odoo/x
 *                                              # also create and remove the
 *                                              # live-update automation rule
 *
 * The key is read from a file so it never appears in a process list. --write
 * creates "ARIA smoke test" applicants on the first open job and deletes them
 * at the end: use it on a test database, not production.
 * Set ODOO_ALLOW_HTTP=true for a local http:// Odoo.
 */

import { readFileSync } from "node:fs";
import { createOdooClient, normalizeOdooBaseUrl, odooHttpAllowed } from "../src/lib/integrations/odoo/client";
import {
  ariaStageForApplicant,
  handoffNoteHtml,
  jobToBrief,
  stageUpdate,
  type HandoffCandidate,
} from "../src/lib/integrations/odoo/mapping";
import {
  checkOdoo,
  createOrFindApplicant,
  ensureStageWebhook,
  eraseApplicant,
  listOpenJobs,
  postApplicantNote,
  readApplicantStates,
  readJob,
  removeStageWebhook,
} from "../src/lib/integrations/odoo/service";

const write = process.argv.includes("--write");
const hookUrl = process.argv.find((arg) => arg.startsWith("--webhook-url="))?.slice("--webhook-url=".length) ?? "";
const base = normalizeOdooBaseUrl(process.env.ODOO_URL ?? "", { allowHttp: odooHttpAllowed() });
if (!base.ok) throw new Error(base.error);
const keyFile = process.env.ODOO_API_KEY_FILE;
if (!keyFile) throw new Error("Set ODOO_API_KEY_FILE to a file holding the Odoo API key.");
const client = createOdooClient({
  baseUrl: base.url,
  database: process.env.ODOO_DB ?? "",
  apiKey: readFileSync(keyFile, "utf8").trim(),
});

function info(label: string, detail: string): void {
  console.log(`INFO  ${label}  (${detail})`);
}

function step(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

const check = await checkOdoo(client);
step("connection", true, `Odoo ${check.version}, user ${check.userName}`);
step("recruitment app installed", check.recruitment);
step("recruitment stages", check.stages.length > 0, check.stages.map((s) => `${s.name}${s.hiredStage ? "*" : ""}`).join(" > "));

const jobs = await listOpenJobs(client);
step("open job positions", jobs.length > 0, `${jobs.length} found`);
const first = jobs[0];
if (!first) process.exit();

const job = await readJob(client, first.id);
step("job detail", job !== null, job ? `${job.name}, ${job.skills.length} skills, recruiter ${job.recruiter || "-"}` : "");
if (job) {
  const brief = jobToBrief(job);
  step("intake brief built", brief.email.includes(job.name), `${brief.email.split("\n").length} brief lines, ${brief.jd.length} chars of description`);
}

if (write) {
  const stamp = Date.now().toString(36);
  const candidate: HandoffCandidate = {
    id: `smoke_${stamp}`,
    campaignId: "smoke",
    name: `ARIA smoke test ${stamp}`,
    email: `aria_smoke.${stamp}@example.com`,
    linkedinUrl: `https://www.linkedin.com/in/aria-smoke-${stamp}`,
    githubUrl: "",
    currentTitle: "Test <b>engineer</b>",
    currentCompany: "Example & Co",
    location: "Montréal",
    matchScore: 82,
    matchBreakdown: [{ label: "Skills", score: 90, rationale: "<script>alert(1)</script> matched" }],
    techStack: ["Murex", "SQL"],
    stage: "Interested",
    sourcePlatform: "LinkedIn",
    provenance: "manual",
    lawfulBasis: "legitimate_interest",
    complianceFlags: {},
  };
  const firstTry = await createOrFindApplicant(client, candidate, first.id);
  step("hand-off creates the applicant", firstTry.created, `applicant #${firstTry.applicantId}`);
  const again = await createOrFindApplicant(client, candidate, first.id);
  step("a second hand-off finds it instead of duplicating", !again.created && again.applicantId === firstTry.applicantId);
  await postApplicantNote(client, firstTry.applicantId, handoffNoteHtml(candidate, { campaignTitle: "Smoke", sentBy: "smoke script", sentAt: new Date().toISOString() }));
  const messages = await client.call<{ body: string }[]>("mail.message", "search_read", {
    domain: [["model", "=", "hr.applicant"], ["res_id", "=", firstTry.applicantId], ["message_type", "=", "comment"]],
    fields: ["body"],
    limit: 1,
    order: "id desc",
  });
  const note = messages[0]?.body ?? "";
  step("note posted as HTML, candidate text escaped", /<b>Sourced by ARIA<\/b>/.test(note) && !/<script/i.test(note) && note.includes("&lt;b&gt;engineer"), note.slice(0, 80));

  const states = await readApplicantStates(client, [firstTry.applicantId, 999_999_999], check.stages);
  step("new applicant is ongoing", states[0]?.status === "ongoing", states[0]?.stage?.name ?? "-");
  step("missing applicant reads as deleted", states[1]?.status === "deleted");

  const hired = check.stages.find((s) => s.hiredStage);
  if (hired) {
    await client.call("hr.applicant", "write", { ids: [firstTry.applicantId], vals: { stage_id: hired.id } });
    const [after] = await readApplicantStates(client, [firstTry.applicantId], check.stages);
    const aria = after ? ariaStageForApplicant(after, check.stages, {}) : null;
    step("moving to the hired stage reads back as Hired", aria === "Hired" && stageUpdate("Interested", aria) === "Hired", `${after?.stage?.name} / ${after?.status}`);
  }
  const reasons = await client.call<{ id: number; name: string }[]>("hr.applicant.refuse.reason", "search_read", { domain: [], fields: ["name"], limit: 20 });
  const byApplicant = reasons.find((r) => /by applicant/i.test(r.name));
  if (byApplicant) {
    const refused = await createOrFindApplicant(client, { ...candidate, id: `${candidate.id}_r`, email: `r.${candidate.email}`, linkedinUrl: `${candidate.linkedinUrl}-r` }, first.id);
    await client.call("hr.applicant", "write", { ids: [refused.applicantId], vals: { refuse_reason_id: byApplicant.id, active: false } });
    const [after] = await readApplicantStates(client, [refused.applicantId], check.stages);
    const aria = after ? ariaStageForApplicant(after, check.stages, {}) : null;
    step("refused by the applicant reads back as Not Interested", aria === "Not Interested", `${after?.status} / ${after?.refuseReason}`);
    await client.call("hr.applicant", "unlink", { ids: [refused.applicantId] });
  }
  const erased = await eraseApplicant(client, firstTry.applicantId, "smoke test");
  step("erasure of a hired applicant keeps it", erased.outcome === "kept_hired", erased.detail);
  await client.call("hr.applicant", "unlink", { ids: [firstTry.applicantId] });

  const fresh = await createOrFindApplicant(client, { ...candidate, id: `${candidate.id}_e`, email: `e.${candidate.email}`, linkedinUrl: `${candidate.linkedinUrl}-e` }, first.id);
  const erasure = await eraseApplicant(client, fresh.applicantId, "smoke test");
  const gone = (await readApplicantStates(client, [fresh.applicantId], check.stages))[0]?.status === "deleted";
  step("erasure deletes an ongoing applicant", erasure.outcome === "deleted" && gone, erasure.detail);
  info("erasure: contact", erasure.contact === "deleted" ? "deleted (created for the application)" : "kept");
  info("erasure: Odoo privacy log", erasure.logged ? "written" : "not written (needs more rights)");

  if (hookUrl) {
    const setup = await ensureStageWebhook(client, hookUrl, null);
    if (setup.automated) {
      step("live-update rule created in Odoo", true, `base.automation #${setup.automationId}`);
      step("live-update rule removed", await removeStageWebhook(client, setup.automationId));
    } else {
      info("live-update rule", `not created: ${setup.reason}`);
    }
  }
  step("test applicants deleted", true);
}
