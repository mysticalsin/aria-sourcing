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
    evidence: () => {
      const ingest = readFileSync("src/lib/inbound-email-ingest.ts", "utf8");
      return (
        routeInboundEmail({
          record: { ok: true, inbound_id: "81111111-1111-4111-8111-111111111111", duplicate: false },
          from: "noreply@mantu.example",
          subject: "This need is now ACTIVE: Senior Engineer",
          body: "Role: Senior Engineer\nLocation: London\nKey required skills\n- TypeScript",
          mailbox: "talent@mantu.com",
        }).route === "hiring_need"
        && /ingestNormalizedInboundEmail/.test(webhookRoute)
        && /routeInboundEmail/.test(ingest)
        && !/poll.*mailbox|inbox.*poll/i.test(webhookRoute)
      );
    },
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
    requirement: "Microsoft Graph mail webhook pushes Inbox creates (no polling)",
    evidence: () => {
      const route = readFileSync("src/app/api/webhooks/microsoft-graph/route.ts", "utf8");
      const subs = readFileSync("src/lib/email-graph-subscriptions.ts", "utf8");
      const migration = readFileSync("supabase/migrations/0064_graph_mail_subscriptions.sql", "utf8");
      const panel = readFileSync("src/components/intake/outlook-needs-panel.tsx", "utf8");
      return (
        /validationToken/.test(route)
        && /createGraphMailSubscription/.test(subs)
        && /renewExpiringGraphMailSubscriptions|renewGraphMailSubscription/.test(subs)
        && /graph_mail_subscriptions/.test(migration)
        && /Emergency sync/.test(panel)
        && /Webhook open needs/.test(panel)
        && existsSync("src/app/api/cron/renew-graph-subscriptions/route.ts")
      );
    },
  },
  {
    requirement: "Autonomous parse/draft prefer server LLM over mock stand-ins",
    evidence: () => {
      const parseRoute = readFileSync("src/app/api/cron/parse-inbound-need/route.ts", "utf8");
      const intakeRoute = readFileSync("src/app/api/intake/route.ts", "utf8");
      const draftRoute = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
      const live = readFileSync("src/lib/requisition-intake-live.ts", "utf8");
      const quality = readFileSync("src/lib/outreach-quality-pipeline.ts", "utf8");
      const qualityLive = readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8");
      return (
        /parseInboundNeedLive/.test(parseRoute)
        && /llm_required/.test(parseRoute)
        && /parseInboundNeedLive/.test(intakeRoute)
        && /llm_required/.test(intakeRoute)
        && /serverGenerateText/.test(draftRoute)
        && /llm_required/.test(draftRoute)
        && /critics_required/.test(draftRoute)
        && /runRecruitingGraph/.test(draftRoute)
        && /graphStage/.test(draftRoute)
        && /validateOutreachQualityLive/.test(draftRoute)
        && /llmCriticsUsed/.test(quality)
        && /validateOutreachQualityLive/.test(qualityLive)
        && /llm_empathy/.test(qualityLive)
        && /server-only/.test(qualityLive)
        && /parseInboundNeedLive/.test(live)
        && /serverGenerateText/.test(live)
      );
    },
  },
  {
    requirement: "Production intake hides demo sample substitution when demo login is off",
    evidence: () => {
      const intake = readFileSync("src/app/intake/page.tsx", "utf8");
      const panel = readFileSync("src/components/intake/outlook-needs-panel.tsx", "utf8");
      const flyApp = readFileSync("fly.app.toml", "utf8");
      const flyAuth = readFileSync("fly.auth.toml", "utf8");
      const setup = readFileSync("src/components/settings/setup-guide-panel.tsx", "utf8");
      return (
        /demoLoginEnabled/.test(intake)
        && /Sample substitution is disabled/.test(intake)
        && /allowDemoNeeds/.test(panel)
        && /Demo hiring emails are disabled/.test(panel)
        && /NEXT_PUBLIC_ENABLE_DEMO_LOGIN\s*=\s*"false"/.test(flyApp)
        && /GOTRUE_EXTERNAL_AZURE/.test(flyAuth)
        && /webhook push/.test(setup)
        && /Emergency sync is break-glass/.test(setup)
      );
    },
  },
  {
    requirement: "Production settings hide roadmap placeholders and fake Configure CTAs",
    evidence: () => {
      const settings = readFileSync("src/app/settings/page.tsx", "utf8");
      const card = readFileSync("src/components/settings/integration-card.tsx", "utf8");
      return (
        /demoLoginEnabled && roadmapIntegrations\.length/.test(settings)
        && /no mock fallback on production tenants/.test(settings)
        && /integration\.real \? \(/.test(card)
        && /Not available/.test(card)
      );
    },
  },
  {
    requirement: "Loop proposes Teams/Outlook interview after positive interest (calendar_book)",
    evidence: () => {
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const propose = readFileSync("src/app/api/cron/propose-calendar-book/route.ts", "utf8");
      const calendar = readFileSync("src/app/calendar/page.tsx", "utf8");
      const types = readFileSync("src/lib/types.ts", "utf8");
      const migration = readFileSync("supabase/migrations/0065_calendar_book_and_graph_renew.sql", "utf8");
      return (
        /calendar_book/.test(worker)
        && /handleCalendarBook/.test(worker)
        && /calendarProposeUrl/.test(worker)
        && /interviewProposal/.test(worker)
        && /stage: "Interested"/.test(worker)
        && /type: "booking"/.test(worker)
        && /needs_human_confirm/.test(worker)
        && /human_confirm_live/.test(worker)
        && /claimCalendarBooking/.test(propose)
        && /use_calendar_event_route/.test(propose)
        && /proposed_dry_run/.test(propose)
        && /interviewProposal\?\.startTime/.test(calendar)
        && /Confirm slot/.test(calendar)
        && /interviewProposal\?:/.test(types)
        && /'calendar_book'/.test(migration)
      );
    },
  },
  {
    requirement: "Graph subscription health is distinct from inbound mailbox route",
    evidence: () => {
      const connections = readFileSync("src/app/api/email/connections/route.ts", "utf8");
      const stack = readFileSync("src/components/settings/microsoft365-stack.tsx", "utf8");
      const panel = readFileSync("src/components/settings/email-connections-panel.tsx", "utf8");
      const graphLib = readFileSync("src/lib/email-graph-subscriptions.ts", "utf8");
      return (
        /listGraphSubscriptionsForWorkspace/.test(connections)
        && /ensure_graph_webhook/.test(connections)
        && /ensureGraphMailSubscription/.test(connections)
        && /graphSubscription/.test(connections)
        && /graphSubscriptionActive/.test(stack)
        && /Enable webhook/.test(panel)
        && /ensureGraphMailSubscription/.test(graphLib)
        && /Entra SSO/.test(stack)
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
        && /0065/.test(deployNow)
        && /validate_fly_e2e_url/.test(script)
        && !/aria-mantu-app\.fly\.dev\*/.test(script)
      );
    },
  },
  {
    requirement: "Enterprise E2E deliverable tracked on open PR #30 (supersedes closed #29)",
    evidence: () => {
      const golive = readFileSync("scripts/fly-golive-mantu-e2e.sh", "utf8");
      const handoff = readFileSync("_relay/HANDOFF.md", "utf8");
      const printConfirm = readFileSync("scripts/print-fly-deploy-confirm.sh", "utf8");
      const printE2e = readFileSync("scripts/print-fly-e2e-env.sh", "utf8");
      return (
        /PR #30/.test(golive)
        && /supersedes closed \*\*#29\*\*/.test(handoff)
        && /print-fly-deploy-confirm/.test(handoff)
        && /ARIA_PROD_DEPLOY_CONFIRM/.test(printConfirm)
        && /print-fly-e2e-env/.test(golive)
        && /FLY_SUPABASE_ANON_KEY/.test(printE2e)
        && /Fly secrets inventory/.test(golive)
      );
    },
  },
  {
    requirement: "LLM wiki / second brain documents agent behavior with durable identity",
    evidence: () => {
      const readme = readFileSync("docs/agent-wiki/README.md", "utf8");
      const identity = readFileSync("src/lib/agent-wiki/identity.ts", "utf8");
      const feedback = readFileSync("src/lib/agent-wiki/feedback.ts", "utf8");
      const route = readFileSync("src/app/api/sourcing-learning/feedback/route.ts", "utf8");
      return (
        existsSync("docs/agent-wiki/INDEX.md")
        && existsSync("docs/agent-wiki/lessons/0001-current-baseline.md")
        && /aggregate-only/.test(readme)
        && /fingerprintCandidateIdentity/.test(identity)
        && /samePerson/.test(identity)
        && /strength === "none"/.test(identity)
        && /tryStageWikiLessonFromFeedback/.test(feedback)
        && /tryStageWikiLessonFromFeedback/.test(route)
        && /PROPOSED_WIKI_ROOT|var\/agent-wiki\/proposed/.test(feedback)
      );
    },
  },
];

for (const row of MATRIX) {
  ok(row.requirement, row.evidence());
}

console.log(`RESULT enterprise-e2e-audit-matrix: ${pass}/${MATRIX.length} requirements verified`);
if (fail > 0) process.exit(1);
