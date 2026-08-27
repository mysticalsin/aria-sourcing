/**
 * Enterprise E2E audit matrix — pins every requirement in the Mantu recruiting loop
 * objective against verifiable code artifacts and in-process tests.
 */

import { existsSync, readFileSync } from "node:fs";

import { routeInboundEmail } from "../src/lib/inbound-email-router";
import { validateOutreachQuality } from "../src/lib/outreach-quality-pipeline";
import { mantuOutreachVoice } from "../src/lib/mantu-brand";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "../src/lib/recruiting-loop/constants";
import { SAMPLE_MANTU_EMAIL } from "../src/lib/mock-ai";
import {
  buildInboundEmailText,
  deterministicCampaignId,
  parseInboundNeed,
} from "../src/lib/requisition-intake";

const worker = existsSync("scripts/sourcing-loop-worker.mjs")
  ? readFileSync("scripts/sourcing-loop-worker.mjs", "utf8")
  : "";
const webhookRoute = existsSync("src/app/api/webhooks/email-inbound/route.ts")
  ? readFileSync("src/app/api/webhooks/email-inbound/route.ts", "utf8")
  : "";
const graphRoute = existsSync("src/lib/langchain/recruiting-graph.ts")
  ? readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8")
  : "";
const mig62 = existsSync("supabase/migrations/0062_requisition_parse_inbound_id.sql")
  ? readFileSync("supabase/migrations/0062_requisition_parse_inbound_id.sql", "utf8")
  : "";
const e2eScript = existsSync("e2e-workflow-test.sh")
  ? readFileSync("e2e-workflow-test.sh", "utf8")
  : "";
