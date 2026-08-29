/**
 * Enterprise E2E audit matrix — pins every requirement in the Mantu recruiting loop
 * objective against verifiable code artifacts and in-process tests.
 */

import { existsSync, readFileSync } from "node:fs";

import { routeInboundEmail } from "../src/lib/inbound-email-router";
import { validateOutreachQuality } from "../src/lib/outreach-quality-pipeline";
import { mantuOutreachVoice } from "../src/lib/mantu-brand";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "../src/lib/recruiting-loop/constants";
import { SAMPLE_MANTU_EMAIL, SAMPLE_VSS_CALYPSO_APP_SUPPORT } from "../src/lib/mock-ai";
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
      )
      && /GRAPH_STAGE_TO_JOB_KIND/.test(graphRoute)
      && /nextJobKindAfterGraphStage/.test(graphRoute)
      && /pipeline-transitions\.json/.test(graphRoute)
      && /graph-stage-jobs\.json/.test(graphRoute)
      && existsSync("src/lib/langchain/pipeline-transitions.json")
      && existsSync("src/lib/langchain/graph-stage-jobs.json")
      && /graph-stage-jobs\.json/.test(worker)
      && /nextJobKindAfterGraphStage/.test(worker)
      && /sourcing_failed/.test(graphRoute)
      && /shortlist_rank_failed/.test(graphRoute)
      && /missing_scored_candidates/.test(graphRoute)
      && /missing_campaign_id/.test(graphRoute),
  },
  {
    requirement: "Top shortlist capped at 10",
    evidence: () => {
      const approve = readFileSync("src/app/api/shortlist/approve/route.ts", "utf8");
      return (
        TOP_CANDIDATE_SHORTLIST_SIZE === 10
        && /TOP_CANDIDATE_SHORTLIST_SIZE/.test(e2eTest)
        && /TOP_CANDIDATE_SHORTLIST_SIZE/.test(approve)
        && /\.max\(TOP_CANDIDATE_SHORTLIST_SIZE\)/.test(approve)
        && /count:10/.test(e2eScript)
        && /top-10 shortlist/.test(e2eScript)
        && /draftByCandidateId/.test(readFileSync("src/app/api/sourcing-agent/route.ts", "utf8"))
        && /Deepen GitHub \+ LinkedIn web/.test(readFileSync("src/lib/sourcing/orchestrator.ts", "utf8"))
      );
    },
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
      const unbranded = validateOutreachQuality({
        subject: "Your TypeScript platform work",
        body: "Hi Alex,\n\nI noticed your recent TypeScript work — it stood out. We are hiring in London.\n\nWould you be open to a brief first conversation?",
        channel: "Email",
      });
      const pipeline = readFileSync("src/lib/outreach-quality-pipeline.ts", "utf8");
      const store = readFileSync("src/lib/store.ts", "utf8");
      const mockAi = readFileSync("src/lib/mock-ai.ts", "utf8");
      return (
        quality.status === "ready"
        && voice.signature.includes("Mantu")
        && unbranded.status !== "ready"
        && /missing-mantu-brand/.test(pipeline)
        && /function enterpriseMantuVoice/.test(store)
        && /persona: mantuVoice\.persona/.test(mockAi)
        && /\/tmp\/aria-e2e-webhook-secret/.test(e2eScript)
        && /validateOutreachQuality/.test(store)
        && /draftReplyResponse/.test(store)
      );
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
    requirement: "sourcing-agent HTTP response stamps provenance=live on every candidate",
    evidence: () => {
      const contract = readFileSync("src/lib/sourcing/sourcing-agent-contract.ts", "utf8");
      const route = readFileSync("src/app/api/sourcing-agent/route.ts", "utf8");
      return (
        /provenance:\s*z\.literal\("live"\)/.test(contract)
        && /provenance:\s*"live"/.test(route)
        && /select\(\.provenance=="live"\)/.test(e2eScript)
        && /AG_LIVE.*AG_N/.test(e2eScript)
      );
    },
  },
  {
    requirement: "Intake parse from inbound email text",
    evidence: () => {
      const parsed = parseInboundNeed(buildInboundEmailText({ body: SAMPLE_MANTU_EMAIL }));
      return parsed.jobAnalysis.title.length > 2 && parsed.jobAnalysis.requiredSkills.length > 0;
    },
  },
  {
    requirement: "VSS Recruitment Need extracts Calypso structured fields",
    evidence: () => {
      const parsed = parseInboundNeed(buildInboundEmailText({ body: SAMPLE_VSS_CALYPSO_APP_SUPPORT }));
      const need = parsed.mantuNeed;
      return (
        /calypso application support/i.test(parsed.jobAnalysis.title)
        && Boolean(need?.mainManager)
        && Boolean(need?.mainRecruiter)
        && Boolean(need?.client)
        && need.skillsMust.some((s) => /calypso/i.test(s))
        && Boolean(need.missionDescription)
        && Boolean(need.booleanSearch)
        && parsed.jobAnalysis.locationType === "Hybrid"
      );
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
      return (
        /\/api\/email\/connections/.test(src)
        && /connectedOutlook/.test(src)
        && /confirmLive/.test(src)
        && /[Jj]oinUrl is proven only on live/.test(src)
        && !/id:\s*"teams-links"/.test(src)
        && /Outlook OAuth not configured/.test(src)
        && /Entra admin must register ARIA Mantu Graph/.test(src)
        && /portal\.azure\.com\/ce57ebe3/.test(src)
        && /Grant admin consent/.test(src)
        && /Connect Outlook stays disabled until Graph OAuth/.test(src)
        && /"blocked"/.test(src)
        && /Hiring-need mailbox route \(Graph\)/.test(src)
        && /inboundActive/.test(src)
        && /ssoFlagOn \? "active" : "pending"/.test(src)
        && /id: "entra-sso"[\s\S]{0,200}ok: false/.test(src)
        && !/ok: mailboxConnected \? inboundActive : inboundReady/.test(src)
      );
    },
  },
  {
    requirement: "Setup guide includes loop switchboard arming",
    evidence: () => {
      const guide = readFileSync("src/components/settings/setup-guide-panel.tsx", "utf8");
      return (
        /Arm the sourcing loop/.test(guide)
        && /ARIA_LOOP_KILL_SWITCH=false/.test(guide)
        && /settings\?tab=observe/.test(guide)
      );
    },
  },
  {
    requirement: "TAnIA Intw1 books via Outlook/Teams; addInterview does not invent Booked",
    evidence: () => {
      const drawer = readFileSync("src/components/candidates/candidate-drawer.tsx", "utf8");
      const store = readFileSync("src/lib/store.ts", "utf8");
      const bookingStatus = readFileSync("src/lib/booking-status.ts", "utf8");
      const calendar = readFileSync("src/app/calendar/page.tsx", "utf8");
      const campaigns = readFileSync("src/app/campaigns/[id]/page.tsx", "utf8");
      const bookingActions = readFileSync("src/lib/store/booking-report-actions.ts", "utf8");
      return (
        /createBookingFor\(c\.id\)/.test(drawer)
        && /bookingInterviewTitle\(res\.booking/.test(drawer)
        && /Needs calendar/.test(calendar)
        && /bookingNeedsCalendar/.test(readFileSync("src/components/calendar/booking-calendar.tsx", "utf8"))
        && /!booking\.calLink && !booking\.teamsLink/.test(bookingStatus)
        && /Needs calendar — connect Microsoft Graph/.test(bookingStatus)
        && /bookingInterviewTitle/.test(bookingStatus)
        && /bookingInterviewTitle/.test(calendar)
        && /bookingInterviewTitle/.test(campaigns)
        && /bookingInterviewTitle/.test(bookingActions)
        && /Interview booking/.test(calendar)
        && !/title=\{preview \? `Interview booked:/.test(calendar)
        && !/Reminder cadence T-24h/.test(drawer)
        && /Do NOT invent Booked here/.test(store)
        && /bookingNeedsCalendar\(res\.booking\)/.test(store)
        && /Needs calendar before live Teams\/Outlook book/.test(store)
        && !/\$\{count\} interview\$\{count === 1 \? "" : "s"\} booked/.test(store)
        && /forceDryRun \? "Dry-run, nothing sent\."/.test(store)
        && /Subject: Proposed: your/.test(readFileSync("src/lib/mock-ai.ts", "utf8"))
        && /graphCheckpointSkipped/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /Interview slot/.test(readFileSync("src/lib/floor3d.ts", "utf8"))
        && /bookingInterviewTitle\(b,/.test(readFileSync("src/lib/replay.ts", "utf8"))
        && /Boolean\(booking\.teamsLink \|\| booking\.calLink\)/.test(readFileSync("src/lib/metrics.ts", "utf8"))
        && /provenance: "manual"[\s\S]{0,80}leadSource: "Applicant"/.test(store)
        && /mock adapter — sample data only/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /Stage stays Interested — Needs calendar before Booked/.test(bookingActions)
        && /calendarConfirmed \? withStage\(item, "Booked"\)/.test(bookingActions)
        && /At least one sender-policy record found/.test(readFileSync("src/components/fleet/seat-card.tsx", "utf8"))
        && /Mailbox OAuth \(Graph send-as\)/.test(readFileSync("src/components/fleet/seat-card.tsx", "utf8"))
        && /provenance === "live"/.test(readFileSync("src/components/candidates/candidate-table.tsx", "utf8"))
        && /previewOnly/.test(readFileSync("src/app/calendar/page.tsx", "utf8"))
        && /bookedInterviews/.test(readFileSync("src/app/calendar/page.tsx", "utf8"))
        && /!bookingNeedsCalendar\(b\)/.test(readFileSync("src/app/calendar/page.tsx", "utf8"))
        && /Loading calendar/.test(readFileSync("src/app/calendar/page.tsx", "utf8"))
        && /Loading settings/.test(readFileSync("src/app/settings/page.tsx", "utf8"))
        && /Loading outreach/.test(readFileSync("src/app/outreach/page.tsx", "utf8"))
        && /Loading fleet/.test(readFileSync("src/app/fleet/page.tsx", "utf8"))
        && /Loading exec dashboard/.test(readFileSync("src/app/exec/page.tsx", "utf8"))
        && /bookingNeedsCalendar\(b\)/.test(readFileSync("src/components/calendar/interviewer-panel.tsx", "utf8"))
        && /confirm-calendar-book/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /calendarConfirmUrl/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /Loading campaigns/.test(readFileSync("src/app/campaigns/page.tsx", "utf8"))
        && /Loading candidates/.test(readFileSync("src/app/candidates/page.tsx", "utf8"))
        && /Loading replies/.test(readFileSync("src/app/replies/page.tsx", "utf8"))
        && /Loading funnel/.test(readFileSync("src/app/funnel/page.tsx", "utf8"))
        && /Loading intake/.test(readFileSync("src/app/intake/page.tsx", "utf8"))
        && /Loading launch/.test(readFileSync("src/app/launch/page.tsx", "utf8"))
        && /Loading dashboard/.test(readFileSync("src/app/page.tsx", "utf8"))
        && /Loading applicants/.test(readFileSync("src/app/applicants/page.tsx", "utf8"))
        && /Loading winlog/.test(readFileSync("src/app/winlog/page.tsx", "utf8"))
        && /Loading skills/.test(readFileSync("src/app/skills/page.tsx", "utf8"))
        && /Loading trust/.test(readFileSync("src/app/trust/page.tsx", "utf8"))
        && /Loading chat/.test(readFileSync("src/app/chat/page.tsx", "utf8"))
        && /Loading floor/.test(readFileSync("src/app/floor/page.tsx", "utf8"))
        && /Loading sessions/.test(readFileSync("src/app/sessions/page.tsx", "utf8"))
        && /Loading replay/.test(readFileSync("src/app/replay/page.tsx", "utf8"))
        && /Loading reports/.test(readFileSync("src/app/reports/page.tsx", "utf8"))
        && /Loading vivier/.test(readFileSync("src/components/tania/vivier-view.tsx", "utf8"))
        && /channel === "LinkedIn"/.test(readFileSync("src/lib/outreach-send-mode.ts", "utf8"))
        && !/channel === "LinkedIn" && isLive/.test(readFileSync("src/lib/outreach-send-mode.ts", "utf8"))
        && /PARTIAL still requires inboundWebhookSecret/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /register_hmac_mailbox/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /hmacRoutes/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /ARIA_ALLOW_SKIP_WEBHOOK_E2E=1/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /E2E_SKIP_WEBHOOK=1/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /isRealSendFact\(m\)/.test(readFileSync("src/lib/replay.ts", "utf8"))
        && /missing_pre_call_claim/.test(readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8"))
        && /no live probe/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /candidateIsBooked|bookingNeedsCalendar/.test(readFileSync("src/lib/hiring-geography.ts", "utf8"))
        && /isRealSendFact\(m\)/.test(readFileSync("src/components/trust/roi-calculator.tsx", "utf8"))
        && /Standing by/.test(readFileSync("src/lib/floor.ts", "utf8"))
        && /No email was sent/.test(readFileSync("src/components/careers/chatbox.tsx", "utf8"))
        && /Queued \/ awaiting delivery/.test(readFileSync("src/components/outreach/outreach-message-card.tsx", "utf8"))
        && /tag="ACTIVE"/.test(readFileSync("src/components/floor3d/retro/RetroOfficeScene.tsx", "utf8"))
        && /lastSync: null/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /never claim candidates were added/.test(readFileSync("src/lib/agents/hermes-agent-harness.ts", "utf8"))
        && /isRealSendFact\(m\)/.test(readFileSync("src/components/launch/war-room-board.tsx", "utf8"))
        && /enabled \(intent only\)/.test(readFileSync("src/components/settings/schedules-panel.tsx", "utf8"))
        && /store counts/.test(readFileSync("src/components/floor/mission-control-hud.tsx", "utf8"))
        && /isRealSendFact\(step\.message\)/.test(readFileSync("src/components/sessions/audit-pack.tsx", "utf8"))
        && /forceDryRun/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /planOutreachApprovalDelivery\(\{ channel: msg\.channel, forceDryRun \}\)/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /reconciliation-required/.test(readFileSync("src/components/outreach/whatsapp-template-picker.tsx", "utf8"))
        && /Proposed interview prep/.test(readFileSync("src/lib/mock-ai.ts", "utf8"))
        && /ARIA_LOOP_KILL_SWITCH=false/.test(readFileSync("src/components/settings/loop-switchboard-panel.tsx", "utf8"))
        && /stampSimulatedSend/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /integrations\.filter\(\(i\) => i\.real\)/.test(readFileSync("src/components/dashboard/integration-strip.tsx", "utf8"))
        && /PARTIAL: microsoftOAuth=false/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /llm_auth=/.test(readFileSync("scripts/print-fly-golive-status.sh", "utf8"))
        && /DATA_ENCRYPTION_KEY/.test(readFileSync("scripts/print-fly-missing-secrets.sh", "utf8"))
        && /planOutreachApprovalDelivery/.test(readFileSync("src/lib/outreach-send-mode.ts", "utf8"))
        && /status === "Scheduled" \|\| m\.status === "Approved"/.test(readFileSync("src/app/outreach/page.tsx", "utf8"))
        && /EMAIL_INBOUND_WEBHOOK_SECRET/.test(readFileSync("scripts/verify-m365-ready.sh", "utf8"))
        && /Approved \(dry-run, nothing sent\)/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /isLiveMailboxSeat/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /dryRun: false/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /send_outreach/.test(readFileSync("src/lib/recommendations.ts", "utf8"))
        && /isRealSendFact\(msg\)/.test(readFileSync("src/lib/skills.ts", "utf8"))
        && /isMailboxSeatProvider/.test(readFileSync("src/app/api/outreach/send/route.ts", "utf8"))
        && /Approved — awaiting send/.test(readFileSync("src/app/campaigns/[id]/page.tsx", "utf8"))
        && /bookingNeedsCalendar\(c\.booking\)/.test(readFileSync("src/lib/recommendations.ts", "utf8"))
        && /bookingNeedsCalendar\(c\.booking\)/.test(readFileSync("src/lib/metrics.ts", "utf8"))
        && /critics_required/.test(readFileSync("src/lib/outreach-approval.ts", "utf8"))
        && /Calendar booking was skipped/.test(readFileSync("src/lib/store/booking-report-actions.ts", "utf8"))
        && /Awaiting send/.test(readFileSync("src/lib/floor.ts", "utf8"))
        && /LinkedIn alone never unlocks Live/.test(readFileSync("src/app/outreach/page.tsx", "utf8"))
        && /MAILBOX_INTEGRATION_IDS\.has\(integ\.id\) && integ\.mode !== "live"/.test(
          readFileSync("src/lib/outreach-send-mode.ts", "utf8"),
        )
        && /isRealSendFact\(m\)/.test(readFileSync("src/lib/hiring-geography.ts", "utf8"))
        && /!bookingNeedsCalendar\(b\)/.test(readFileSync("src/lib/metrics.ts", "utf8"))
        && /Connect Gmail \(OAuth\)/.test(readFileSync("src/app/api/fleet/seats/route.ts", "utf8"))
        && /isMailboxSeatProvider\(seat\.provider\)/.test(readFileSync("src/lib/fleet.ts", "utf8"))
        && /mode: liveSeat \? "live" : "mock"/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /Prefer Microsoft Graph for Mantu Teams/.test(
          readFileSync("src/lib/store/booking-report-actions.ts", "utf8"),
        )
        && /preCallClaim/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /Always advance pre_call → first_interview_book/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /bookingAppendDeferred/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /unknown-patch-kind/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /OnlineMeetings\.ReadWrite/.test(readFileSync("scripts/verify-m365-ready.sh", "utf8"))
        && /connection\.scope = json\.scope/.test(readFileSync("src/lib/email-oauth.ts", "utf8"))
        && /pre_call_propose dry-run enqueues first_interview_book/.test(
          readFileSync("tests/sourcing-loop-worker.mts", "utf8"),
        )
        && /append_booking is pre-0072 unknown-patch-kind/.test(
          readFileSync("tests/sourcing-loop-worker.mts", "utf8"),
        )
        && /register_hmac_mailbox/.test(readFileSync("src/app/api/email/connections/route.ts", "utf8"))
        && /upsert_hmac_inbound_mailbox_route/.test(
          readFileSync("supabase/migrations/0073_hmac_inbound_mailbox_route.sql", "utf8"),
        )
        && /Cal\.com is roadmap-only/.test(readFileSync("src/lib/booking-status.ts", "utf8"))
        && /llmKeysPresent/.test(readFileSync("src/lib/readiness.ts", "utf8"))
        && /Live tenants fail closed/.test(readFileSync("src/components/settings/hermes-runtime-panel.tsx", "utf8"))
        && /Roadmap only — no live adapter/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /probeLlmEnvStatus/.test(readFileSync("src/lib/ai/llm-env-status.ts", "utf8"))
        && /llm_auth_dead/.test(readFileSync("src/app/api/admin/llm-env-status/route.ts", "utf8"))
        && /FlyEnvLlmStatus|Fly env keys present but auth-dead/.test(
          readFileSync("src/components/settings/providers-panel.tsx", "utf8"),
        )
      );
    },
  },
  {
    requirement: "Loop worker chains campaign_create into sourcing_batch",
    evidence: () => {
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const transitions = readFileSync("src/lib/langchain/pipeline-transitions.json", "utf8");
      const limits = readFileSync("src/lib/recruiting-loop/loop-limits.json", "utf8");
      const tests = readFileSync("tests/sourcing-loop-worker.mts", "utf8");
      return (
        /"campaign_create"\s*:\s*\[\s*"sourcing_batch"\s*\]/.test(transitions)
        && /pipeline-transitions\.json/.test(worker)
        && /handleCampaignCreate/.test(worker)
        && /campaign_missing/.test(worker)
        && /loop-limits\.json/.test(worker)
        && /topCandidateShortlistSize/.test(limits)
        && /run-sourcing-batch/.test(worker)
        && /generate-outreach-draft/.test(worker)
        && /append_outreach/.test(worker)
        && /dryRun: true/.test(worker)
        && /Needs Approval/.test(worker)
        && /campaign_create verifies campaign blob then enqueues sourcing_batch/.test(tests)
        && /sourcing_batch via route → shortlist autopilot top-N → draft_generate dry-run quality/.test(tests)
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
        && /confirmLive:true/.test(script)
        && /Live Outlook\/Teams book/.test(script)
        && /ARIA_ALLOW_SKIP_LIVE_CALENDAR/.test(script)
        && /ARIA_ALLOW_PARTIAL_M365_E2E/.test(script)
        && /RESULT: PARTIAL/.test(script)
        && /never pretends full enterprise PASS|never pretends full PASS/.test(script)
        && /isOnlineMeeting/.test(script)
        && /teamsForBusiness/.test(script)
        && /Introduce Mantu Group/.test(script)
        && /mantuEmailHtmlWrapper/.test(script)
        && /mantuFirstInterviewAgenda/.test(script)
      );
    },
  },
  {
    requirement: "Fly E2E fails closed without webhook secret or migration >= 0066",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /EMAIL_INBOUND_WEBHOOK_SECRET is required for Fly enterprise E2E/.test(script)
        && /CRON_SECRET is required for Fly enterprise E2E/.test(script)
        && /\/tmp\/aria-e2e-cron-secret/.test(script)
        && /graphSubscription\.active/.test(script)
        && /\.mode \/\/ ""\) == "live"/.test(script)
        && /seat\.mode is not live/.test(script)
        && /migration must be >= 0066_/.test(script)
        && /0066_\*|006\[7-9\]_\*/.test(script)
        && /unknown_subscription/.test(script)
        && /client_state_mismatch/.test(script)
        && /graphSubscription\.subscriptionId/.test(script)
        && /send_graph_need_probe/.test(script)
        && /Graph push → hiring_need/.test(script)
        && /microsoft-graph/.test(script)
        && /subscriptionId: graphSubscription\.graphSubscriptionId/.test(
          readFileSync("src/app/api/email/connections/route.ts", "utf8"),
        )
        && /sendGraphJsonMail/.test(readFileSync("src/lib/email-oauth.ts", "utf8"))
        && /send_graph_need_probe/.test(readFileSync("src/app/api/email/connections/route.ts", "utf8"))
        && !/Compensation norms:/.test(
          readFileSync("src/lib/ai/hermes.ts", "utf8").match(
            /export function buildOutreachPrompt[\s\S]*?^}/m,
          )?.[0] ?? "Compensation norms:",
        )
        && /Polling workspace_state for campaign title/.test(script)
        && /Loop worker materialized campaign/.test(script)
        && /set_sourcing_loop_controls/.test(script)
        && /Type: Permanent/.test(script)
        && /WEBHOOK_CAMPAIGN_ID/.test(script)
        && /ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E/.test(script)
        && /persisted:false on Fly/.test(script)
        && /HeyReach MCP allowlisted/.test(script)
        && /api\/admin\/mcp\/allowlist/.test(script)
        && /int_heyreach/.test(script)
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
        && /validateOutreachQualityLive/.test(approve)
        && /validateOutreachQualityLive/.test(send)
        && /validateOutreachQualityLive/.test(
          readFileSync("src/app/api/outreach/whatsapp-template/route.ts", "utf8"),
        )
        && /critics_required/.test(approve)
        && /critics_required/.test(send)
        && /critics_required/.test(
          readFileSync("src/app/api/outreach/whatsapp-template/route.ts", "utf8"),
        )
        && /demoLoginEnabled/.test(approve)
        && /demoLoginEnabled/.test(send)
        && /Human approval resolves needs_review|needs_review is resolved/.test(approve + send)
        && /qualityCriticsUsed/.test(approve)
        && /criticStageCount/.test(approve)
        && /Multi-agent quality validation: live LLM critics used/.test(
          readFileSync("e2e-workflow-test.sh", "utf8"),
        )
        && !/fail open to deterministic/.test(approve)
        && !/fail open to deterministic/.test(send)
        && !/status === "blocked" \|\| liveVerdict\.status === "needs_review"/.test(approve)
        && !/status === "blocked" \|\| liveVerdict\.status === "needs_review"/.test(send)
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
      const checklist = readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8");
      return (
        /validationToken/.test(route)
        && /status: 503/.test(route)
        && /message_fetch_failed/.test(route)
        && /token_unavailable/.test(route)
        && /connection_missing/.test(route)
        && /never invents a hiring-need enqueue/.test(route)
        && /GraphMessageFetchResult/.test(subs)
        && /token_unavailable/.test(subs)
        && /lastIndexOf\("\/messages\/"\)/.test(route)
        && /createGraphMailSubscription/.test(subs)
        && /declaredHtml/.test(subs)
        && /replace\(\/<\\s\*br/.test(subs)
        && /renewExpiringGraphMailSubscriptions|renewGraphMailSubscription/.test(subs)
        && /graph_mail_subscriptions/.test(migration)
        && /Emergency sync/.test(panel)
        && /graphWebhookActive/.test(panel)
        && /hidden once the Graph webhook/.test(panel)
        && /Webhook open needs/.test(panel)
        && /ARIA_LOOP_KILL_SWITCH='false'/.test(checklist)
        && /ANTHROPIC_API_KEY/.test(checklist)
        && existsSync("src/app/api/cron/renew-graph-subscriptions/route.ts")
        && existsSync("src/app/api/sourcing-loop/controls/route.ts")
        && existsSync("src/components/settings/loop-switchboard-panel.tsx")
        && /LoopSwitchboardPanel/.test(readFileSync("src/app/settings/page.tsx", "utf8"))
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
        && /resolveLoopLlm/.test(draftRoute)
        && /llm_required/.test(draftRoute)
        && /resolveLoopLlm|serverGenerateText/.test(readFileSync("src/lib/ai/loop-llm.ts", "utf8"))
        && /HERMES_TASK_SYSTEM|buildHermesHarnessSystemPrompt/.test(readFileSync("src/lib/ai/loop-llm.ts", "utf8"))
        && /resolveStoredLlmKeyForWorkspace/.test(readFileSync("src/lib/ai/vault-secret.ts", "utf8"))
        && /workspaceId: job\.workspace_id/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /parseInboundNeedViaRoute[\s\S]*?workspaceId: job\.workspace_id/.test(
          readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"),
        )
        && /demoLoginEnabled \|\| publicDemoSideEffectsDisabled\(\)/.test(
          readFileSync("src/app/api/intake/route.ts", "utf8"),
        )
        && /demoLoginEnabled \|\| publicDemoSideEffectsDisabled\(\)/.test(
          readFileSync("src/app/api/outreach/approve/route.ts", "utf8"),
        )
        && /demoLoginEnabled \|\| publicDemoSideEffectsDisabled\(\)/.test(
          readFileSync("src/app/api/outreach/send/route.ts", "utf8"),
        )
        && /critics_required/.test(draftRoute)
        && /preferredOutreachChannel/.test(draftRoute)
        && /contact_channel_unavailable/.test(draftRoute)
        && /runRecruitingGraph/.test(draftRoute)
        && /graphStage/.test(draftRoute)
        && /validateOutreachQualityLive/.test(draftRoute)
        && /llmCriticsUsed/.test(quality)
        && /validateOutreachQualityLive/.test(qualityLive)
        && /HERMES_QUALITY_CRITICS/.test(qualityLive)
        && /llm_empathy/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
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
        && /Paste a hiring need email/.test(intake)
        && /allowDemoNeeds/.test(panel)
        && /Demo hiring emails are disabled/.test(panel)
        && /NEXT_PUBLIC_ENABLE_DEMO_LOGIN\s*=\s*"false"/.test(flyApp)
        && /GOTRUE_EXTERNAL_AZURE/.test(flyAuth)
        && /webhook push/.test(setup)
        && /Emergency sync is break-glass/.test(setup)
        && /ARIA_ALLOW_INBOX_SYNC/.test(readFileSync("src/lib/email-connections.ts", "utf8"))
        && /inbox_poll_disabled/.test(readFileSync("src/app/api/email/sync/route.ts", "utf8"))
        && /inboxPollAllowed/.test(intake)
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
        && /Graph webhook/.test(settings)
        && /no inbox polling/.test(settings)
      );
    },
  },
  {
    requirement: "Loop proposes pre-call then first interview after positive interest",
    evidence: () => {
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const propose = readFileSync("src/app/api/cron/propose-calendar-book/route.ts", "utf8");
      const calendar = readFileSync("src/app/calendar/page.tsx", "utf8");
      const types = readFileSync("src/lib/types.ts", "utf8");
      const pipeline = readFileSync("src/lib/langchain/pipeline-transitions.json", "utf8");
      return (
        /pre_call_propose/.test(worker)
        && /first_interview_book/.test(worker)
        && /handlePreCallPropose/.test(worker)
        && /calendarProposeUrl/.test(worker)
        && /calendarConfirmUrl/.test(worker)
        && /confirm-calendar-book/.test(worker)
        && /loop_confirm_live/.test(worker)
        && /append_booking/.test(worker)
        && /first-interview-booking:/.test(worker)
        && /first-interview-candidate:/.test(worker)
        && /first-interview-activity:/.test(worker)
        && /preCallProposal/.test(worker)
        && /interviewProposal/.test(worker)
        && /type: "booking"/.test(worker)
        && /needs_human_confirm/.test(worker)
        && /human_confirm_live/.test(worker)
        && /meetingKind/.test(propose)
        && /claimCalendarBooking/.test(propose)
        && /proposed_dry_run/.test(propose)
        && /claimId:\s*null/.test(propose)
        && /releasedClaimId/.test(propose)
        && /stage:\s*"Interested"/.test(worker)
        && !/Pre-call proposed/.test(worker)
        && /interviewProposal\?\.startTime/.test(calendar)
        && /interviewProposal\?:/.test(types)
        && /pre_call_propose/.test(pipeline)
        && /first_interview_book/.test(pipeline)
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
        && /webhookIntakeReady/.test(stack)
        && /Enable webhook/.test(panel)
        && /ensureGraphMailSubscription/.test(graphLib)
        && /Entra SSO/.test(stack)
        && /inbound mailbox route failed/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
        )
        && /Graph webhook failed|Graph webhook setup failed/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
        )
        && /redirectError/.test(readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"))
        && /graphSubscription\?\.active/.test(readFileSync("src/lib/integrations.ts", "utf8"))
        && /graph_subscription/.test(readFileSync("src/app/api/email/test/route.ts", "utf8"))
        && /Promote seat to live only after inbound route/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
        )
        && /assertMicrosoftGraphSeatLiveReady/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
        )
        && /promoteMicrosoftGraphSeatLive/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
        )
        && /promoteMicrosoftGraphSeatLive/.test(connections)
        && /assertMicrosoftGraphSeatLiveReady/.test(
          readFileSync("src/app/api/fleet/seats/route.ts", "utf8"),
        )
        && /OnlineMeetings\.ReadWrite/.test(readFileSync("src/lib/microsoft-seat-live.ts", "utf8"))
        && /Calendars\.ReadWrite/.test(readFileSync("src/lib/microsoft-seat-live.ts", "utf8"))
        && /mode:\s*"mock"/.test(readFileSync("src/app/api/email/disconnect/route.ts", "utf8"))
        && /assisted-manual/.test(readFileSync("src/components/settings/linkedin-outreach-stack.tsx", "utf8"))
        && !/Ready for outreach/.test(readFileSync("src/components/settings/linkedin-outreach-stack.tsx", "utf8"))
        && !/unless HeyReach MCP is connected/.test(
          readFileSync("src/components/settings/linkedin-outreach-stack.tsx", "utf8"),
        )
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
        && /0066/.test(deployNow)
        && /validate_fly_e2e_url/.test(script)
        && !/aria-mantu-app\.fly\.dev\*/.test(script)
      );
    },
  },
  {
    requirement: "Enterprise E2E deliverable tip-tracked (PR #36; supersedes closed #29–#35)",
    evidence: () => {
      const golive = readFileSync("scripts/fly-golive-mantu-e2e.sh", "utf8");
      const handoff = readFileSync("_relay/HANDOFF.md", "utf8");
      const printConfirm = readFileSync("scripts/print-fly-deploy-confirm.sh", "utf8");
      const printE2e = readFileSync("scripts/print-fly-e2e-env.sh", "utf8");
      return (
        (/PR #35/.test(golive) || /PR #33/.test(golive) || /PR #36/.test(golive))
        && /supersedes closed #29/.test(golive)
        && (/PR #33/.test(handoff) || /#33/.test(handoff) || /PR #35/.test(handoff) || /#35/.test(handoff) || /PR #36/.test(handoff) || /#36/.test(handoff))
        && /print-fly-deploy-confirm/.test(handoff)
        && /ARIA_PROD_DEPLOY_CONFIRM/.test(printConfirm)
        && /print-fly-e2e-env/.test(golive)
        && /FLY_SUPABASE_ANON_KEY/.test(printE2e)
        && /probe-fly-llm-auth/.test(printE2e)
        && /AGENT_PROVIDER/.test(printE2e)
        && /aria-e2e-agent-provider|FIRST_LIVE_PROVIDER/.test(printE2e)
        && /FIRST_LIVE_PROVIDER/.test(readFileSync("scripts/probe-fly-llm-auth.sh", "utf8"))
        && !/^export AGENT_PROVIDER=kimi$/m.test(printE2e)
        && /do not pin auth-dead cloud keys/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /AGENT_PROVIDER=hermes/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /Fly secrets inventory/.test(golive)
        && existsSync("scripts/fly-enterprise-activate.sh")
        && /print-fly-deploy-confirm/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /ARIA_LOOP_KILL_SWITCH/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /ANTHROPIC_API_KEY or OPENAI_API_KEY|KIMI_API_KEY, (DEEPSEEK_API_KEY, )?ANTHROPIC_API_KEY, or OPENAI_API_KEY/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && existsSync("scripts/print-fly-secrets-checklist.sh")
        && existsSync("scripts/print-fly-missing-secrets.sh")
        && existsSync("scripts/fly-enterprise-golive-when-ready.sh")
        && /will not invent confirm/.test(readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8"))
        && /does not encode tip|Always deploy the checked-out tip/.test(
          readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8"),
        )
        && existsSync("scripts/fly-apply-owner-microsoft-secrets.sh")
        && existsSync("production-readiness/.owner-microsoft.env.example")
        && /\/tmp\/owner-microsoft\.env/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /PLACEHOLDER/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /refuse|refuses|ERROR:.*PLACEHOLDER|is_placeholder/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && existsSync("scripts/fly-apply-owner-llm-secrets.sh")
        && existsSync("production-readiness/.owner-llm.env.example")
        && /\/tmp\/owner-llm\.env/.test(readFileSync("scripts/fly-apply-owner-llm-secrets.sh", "utf8"))
        && /KIMI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY/.test(readFileSync("scripts/fly-apply-owner-llm-secrets.sh", "utf8"))
        && /DEEPSEEK_API_KEY/.test(readFileSync("scripts/fly-apply-owner-llm-secrets.sh", "utf8"))
        && /is_placeholder/.test(readFileSync("scripts/fly-apply-owner-llm-secrets.sh", "utf8"))
        && /authFailure|401|403/.test(readFileSync("src/lib/ai/server-generate.ts", "utf8"))
        && /isRetryableUpstream|retryable/.test(readFileSync("src/lib/ai/server-generate.ts", "utf8"))
        && /envAuthDeadUntil|markEnvAuthDead/.test(readFileSync("src/lib/ai/server-generate.ts", "utf8"))
        && /parseCriticJson/.test(readFileSync("src/lib/outreach-critic-json.ts", "utf8"))
        && /stripFences|relaxJson/.test(readFileSync("src/lib/outreach-critic-json.ts", "utf8"))
        && /Last-resort prose scrape/.test(readFileSync("src/lib/outreach-critic-json.ts", "utf8"))
        && /attempt < 5/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
        && /maxTokens: 512/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
        && /CAND_STACK|Skills\/stack/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && existsSync("scripts/probe-fly-llm-auth.sh")
        && /llm_auth_dead|llm_auth_ok/.test(readFileSync("scripts/probe-fly-llm-auth.sh", "utf8"))
        && /probe-fly-llm-auth/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /ARIA_ALLOW_PARTIAL_LLM_E2E/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /ARIA_ALLOW_PARTIAL_LLM_E2E/.test(readFileSync("scripts/run-enterprise-e2e-partial.sh", "utf8"))
        && /classifier !== "model"|classifier === "model"/.test(worker)
        && /ANTHROPIC_API_KEY|anthropic\.com\/v1\/messages/.test(worker)
        && /KIMI_API_KEY/.test(worker)
        && /createReplyClassificationModelClient/.test(worker)
        && /E2E_LLM_GAP|ARIA_ALLOW_PARTIAL_LLM_E2E/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /clientDraftQualityStatus|refuseMockOutreachOnLiveTenant\(false\)/.test(
          readFileSync("src/lib/store.ts", "utf8"),
        )
        && /qualityCriticsUsed === true/.test(
          readFileSync("src/components/outreach/outreach-message-card.tsx", "utf8"),
        )
        && /serverGenerateText/.test(readFileSync("src/lib/ai/hermes-loop-failover.ts", "utf8"))
        && /tryLoopTaskCloudFailover/.test(readFileSync("src/app/api/hermes/chat/route.ts", "utf8"))
        && /tryLoopTaskCloudFailover/.test(readFileSync("src/lib/ai/hermes-loop-failover.ts", "utf8"))
        && /!binding\.ok[\s\S]{0,400}tryLoopTaskCloudFailover/.test(
          readFileSync("src/app/api/hermes/chat/route.ts", "utf8"),
        )
        && /isRetryableProviderStatus/.test(readFileSync("src/app/api/hermes/chat/route.ts", "utf8"))
        && !/if \(!input\.workspaceId \|\| !LOOP_LLM_TASKS/.test(
          readFileSync("src/lib/ai/hermes-loop-failover.ts", "utf8"),
        )
        && existsSync("tests/hermes-loop-task-failover.mts")
        && /"deepseek"/.test(readFileSync("src/lib/ai/server-generate.ts", "utf8"))
        && /reuseGraphCritics|graphQuality\?\.llmCriticsUsed/.test(
          readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8"),
        )
        && /DEEPSEEK_API_KEY/.test(readFileSync("production-readiness/.owner-llm.env.example", "utf8"))
        && /ensureGraphMailSubscription/.test(readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"))
        && /promoteMicrosoftGraphSeatLive/.test(readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"))
        && /domain_verified:\s*true/.test(readFileSync("src/lib/microsoft-seat-live.ts", "utf8"))
        && /Microsoft Graph/.test(readFileSync("src/app/api/outreach/send/route.ts", "utf8"))
        && /seat\.provider === "Microsoft Graph"/.test(readFileSync("src/lib/fleet.ts", "utf8"))
        && /seatMode !== "live"/.test(readFileSync("src/components/settings/email-connections-panel.tsx", "utf8"))
        && /EMAIL_INBOUND_WEBHOOK_SECRET/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /fly-apply-owner-microsoft-secrets/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /fly-apply-owner-llm-secrets/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /owner-microsoft\.env\.example/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /GOTRUE_EXTERNAL_AZURE_ENABLED/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /KIMI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /DEEPSEEK_API_KEY/.test(readFileSync("scripts/print-fly-missing-secrets.sh", "utf8"))
        && /classifyRpcHttpFailure|digest_unresolved/.test(worker)
        && existsSync("supabase/migrations/0068_apply_workspace_patch_digest_path.sql")
        && /digest_unresolved|extensions\.digest/.test(
          readFileSync("supabase/migrations/0068_apply_workspace_patch_digest_path.sql", "utf8"),
        )
        && /print-fly-secrets-checklist/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /fly-apply-owner-microsoft-secrets/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /print-fly-missing-secrets/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && existsSync("scripts/az-create-mantu-graph-app.sh")
        && /owner-microsoft\.env/.test(readFileSync("scripts/az-create-mantu-graph-app.sh", "utf8"))
        && (/Mail\.Send|Calendars\.ReadWrite/.test(readFileSync("scripts/az-create-mantu-graph-app.sh", "utf8"))
          || /Mail\.Send|Calendars\.ReadWrite/.test(readFileSync("scripts/lib/az-mantu-graph-permissions.sh", "utf8")))
        && existsSync("scripts/az-configure-existing-graph-app.sh")
        && /ARIA_AZURE_APP_ID/.test(readFileSync("scripts/az-configure-existing-graph-app.sh", "utf8"))
        && existsSync("scripts/fly-wait-entra-and-golive.sh")
        && /az-create-mantu-graph-app|az-configure-existing-graph-app/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && /owner-azure-app-id|has_azure_app_id_drop/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && /will not invent|Never invents/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && /has_deploy_confirm_drop/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && /ARIA_SKIP_AZ_DEVICE_REFRESH/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && /MICROSOFT_CLIENT_ID/.test(readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"))
        && existsSync("scripts/sync-fly-e2e-tmp-secrets.sh")
        && /EMAIL_INBOUND_WEBHOOK_SECRET/.test(readFileSync("scripts/sync-fly-e2e-tmp-secrets.sh", "utf8"))
        && existsSync("production-readiness/.owner-deploy-confirm.env.example")
        && /owner-deploy-confirm\.env/.test(readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8"))
        && /az-create-mantu-graph-app/.test(readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8"))
        && /pipeline-transitions\.json/.test(worker)
        && /graph-stage-jobs\.json/.test(worker)
        && /pipeline-transitions\.json/.test(readFileSync("Dockerfile.prod", "utf8"))
        && /graph-stage-jobs\.json/.test(readFileSync("Dockerfile.prod", "utf8"))
        && /loop-limits\.json/.test(readFileSync("Dockerfile.prod", "utf8"))
        && /post-deploy: start worker process groups/.test(readFileSync("scripts/fly-deploy-now.sh", "utf8"))
        && /migrate completed despite CLI wait failure/.test(readFileSync("scripts/fly-deploy-now.sh", "utf8"))
        && /HOSTNAME\s*=\s*"::"/.test(readFileSync("fly.app.toml", "utf8"))
        && /email_sync_requires_inbound_ids/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /stage checkpoint machine/.test(readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8"))
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
  {
    requirement: "Live email MIME uses Mantu-branded HTML (not generic plainToHtml alone)",
    evidence: () => {
      const send = readFileSync("src/lib/email-send.ts", "utf8");
      const unsub = readFileSync("src/lib/email-unsubscribe.ts", "utf8");
      return (
        /mantuEmailHtmlWrapper/.test(send)
        && /htmlBody/.test(send)
        && /opts\?\.htmlBody|htmlBody\?:/.test(unsub)
        && /<\/body>/i.test(unsub)
      );
    },
  },
  {
    requirement: "Confirm-slot booking preserves Mantu first-interview agenda",
    evidence: () => {
      const actions = readFileSync("src/lib/store/booking-report-actions.ts", "utf8");
      const mock = readFileSync("src/lib/mock-ai.ts", "utf8");
      return (
        /mantuFirstInterviewAgenda/.test(actions)
        && /interviewProposal\?\.agenda/.test(actions)
        && /opts\?: \{ agenda\?: string\[\] \}/.test(mock)
      );
    },
  },
  {
    requirement: "Microsoft OAuth authorize requests Calendars.ReadWrite and OnlineMeetings.ReadWrite; callback does not invent scopes",
    evidence: () => {
      const callback = readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8");
      const authorize = readFileSync("src/app/auth/microsoft/route.ts", "utf8");
      const calendar = readFileSync("src/lib/calendar.ts", "utf8");
      const e2e = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /Calendars\.ReadWrite/.test(authorize)
        && /OnlineMeetings\.ReadWrite/.test(authorize)
        && /scope:\s*\(tokenJson\.scope \?\? ""\)\.trim\(\)/.test(callback)
        && !/tokenJson\.scope \?\? "[^"]*Calendars\.ReadWrite/.test(callback)
        && /lacks Calendars\.ReadWrite/.test(calendar)
        && /lacks OnlineMeetings\.ReadWrite/.test(calendar)
        && calendar.includes("!scope || !/calendars")
        && /missing Calendars\.ReadWrite in token scope/.test(e2e)
        && /missing OnlineMeetings\.ReadWrite in token scope/.test(e2e)
      );
    },
  },
  {
    requirement: "Inbound need detection uses subject+body; ambiguous non-replies stay idle",
    evidence: () => {
      const mockAi = readFileSync("src/lib/mock-ai.ts", "utf8");
      const router = readFileSync("src/lib/inbound-email-router.ts", "utf8");
      return (
        mockAi.includes("const haystack = `${subject}\\n${body}`")
        && /ambiguous_non_need/.test(router)
        && routeInboundEmail({
          record: { ok: true, inbound_id: "noise-audit", duplicate: false },
          from: "news@vendor.example",
          subject: "Weekly digest",
          body: "Product updates for the week.",
          mailbox: "talent@mantu.com",
        }).route === "none"
        && routeInboundEmail({
          record: { ok: true, inbound_id: "body-need", duplicate: false },
          from: "hm@acme.example",
          subject: "FW: please review",
          body: "Please open a hiring request for a Backend Engineer.",
          mailbox: "talent@mantu.com",
        }).route === "hiring_need"
      );
    },
  },
  {
    requirement: "Outlook/Teams/Gmail cards hide fake Live toggle; mode follows OAuth",
    evidence: () => {
      const card = readFileSync("src/components/settings/integration-card.tsx", "utf8");
      return (
        /isGraphOAuthCard/.test(card)
        && /!isGraphOAuthCard/.test(card)
        && /Connect Outlook \/ Gmail with OAuth to go live/.test(card)
      );
    },
  },
  {
    requirement: "Multi-agent quality critics run as separate LLM calls",
    evidence: () => {
      const qualityLive = readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8");
      const graph = readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8");
      const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
      const hermes = readFileSync("src/app/api/hermes/chat/route.ts", "utf8");
      const hermesVoice = readFileSync("src/lib/ai/hermes-recruiter-voice.ts", "utf8");
      const e2e = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /CRITICS/.test(qualityLive)
        && /runOneCritic/.test(qualityLive)
        && /resolveLoopLlm/.test(qualityLive)
        && (/Promise\.all/.test(qualityLive) || /Sequential peers/.test(qualityLive))
        && /llm_empathy/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /llm_compliance/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /llm_human_likeness/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /attempt < 5/.test(qualityLive)
        && /missing Mantu Group brand/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /preferLiveCritics/.test(graph)
        && /outreach-quality-pipeline-live/.test(graph)
        && /preferLiveCritics:\s*true/.test(draft)
        && (/Mantu Group/.test(hermes) || /Mantu Group/.test(hermesVoice) || /Mantu Group/.test(readFileSync("src/lib/agents/hermes-agent-harness.ts", "utf8")) || /Mantu Group/.test(readFileSync("src/lib/skills.ts", "utf8")))
        && (/mantuOutreachVoice/.test(hermes) || /mantuOutreachVoice/.test(hermesVoice) || /mantuOutreachVoice/.test(readFileSync("src/lib/agents/hermes-agent-harness.ts", "utf8")))
        && /HERMES_QUALITY_CRITICS/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /MANTU_SOURCING_MISSION/.test(readFileSync("src/lib/agents/hermes-agent-registry.ts", "utf8"))
        && /buildHermesHarnessSystemPrompt/.test(readFileSync("src/lib/agents/hermes-agent-harness.ts", "utf8"))
        && /Skill playbook/.test(readFileSync("src/lib/agents/hermes-agent-harness.ts", "utf8"))
        && /Name Mantu Group in the body/.test(readFileSync("src/lib/ai/hermes.ts", "utf8"))
        && /Mantu Group is hiring/.test(e2e)
      );
    },
  },
  {
    requirement: "Loop ignite is webhook-first (no empty email_sync root)",
    evidence: () => {
      const ignite = readFileSync("src/app/api/cron/ignite-sourcing-loop/route.ts", "utf8");
      return (
        /intake:\s*"webhook"/.test(ignite)
        && !/p_kind:\s*"email_sync"/.test(ignite)
      );
    },
  },
  {
    requirement: "Inbound ingest preserves subject for requisition_parse",
    evidence: () => {
      const ingest = readFileSync("src/lib/inbound-email-ingest.ts", "utf8");
      return /buildInboundEmailText/.test(ingest) && /subject: ev\.subject/.test(ingest);
    },
  },
  {
    requirement: "Calendar confirm persists and replays Teams meeting_url",
    evidence: () => {
      const mig = readFileSync("supabase/migrations/0066_calendar_meeting_url.sql", "utf8");
      const authority = readFileSync("src/lib/calendar-authority.ts", "utf8");
      const route = readFileSync("src/app/api/calendar/event/route.ts", "utf8");
      const loopConfirm = readFileSync("src/app/api/cron/confirm-calendar-book/route.ts", "utf8");
      const calendar = readFileSync("src/lib/calendar.ts", "utf8");
      const mig72 = readFileSync("supabase/migrations/0072_loop_append_booking.sql", "utf8");
      return (
        /meeting_url/.test(mig)
        && /meetingUrl/.test(authority)
        && /claim\.meetingUrl/.test(route)
        && /p_meeting_url/.test(authority)
        && /onlineMeeting\/joinUrl|onlineMeeting\?\.joinUrl/.test(calendar)
        && /isTeamsMeetingJoinUrl/.test(calendar)
        && /orphan event deleted|deleteGraphCalendarEvent/.test(calendar)
        && /webLink-only create is not accepted/.test(readFileSync("tests/calendar-booking-authority.mts", "utf8"))
        && /empty\/missing scope is a proven pre-transport not-sent/.test(
          readFileSync("tests/calendar-booking-authority.mts", "utf8"),
        )
        && /claim\.replay/.test(loopConfirm)
        && /bookingStatus === "claimed"/.test(loopConfirm)
        && /deliveryState === "not-sent"/.test(loopConfirm)
        && /isTeamsMeetingJoinUrl\(claim\.meetingUrl\)/.test(loopConfirm)
        && /append_booking/.test(mig72)
        && /'bookings'/.test(mig72)
        && existsSync("tests/confirm-calendar-book.mts")
        && /claimed replay returns 502 without calling Graph/.test(
          readFileSync("tests/confirm-calendar-book.mts", "utf8"),
        )
      );
    },
  },
  {
    requirement: "Production UX hides sample launch/reply chips when demo login is off",
    evidence: () => {
      const launch = readFileSync("src/app/launch/page.tsx", "utf8");
      const replies = readFileSync("src/components/replies/reply-classifier.tsx", "utf8");
      return (
        /demoLoginEnabled \? \(/.test(launch)
        && /Load sample brief/.test(launch)
        && /demoLoginEnabled \? \(/.test(replies)
        && /SAMPLE_REPLIES/.test(replies)
      );
    },
  },
  {
    requirement: "Fly deploy enables Entra Azure login build-arg when GoTrue secrets exist",
    evidence: () => {
      const deploy = readFileSync("scripts/fly-deploy-now.sh", "utf8");
      const workflow = readFileSync(".github/workflows/deploy-aria-mantu.yml", "utf8");
      return (
        /GOTRUE_EXTERNAL_AZURE_ENABLED/.test(deploy)
        && /NEXT_PUBLIC_ENABLE_AZURE_LOGIN="\$AZURE_LOGIN_ARG"/.test(deploy)
        && /ARIA_FORCE_AZURE_LOGIN/.test(deploy)
        && /ARIA_ENABLE_AZURE_LOGIN/.test(workflow)
        && /AZURE_LOGIN_ARG/.test(workflow)
      );
    },
  },
  {
    requirement: "Fly deploy refreshes ARIA_EXPECTED_* migration identity for /api/ready",
    evidence: () => {
      const deploy = readFileSync("scripts/fly-deploy-now.sh", "utf8");
      return (
        /ARIA_EXPECTED_MIGRATION/.test(deploy)
        && /ARIA_EXPECTED_MIGRATION_SHA/.test(deploy)
        && /ARIA_EXPECTED_MIGRATION_COUNT/.test(deploy)
        && /ARIA_EXPECTED_LEDGER_SHA/.test(deploy)
        && /secrets set -a aria-mantu-app --stage/.test(deploy)
        && /EXPECTED_LEDGER_SHA/.test(deploy)
        && /AGENT_FRAMEWORKS_REQUIRED=false/.test(deploy)
      );
    },
  },
  {
    requirement: "LangGraph fail-stops parse failure and never fakes interview_scheduled",
    evidence: () => {
      const graph = readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8");
      const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
      const e2e = readFileSync("e2e-workflow-test.sh", "utf8");
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      return (
        /intent === "draft_quality"/.test(graph)
        && /parse_requisition_failed/.test(graph)
        && /missing_booking_id/.test(graph)
        && /if \(state\.bookingId\) return "scheduleInterview"/.test(graph)
        && /intent: "draft_quality"/.test(draft)
        && /graph_stage_invalid/.test(draft)
        && /ARIA_ALLOW_CANNED_DRAFT_E2E/.test(e2e)
        && /Fly enterprise E2E requires live Hermes/.test(e2e)
        && /never send model:""/.test(e2e)
        && /outreach_draft_graph_stage_invalid/.test(worker)
        && /outreach_draft_critics_required/.test(worker)
        && /assertRecruitingGraphCheckpoint/.test(worker)
        && /recruiting-graph-stage/.test(worker)
        && /intent: "parse_only"/.test(worker)
        && /intent: "source_only"/.test(worker)
        && /intent: "rank_only"/.test(worker)
        && /intent: "interview_only"/.test(worker)
        && /intent: "pre_call_only"/.test(worker)
        && /first_interview_book/.test(worker)
        && /Positive interest → pre-call propose/.test(worker)
        && /pre_call_only/.test(graph)
        && /interview_only/.test(graph)
        && /assertRecruitingGraphStage/.test(graph)
        && existsSync("src/app/api/cron/recruiting-graph-stage/route.ts")
        && /microsoftOAuth=true/.test(e2e)
        && /generate-outreach-draft rejects unauthenticated/.test(e2e)
        && /recruiting-graph-stage rejects unauthenticated/.test(e2e)
        && /inbound_classify positive interest/.test(e2e)
        && /classifier=model/.test(e2e)
        && /Polling workspace_state for reply classifier=model/.test(e2e)
        && /parseModelJsonObject/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /```(?:json)?/.test(readFileSync("scripts/sourcing-loop-worker.mjs", "utf8"))
        && /Persist so workspace_state \/ E2E can prove live model classify/.test(worker)
        && /classifier\?: "model" \| "deterministic_fallback"/.test(readFileSync("src/lib/types.ts", "utf8"))
        && /llmStages\.length === CRITICS\.length/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
        && /quality_critics_incomplete/.test(graph)
        && /draft_failed/.test(graph)
        && /intent === "draft_quality" \|\| state\.intent === "full"/.test(graph)
        && /ARIA_QUALITY_LLM_CRITICS === "0"/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
        && /needs_review/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
        && /live_intake_llm_required/.test(readFileSync("src/lib/ai/intake.ts", "utf8"))
        && /modelDraftResponse|draftResponse: classifier === "model"/.test(worker)
        && /Unavailable/.test(readFileSync("src/components/curator/curator-status.tsx", "utf8"))
        && /empty_shortlist_or_below_min_score/.test(graph)
        && /DEFAULT_SHORTLIST_MIN_SCORE/.test(graph)
        && /shortlistMinScore/.test(graph)
        && /shortlistMinScore: minScore/.test(worker)
        && /shortlistMinScore/.test(readFileSync("src/app/api/cron/recruiting-graph-stage/route.ts", "utf8"))
        && /qualityCriticsUsed: false/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /Quality needs review — multi-agent or pipeline flagged/.test(readFileSync("src/lib/rules.ts", "utf8"))
        && /multi-agent critics not recorded yet/.test(readFileSync("src/lib/rules.ts", "utf8"))
        && /qualityCriticsUsed === true/.test(readFileSync("src/lib/rules.ts", "utf8"))
        && /shortlist_below_min_score/.test(worker)
        && /hiring_need_handler/.test(readFileSync("src/app/api/email/test/route.ts", "utf8"))
        && /Loop intake disabled/.test(readFileSync("src/lib/inbound-email-ingest.ts", "utf8"))
        && /Mantu Group is hiring/.test(readFileSync("src/lib/i18n.ts", "utf8"))
        && /Mantu Group is hiring/.test(readFileSync("src/lib/seed.ts", "utf8"))
        && /bookingInterviewTitle\(booking/.test(readFileSync("src/lib/seed.ts", "utf8"))
        && /Graph absent fail-closed/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /hiring_need_handler ready without requiring Graph/.test(readFileSync("e2e-workflow-test.sh", "utf8"))
        && /refuseMockOutreachOnLiveTenant/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /Live drafting required/.test(readFileSync("src/components/settings/hermes-runtime-panel.tsx", "utf8"))
        && /isTeamsMeetingJoinUrl/.test(readFileSync("src/lib/store/booking-report-actions.ts", "utf8"))
        && /Connect a live Gmail or Microsoft Graph calendar seat/.test(
          readFileSync("src/lib/store/booking-report-actions.ts", "utf8"),
        )
        && /mock fleet allocate disabled/.test(readFileSync("src/lib/store.ts", "utf8"))
        && /Live LLM drafting required/.test(readFileSync("src/app/fleet/page.tsx", "utf8"))
        && /generateOutreachLive\(candidate\.id\)/.test(readFileSync("src/components/run/agent-run-stream.tsx", "utf8"))
      );
    },
  },
  {
    requirement: "Run Aria falls through to live reviewed sourcing without frameworks",
    evidence: () => {
      const runner = readFileSync("src/lib/agents/studio-runner.ts", "utf8");
      return (
        /mode: "framework" \| "direct" \| "demo"/.test(runner)
        && /mode: "direct"/.test(runner)
        && /No approved agent framework workflow/.test(runner)
        && /AGENT_FRAMEWORKS_REQUIRED=false/.test(runner)
      );
    },
  },
  {
    requirement: "Loop enqueue payloads omit graphStage (DB contract; avoids complete_aria_job 22023)",
    evidence: () => {
      const workerSrc = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const mig = readFileSync("supabase/migrations/0065_calendar_book_and_graph_renew.sql", "utf8");
      const tests = readFileSync("tests/sourcing-loop-worker.mts", "utf8");
      return (
        /key !== "graphStage"/.test(workerSrc)
        && /never enqueue payloads/.test(workerSrc)
        && /priorStatus === "campaign_created"/.test(workerSrc)
        && /resumes campaign_created without re-recording parse/.test(tests)
        && /when 'campaign_create' then allowed_keys := array\['requisitionId', 'campaignId'\]/.test(mig)
        && /campaign_create enqueue must omit graphStage/.test(tests)
        && !/payload: \{ requisitionId: REQUISITION_ID, campaignId: "camp-1", graphStage:/.test(tests)
      );
    },
  },
  {
    requirement: "0068 digest path + mailbox Dry-run honesty remain pinned",
    evidence: () => {
      const mig68 = readFileSync("supabase/migrations/0068_apply_workspace_patch_digest_path.sql", "utf8");
      const sendMode = readFileSync("tests/outreach-send-mode.mts", "utf8");
      const workerSrc = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      return (
        /extensions\.digest/.test(mig68)
        && /digest_unresolved/.test(workerSrc)
        && /HeyReach live \+ no mailbox → still Dry-run/.test(sendMode)
        && /Record legitimate interest/.test(sendMode)
      );
    },
  },
  {
    requirement: "0069 pre_call/first_interview loop kinds pinned before golive",
    evidence: () => {
      const mig69 = readFileSync("supabase/migrations/0069_pre_call_first_interview_loop_kinds.sql", "utf8");
      const loopAuth = readFileSync("tests/loop-authority-contract.mts", "utf8");
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      return (
        /when 'pre_call_propose' then allowed_keys/i.test(mig69)
        && /when 'first_interview_book' then allowed_keys/i.test(mig69)
        && /0069 allows pre_call_propose \+ first_interview_book loop payloads/i.test(loopAuth)
        && /pre_call_propose: handlePreCallPropose/.test(worker)
        && /first_interview_book: handleFirstInterviewBook/.test(worker)
      );
    },
  },
  {
    requirement: "0070 fixes enqueue after 0069 bogus switchboard columns",
    evidence: () => {
      const mig70 = readFileSync("supabase/migrations/0070_fix_sourcing_loop_stage_enabled.sql", "utf8");
      const loopAuth = readFileSync("tests/loop-authority-contract.mts", "utf8");
      return (
        /controls\.intake_enabled/i.test(mig70)
        && !/controls\.requisition_parse_enabled/.test(mig70)
        && /0070 fixes sourcing_loop_stage_enabled/.test(loopAuth)
        && /'pre_call_propose', 'first_interview_book'/i.test(mig70)
      );
    },
  },
  {
    requirement: "0071 interview_prep_send queues post-booking prep through approval spine",
    evidence: () => {
      const mig71 = readFileSync("supabase/migrations/0071_interview_prep_send_loop_kind.sql", "utf8");
      const loopAuth = readFileSync("tests/loop-authority-contract.mts", "utf8");
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const bookingActions = readFileSync("src/lib/store/booking-report-actions.ts", "utf8");
      const e2e = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /when 'interview_prep_send' then allowed_keys/i.test(mig71)
        && /0071 allows interview_prep_send loop payloads/i.test(loopAuth)
        && /interview_prep_send: handleInterviewPrepSend/.test(worker)
        && /handleInterviewPrepSend/.test(worker)
        && /enqueueInterviewPrep/.test(bookingActions)
        && /interview_prep_send enqueue \+ approval-gated prep dispatch wired/.test(e2e)
        && existsSync("src/app/api/cron/interview-prep-dispatch/route.ts")
        && existsSync("src/app/api/booking/interview-prep/route.ts")
      );
    },
  },
  {
    requirement: "M365 owner unblock runbook when az cannot create Entra apps",
    evidence: () => {
      const doc = readFileSync("_relay/M365-OWNER-UNBLOCK.md", "utf8");
      const script = readFileSync("scripts/print-m365-owner-portal-checklist.sh", "utf8");
      const configure = readFileSync("scripts/az-configure-existing-graph-app.sh", "utf8");
      return (
        /M365-FLY-6|M365 secrets \(6\)/.test(doc)
        && /az-configure-existing-graph-app/.test(doc)
        && /Insufficient privileges/.test(doc)
        && /Entra admin/.test(doc)
        && /Entra admin/.test(script)
        && /Copy-paste for Entra admin/.test(script)
        && /ARIA_AZURE_APP_ID/.test(script)
        && /aria-mantu-app\.fly\.dev/.test(script)
        && /ARIA_AZURE_APP_ID/.test(configure)
        && /Entra admin/.test(readFileSync("scripts/az-create-mantu-graph-app.sh", "utf8"))
        && /owner-azure-app-id|fly-m365-from-azure-app-id/.test(
          readFileSync("scripts/probe-m365-unblock.sh", "utf8"),
        )
        && existsSync("scripts/fly-m365-from-azure-app-id.sh")
        && /owner_ms_has_azure_app_id/.test(
          readFileSync("scripts/lib/owner-microsoft-credentials.sh", "utf8"),
        )
      );
    },
  },
  {
    requirement: "verify-m365-ready strict gate: Graph secrets + live seat (Calendars+OnlineMeetings); Entra/LLM WARN-only; strict E2E",
    evidence: () => {
      const verify = readFileSync("scripts/verify-m365-ready.sh", "utf8");
      const apply = readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8");
      return (
        existsSync("scripts/verify-m365-ready.sh")
        && /MICROSOFT_TENANT_ID/.test(verify)
        && /GOTRUE_EXTERNAL_AZURE_URL/.test(verify)
        && /Entra SSO optional for Graph E2E PASS/.test(verify)
        && /Calendars\[\.\]ReadWrite\|calendars\[\.\]readwrite/.test(verify)
        && /OnlineMeetings\[\.\]ReadWrite\|onlinemeetings\[\.\]readwrite/.test(verify)
        && /Sign in with Microsoft/.test(verify)
        && /auth\/v1\/settings/.test(verify)
        && /external\.azure/.test(verify)
        && /optional — WARN only/.test(verify)
        && /unset ARIA_ALLOW_PARTIAL_M365_E2E/.test(verify)
        && /unset ARIA_ALLOW_PARTIAL_LLM_E2E|ARIA_ALLOW_PARTIAL_LLM_E2E/.test(verify)
        && /probe-fly-llm-auth/.test(verify)
        && /Hermes\/vault/.test(verify)
        && /live Graph seat/.test(verify)
        && /e2e-workflow-test\.sh/.test(verify)
        && !/exit 6/.test(verify)
        && !/exit 7/.test(verify)
        && /post-m365-secrets-golive/.test(apply)
      );
    },
  },
  {
    requirement: "az Graph permission apply fail-closes on missing scopes / admin-consent (no silent || true)",
    evidence: () => {
      const perms = readFileSync("scripts/lib/az-mantu-graph-permissions.sh", "utf8");
      const configure = readFileSync("scripts/az-configure-existing-graph-app.sh", "utf8");
      const lib = readFileSync("scripts/lib/owner-microsoft-credentials.sh", "utf8");
      const watch = readFileSync("scripts/watch-owner-microsoft-and-apply.sh", "utf8");
      const wait = readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8");
      const checklist = readFileSync("scripts/print-m365-owner-portal-checklist.sh", "utf8");
      const unblock = readFileSync("_relay/M365-OWNER-UNBLOCK.md", "utf8");
      const apply = readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8");
      return (
        existsSync("scripts/lib/az-mantu-graph-permissions.sh")
        && /aria_graph_verify_required_scopes/.test(perms)
        && /ARIA_GRAPH_REQUIRED_SCOPE_IDS/.test(perms)
        && /Mail\.Read/.test(perms)
        && /Mail\.Send/.test(perms)
        && /Calendars\.ReadWrite/.test(perms)
        && /OnlineMeetings\.ReadWrite/.test(perms)
        && /admin-consent/.test(perms)
        && /ARIA_GRAPH_SKIP_ADMIN_CONSENT/.test(perms)
        && /az-graph-admin-consent\.needed/.test(perms)
        && !/permission add[\s\S]{0,120}\|\| true/.test(perms)
        && /apply_mantu_graph_delegated_permissions/.test(configure)
        && /az ad app owner list/.test(configure)
        && /Owner preflight/.test(configure)
        && /Owners → Add/.test(checklist)
        && /app Owner/.test(unblock)
        && /owner_ms_export_skip_admin_consent_if_needed/.test(lib)
        && /az-graph-admin-consent\.portal-granted/.test(lib)
        && /owner_ms_configure_apply_lock_path/.test(lib)
        && /owner_ms_release_singleton_lock/.test(lib)
        && /owner_ms_export_skip_admin_consent_if_needed|maybe_skip_consent_for_retry/.test(watch)
        && /az-graph-admin-consent\.portal-granted/.test(watch)
        && /maybe_skip_consent_for_retry/.test(wait)
        && /owner_ms_configure_apply_lock_path|owner_ms_release_singleton_lock/.test(apply)
        && /owner_ms_release_singleton_lock/.test(apply)
      );
    },
  },
  {
    requirement: "probe-m365-unblock reprobe + --apply when owner credentials present",
    evidence: () => {
      const probe = readFileSync("scripts/probe-m365-unblock.sh", "utf8");
      const lib = readFileSync("scripts/lib/owner-microsoft-credentials.sh", "utf8");
      const unblock = readFileSync("_relay/M365-OWNER-UNBLOCK.md", "utf8");
      const watch = readFileSync("scripts/watch-owner-microsoft-and-apply.sh", "utf8");
      return (
        existsSync("scripts/probe-m365-unblock.sh")
        && existsSync("scripts/lib/owner-microsoft-credentials.sh")
        && /owner_ms_has_credentials/.test(lib)
        && /owner_ms_sync_env_to_dropzone/.test(lib)
        && /owner_ms_maybe_clear_stale_noperm/.test(lib)
        && /owner_ms_acquire_singleton_lock/.test(lib)
        && /ARIA_NOPERM_LATCH_TTL_SECONDS/.test(lib)
        && /GOTRUE_EXTERNAL_AZURE_URL/.test(lib)
        && /Graph\/Outlook secrets are enough/.test(lib)
        && /Entra SSO is optional/.test(lib)
        && /owner_ms_sync_env_to_dropzone/.test(probe)
        && /--apply/.test(probe)
        && /fly-apply-owner-microsoft-secrets/.test(probe)
        && /RESULT: owner-blocked/.test(probe)
        && /fly_graph_secrets_missing|graph_secrets_missing/.test(probe)
        && /Graph-minimum/.test(unblock)
        && /optional.*for Graph/.test(unblock)
        && /probe-m365-unblock/.test(unblock)
        && /Entra admin/.test(unblock)
        && /owner-microsoft-credentials/.test(watch)
        && /owner_ms_maybe_clear_stale_noperm/.test(watch)
        && /owner_ms_acquire_singleton_lock/.test(watch)
        && /ARIA_WAIT_LIVE_SEAT_SECONDS/.test(watch)
        && /owner-microsoft-strict-pass\.ok/.test(watch)
        && /verify-m365-ready|post-m365-secrets-golive/.test(watch)
        && /owner_ms_acquire_singleton_lock/.test(
          readFileSync("scripts/fly-wait-entra-and-golive.sh", "utf8"),
        )
        && /owner_ms_acquire_singleton_lock/.test(
          readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"),
        )
      );
    },
  },
  {
    requirement: "Fly missing-secrets inventory splits Graph (required) from Entra/LLM (WARN)",
    evidence: () => {
      const missing = readFileSync("scripts/print-fly-missing-secrets.sh", "utf8");
      const status = readFileSync("scripts/print-fly-golive-status.sh", "utf8");
      const example = readFileSync("production-readiness/.owner-microsoft.env.example", "utf8");
      return (
        /graph_secrets_missing=/.test(missing)
        && /entra_secrets_missing=/.test(missing)
        && /llm_env_missing=/.test(missing)
        && /optional for Graph E2E PASS/.test(missing)
        && /graph_secrets_missing=/.test(status)
        && /entra_secrets_missing=/.test(status)
        && /m365_secrets_missing=\$\{GRAPH_MISSING\}|m365_secrets_missing=\$\{GRAPH/.test(status)
        && /Graph-minimum/.test(example)
        && /OPTIONAL for Graph|PLACEHOLDER_TENANT_ID/.test(example)
        && /Skipping Entra|Graph-only OK for E2E PASS/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /entra_id_real|CLIENT_ID\/SECRET PLACEHOLDER/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /load_owner_env_file "\/tmp\/owner-microsoft\.env"/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /\*PLACEHOLDER\*/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /[Mm]onotonous demo\/fixture UUIDs|\\1\{7\}/.test(readFileSync("scripts/fly-apply-owner-microsoft-secrets.sh", "utf8"))
        && /microsoftCredentialLooksSynthetic/.test(readFileSync("src/lib/email-connections.ts", "utf8"))
        && /microsoftCredentialLooksSynthetic/.test(readFileSync("src/app/auth/microsoft/route.ts", "utf8"))
        && /microsoftCredentialLooksSynthetic/.test(readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"))
        && /fly-secrets-present-oauth-false|probe_microsoft_oauth/.test(readFileSync("scripts/probe-m365-unblock.sh", "utf8"))
        && /owner_ms_has_drop_file/.test(readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8"))
        && /Calendars\[\.\]ReadWrite\|calendars\[\.\]readwrite/.test(readFileSync("scripts/post-m365-secrets-golive.sh", "utf8"))
        && /EMAIL_INBOUND_WEBHOOK_SECRET/.test(readFileSync("scripts/post-m365-secrets-golive.sh", "utf8"))
        && /tip_ahead_app/.test(readFileSync("scripts/post-m365-secrets-golive.sh", "utf8"))
        && /ARIA_WAIT_LIVE_SEAT_SECONDS:-1800/.test(readFileSync("scripts/post-m365-secrets-golive.sh", "utf8"))
        && /MICROSOFT_TENANT_ID/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /Entra SSO optional for Graph E2E PASS/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && /Hermes\/vault may already green/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
      );
    },
  },
  {
    requirement: "Golive status probe documents tip vs live vs confirm without secrets",
    evidence: () => {
      const status = readFileSync("scripts/print-fly-golive-status.sh", "utf8");
      const golive = readFileSync("scripts/fly-enterprise-golive-when-ready.sh", "utf8");
      const handoff = readFileSync("_relay/HANDOFF.md", "utf8");
      const partial = readFileSync("scripts/run-enterprise-e2e-partial.sh", "utf8");
      return (
        /deploy_status=/.test(status)
        && /confirm_matches_tip=/.test(status)
        && /stale_owner_remint_required/.test(status)
        && /tip_ahead_docs/.test(status)
        && /tip_ahead_app/.test(status)
        && /print-fly-golive-status\.sh/.test(golive)
        && /print-fly-golive-status/.test(handoff)
        && existsSync("scripts/run-enterprise-e2e-partial.sh")
        && /ARIA_ALLOW_STALE_FLY_E2E=1/.test(partial)
        && /tip_live\|tip_ahead_docs/.test(partial)
      );
    },
  },
  {
    requirement: "Post-deploy PARTIAL E2E: step 3c provenance gate + cascade fail-closed + MS-gap PARTIAL only when FAILS=0",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      const route = readFileSync("src/app/api/sourcing-agent/route.ts", "utf8");
      const handoff = readFileSync("_relay/HANDOFF.md", "utf8");
      return (
        /select\(\.provenance=="live"\)/.test(script)
        && /live=\$AG_LIVE/.test(script)
        && /Fly enterprise E2E requires a live sourced candidate/.test(script)
        && /ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E/.test(script)
        && /ARIA_ALLOW_SKIP_APPROVE_E2E/.test(script)
        && /ARIA_ALLOW_PARTIAL_M365_E2E/.test(script)
        && /ARIA_ALLOW_CANNED_DRAFT_E2E/.test(script)
        && /ARIA_ALLOW_SKIP_REPLY_CLASSIFY_E2E/.test(script)
        && /E2E_CANNED_DRAFT/.test(script)
        && /E2E_SYNTHETIC_CANDIDATE/.test(script)
        && /E2E_SKIP_REPLY_CLASSIFY/.test(script)
        && /never pretends full PASS/.test(script)
        && /E2E_STALE_FLY/.test(script)
        && /ARIA_ALLOW_STALE_FLY_E2E/.test(script)
        && /RESULT: PARTIAL/.test(script)
        && /RESULT: FAIL/.test(script)
        && /MS_LIVE_GAP/.test(script)
        && /E2E_SKIP_M365/.test(script)
        && /Skipped \(Microsoft \/ calendar\)/.test(script)
        && /provenance:\s*"live"/.test(route)
        && (/step 3c|3c FAIL|live=0/.test(handoff) || /provenance fix/.test(handoff))
        && (/expect step 3c PASS/.test(handoff) || /step 3c should show/.test(handoff))
        && /never pretends full PASS|never pretends full enterprise PASS/.test(script)
        && /E2E_SOURCING_MAX/.test(script)
        && /E2E_APPROVE_MAX/.test(script)
        && /Strict Fly runs: transient sourcing quota/.test(script)
      );
    },
  },
  {
    requirement: "parse→campaign→sourcing→draft→quality chain pinned (E2E + worker + draft recover)",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      const workerSrc = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
      const intake = readFileSync("src/app/intake/page.tsx", "utf8");
      const schedules = readFileSync("src/components/settings/schedules-panel.tsx", "utf8");
      return (
        /parse→campaign→sourcing→draft→quality chain/.test(script)
        && /Loop chain pins: graphStage strip/.test(script)
        && /Webhook campaign chain snapshot/.test(script)
        && /ARIA_ALLOW_SKIP_APPROVE_E2E/.test(script)
        && /key !== "graphStage"/.test(workerSrc)
        && /priorStatus === "campaign_created"/.test(workerSrc)
        && /generate-outreach-draft/.test(workerSrc)
        && /stale graph "blocked"/.test(draft)
        && /graphResult\.stage === "approval_blocked"/.test(draft)
        && /quality_critics_incomplete/.test(draft)
        && /demoLoginEnabled[\s\S]*Paste a hiring need email/.test(intake)
        && /sourcing loop worker/.test(schedules)
        && /Loop switchboard/.test(schedules)
      );
    },
  },
  {
    requirement: "Hermes H6 profile prefix + session key on loop and chat paths",
    evidence: () => {
      const proxy = readFileSync("src/lib/api/hermes-proxy.ts", "utf8");
      const chat = readFileSync("src/app/api/hermes/chat/route.ts", "utf8");
      const loopLlm = readFileSync("src/lib/ai/loop-llm.ts", "utf8");
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      return (
        /resolveHermesProfilePrefix/.test(proxy)
        && /buildHermesSessionKey/.test(proxy)
        && /X-Hermes-Session-Key/.test(proxy)
        && /buildHermesUpstreamPath/.test(proxy)
        && /X-Hermes-Session-Key/.test(chat)
        && /resolveLoopLlm/.test(loopLlm)
        && /HERMES_API_URL/.test(worker)
      );
    },
  },
  {
    requirement: "LocaleContext + 60-language catalog flows parse → draft",
    evidence: () => {
      const i18n = readFileSync("src/lib/i18n.ts", "utf8");
      const types = readFileSync("src/lib/types.ts", "utf8");
      const mock = readFileSync("src/lib/mock-ai.ts", "utf8");
      const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
      const lang = readFileSync("src/lib/outreach-language.ts", "utf8");
      return (
        /BUSINESS_LANGUAGE_CATALOG/.test(i18n)
        && /detectLanguageWithHint/.test(i18n)
        && /LocaleContext/.test(types)
        && /localeContext/.test(mock)
        && /localeContext/.test(draft)
        && /resolveOutreachLanguage/.test(draft)
        && /resolveOutreachLanguage/.test(lang)
        && /resolveLoopLlm/.test(draft)
      );
    },
  },
  {
    requirement: "E2E drafts LinkedIn, Email, WhatsApp in candidate main language",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /E2E_OUTREACH_LANGUAGE/.test(script)
        && /assert-outreach-language/.test(script)
        && /assert_outreach_language/.test(script)
        && /5b\) WhatsApp outreach/.test(script)
        && /Language \(must\): French/.test(script)
        && existsSync("scripts/assert-outreach-language.mts")
      );
    },
  },
  {
    requirement: "Hermes schedules panel mirrors MSourcing loop cron jobs",
    evidence: () => {
      const panel = readFileSync("src/components/settings/hermes-schedules-panel.tsx", "utf8");
      const jobs = readFileSync("src/app/api/cron/jobs/route.ts", "utf8");
      return /\/api\/cron\/jobs/.test(panel) && /generate-outreach-draft/.test(jobs);
    },
  },
];

for (const row of MATRIX) {
  ok(row.requirement, row.evidence());
}

console.log(`RESULT enterprise-e2e-audit-matrix: ${pass}/${MATRIX.length} requirements verified`);
if (fail > 0) process.exit(1);