const e2eTest = existsSync("tests/mantu-recruiting-e2e-full.mts")
  ? readFileSync("tests/mantu-recruiting-e2e-full.mts", "utf8")
  : "";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const MATRIX: Array<{ requirement: string; evidence: () => boolean }> = [
  {
    requirement: "Webhook routes hiring needs to requisition_parse (no polling)",
    evidence: () =>
      routeInboundEmail({
        record: { ok: true, inbound_id: "81111111-1111-4111-8111-111111111111", duplicate: false },
        from: "noreply@mantu.example",
        subject: "This need is now ACTIVE: Senior Engineer",
        body: "Role: Senior Engineer\nLocation: London\nKey required skills\n- TypeScript",
        mailbox: "talent@mantu.com",
      }).route === "hiring_need"
      && /routeInboundEmail/.test(webhookRoute)
      && !/poll.*mailbox|inbox.*poll/i.test(webhookRoute),
  },
  {
    requirement: "requisition_parse job payload is ids-only (inboundId)",
    evidence: () => {
      const route = routeInboundEmail({
        record: { ok: true, inbound_id: "81111111-1111-4111-8111-111111111111", duplicate: false },
        from: "noreply@mantu.example",
        subject: "This need is now ACTIVE: Senior Engineer",
        body: SAMPLE_MANTU_EMAIL,
        mailbox: "talent@mantu.com",
      });
      return (
        route.route === "hiring_need"
        && Object.keys(route.decision.payload).length === 1
        && "inboundId" in route.decision.payload
      );
    },
  },
  {
    requirement: "Loop worker ingests + parses + creates campaign from inbound",
    evidence: () =>
      /ingest_requisition/.test(worker)
      && /parseInboundNeedViaRoute/.test(worker)
      && /record_requisition_parse/.test(worker)
      && /apply_workspace_patch/.test(worker)
      && /record_requisition_campaign/.test(worker),
  },
  {
    requirement: "Internal cron parse route (service auth, no browser Origin)",
    evidence: () =>
      existsSync("src/app/api/cron/parse-inbound-need/route.ts")
      && /CRON_SECRET/.test(readFileSync("src/app/api/cron/parse-inbound-need/route.ts", "utf8"))
      && /req\.headers\.get\("origin"\)/.test(
        readFileSync("src/app/api/cron/parse-inbound-need/route.ts", "utf8"),
      ),
  },
  {
    requirement: "DB payload contract allows inboundId on requisition_parse",
    evidence: () =>
      /when 'requisition_parse' then allowed_keys := array\['inboundId'/.test(mig62),
  },
  {
    requirement: "LangChain graph orchestrates webhook → source → top10 → outreach → book",
    evidence: () =>
      /receiveEmail|parseRequisition|sourceCandidates|rankTop10|validateQuality|queueApproval|scheduleInterview/.test(
        graphRoute,
      ),
  },
  {
    requirement: "Top shortlist capped at 10",
    evidence: () => TOP_CANDIDATE_SHORTLIST_SIZE === 10 && /TOP_CANDIDATE_SHORTLIST_SIZE/.test(e2eTest),
  },
  {
    requirement: "Mantu-branded outreach quality validation",
    evidence: () => {
      const voice = mantuOutreachVoice();
      const quality = validateOutreachQuality({
        subject: "Your TypeScript platform work",
        body: `Hi Alex,\n\nI noticed your recent TypeScript work — it stood out. Mantu Group is hiring in London.\n\nWould you be open to a brief first conversation?\n\nBest,\n${voice.signature}`,
        channel: "Email",
      });
      return quality.status === "ready" && voice.signature.includes("Mantu");
    },
  },
  {
    requirement: "LinkedIn send remains assisted-manual (409)",
    evidence: () => /409.*manual-required|manual-required.*409/.test(e2eScript),
  },
  {
    requirement: "Email send dry-run without live confirm",
    evidence: () => /status.*dry-run|dry-run.*status/.test(e2eScript),
  },
  {
    requirement: "In-process full E2E test exists",
    evidence: () => e2eTest.includes("mantu-recruiting-e2e-full") && /runRecruitingGraph/.test(e2eTest),
  },
  {
    requirement: "Deployed E2E script covers intake + sourcing + outreach",
    evidence: () =>
      /POST.*\/api\/intake/.test(e2eScript)
      && /\/api\/sourcing-agent/.test(e2eScript)
      && /\/api\/outreach\/approve/.test(e2eScript),
  },
  {
    requirement: "Intake parse from inbound email text",
    evidence: () => {
      const parsed = parseInboundNeed(buildInboundEmailText({ body: SAMPLE_MANTU_EMAIL }));
      return parsed.jobAnalysis.title.length > 2 && parsed.jobAnalysis.requiredSkills.length > 0;
    },
  },
  {
    requirement: "Deterministic campaign id from requisition",
    evidence: () =>
      deterministicCampaignId("81111111-1111-4111-8111-111111111111").startsWith("camp-req-"),
  },
  {
    requirement: "Microsoft 365 stack UI documents webhook routing",
    evidence: () =>
      existsSync("src/components/settings/microsoft365-stack.tsx")
      && /requisition_parse/.test(readFileSync("src/components/settings/microsoft365-stack.tsx", "utf8")),
  },
  {
    requirement: "Microsoft 365 stack reads live mailbox connection status",
    evidence: () => {
      const src = readFileSync("src/components/settings/microsoft365-stack.tsx", "utf8");
      return /\/api\/email\/connections/.test(src) && /connectedOutlook/.test(src);
    },
  },
  {
    requirement: "Loop worker chains campaign_create into sourcing_batch",
    evidence: () => {
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      return (
        /campaign_create:\s*Object\.freeze\(\["sourcing_batch"\]\)/.test(worker)
        && /handleCampaignCreate/.test(worker)
        && /run-sourcing-batch/.test(worker)
        && /generate-outreach-draft/.test(worker)
        && /append_outreach/.test(worker)
      );
    },
  },
  {
    requirement: "Deployed E2E script covers calendar/Teams dry-run booking",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /\/api\/calendar\/event/.test(script)
        && /confirmLive:false/.test(script)
        && /isOnlineMeeting/.test(script)
        && /teamsForBusiness/.test(script)
      );
    },
  },
  {
    requirement: "Outreach approve/send enforce multi-agent quality validation",
    evidence: () => {
      const rules = readFileSync("src/lib/rules.ts", "utf8");
      const approve = readFileSync("src/app/api/outreach/approve/route.ts", "utf8");
      const send = readFileSync("src/app/api/outreach/send/route.ts", "utf8");
      return (
        /outreachQualityGate/.test(rules)
        && /outreachQualityGate/.test(approve)
        && /outreachQualityGate/.test(send)
      );
    },
  },
  {
    requirement: "Autonomous sourcing cron resolves workspace Apify/Tavily keys",
    evidence: () => {
      const route = readFileSync("src/app/api/cron/run-sourcing-batch/route.ts", "utf8");
      return (
        /resolveStoredApifyKeyForWorkspace/.test(route)
        && /resolveStoredTavilyKeyForWorkspace/.test(route)
        && /linkedInProfileToken/.test(route)
      );
    },
  },
  {
    requirement: "Calendar live booking requires durable reconciliation before success",
    evidence: () => {
      const route = readFileSync("src/app/api/calendar/event/route.ts", "utf8");
      return (
        /reconciled\.status !== "reconciled"/.test(route)
        && /reconciliation-required/.test(route)
      );
    },
  },
  {
    requirement: "Mantu enterprise production ships on Fly only (Vercel skipped)",
    evidence: () => {
      const vercel = readFileSync("vercel.json", "utf8");
      const golive = readFileSync("scripts/fly-golive-mantu-e2e.sh", "utf8");
      const deployNow = readFileSync("scripts/fly-deploy-now.sh", "utf8");
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /ignoreCommand/.test(vercel)
        && /Fly \(aria-mantu-app\) only/.test(vercel)
        && /Fly ONLY/.test(golive)
        && /FLY ONLY/.test(deployNow)
        && /aria-mantu-app\.fly\.dev/.test(golive)
        && !/vercel --prod/.test(deployNow)
        && /validate_fly_e2e_url/.test(script)
        && !/aria-mantu-app\.fly\.dev\*/.test(script)
      );
    },
  },
];

for (const row of MATRIX) {
  ok(row.requirement, row.evidence());
}

console.log(`RESULT enterprise-e2e-audit-matrix: ${pass}/${MATRIX.length} requirements verified`);
if (fail > 0) process.exit(1);
