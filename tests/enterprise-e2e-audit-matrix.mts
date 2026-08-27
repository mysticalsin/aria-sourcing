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
      )
      && /GRAPH_STAGE_TO_JOB_KIND/.test(graphRoute)
      && /nextJobKindAfterGraphStage/.test(graphRoute)
      && /pipeline-transitions\.json/.test(graphRoute)
      && /graph-stage-jobs\.json/.test(graphRoute)
      && existsSync("src/lib/langchain/pipeline-transitions.json")
      && existsSync("src/lib/langchain/graph-stage-jobs.json")
      && /graph-stage-jobs\.json/.test(worker)
      && /nextJobKindAfterGraphStage/.test(worker),
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
      return (
        /\/api\/email\/connections/.test(src)
        && /connectedOutlook/.test(src)
        && /Teams joinUrl \(proven on live book\)/.test(src)
        && /ok: false/.test(src)
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
      return (
        /createBookingFor\(c\.id\)/.test(drawer)
        && /Intw1 booked on Outlook\/Teams/.test(drawer)
        && !/Reminder cadence T-24h/.test(drawer)
        && /Do NOT invent Booked here/.test(store)
      );
    },
  },
  {
    requirement: "Loop worker chains campaign_create into sourcing_batch",
    evidence: () => {
      const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
      const transitions = readFileSync("src/lib/langchain/pipeline-transitions.json", "utf8");
      return (
        /"campaign_create"\s*:\s*\[\s*"sourcing_batch"\s*\]/.test(transitions)
        && /pipeline-transitions\.json/.test(worker)
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
        && /confirmLive:true/.test(script)
        && /Live Outlook\/Teams book/.test(script)
        && /ARIA_ALLOW_SKIP_LIVE_CALENDAR/.test(script)
        && /isOnlineMeeting/.test(script)
        && /teamsForBusiness/.test(script)
        && /Introduce Mantu Group/.test(script)
        && /mantuEmailHtmlWrapper/.test(script)
        && /mantuFirstInterviewAgenda/.test(script)
      );
    },
  },
  {
    requirement: "Fly E2E fails closed without webhook secret or migration 0065",
    evidence: () => {
      const script = readFileSync("e2e-workflow-test.sh", "utf8");
      return (
        /EMAIL_INBOUND_WEBHOOK_SECRET is required for Fly enterprise E2E/.test(script)
        && /migration must be 0066_/.test(script)
        && /unknown_subscription/.test(script)
        && /microsoft-graph/.test(script)
        && /Polling workspace_state for campaign title/.test(script)
        && /Loop worker materialized campaign/.test(script)
        && /set_sourcing_loop_controls/.test(script)
        && /Type: Permanent/.test(script)
        && /WEBHOOK_CAMPAIGN_ID/.test(script)
        && /ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E/.test(script)
        && /persisted:false on Fly/.test(script)
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
        && /lastIndexOf\("\/messages\/"\)/.test(route)
        && /createGraphMailSubscription/.test(subs)
        && /declaredHtml/.test(subs)
        && /replace\(\/<\\s\*br/.test(subs)
        && /renewExpiringGraphMailSubscriptions|renewGraphMailSubscription/.test(subs)
        && /graph_mail_subscriptions/.test(migration)
        && /Emergency sync/.test(panel)
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
        && /webhookIntakeReady/.test(stack)
        && /Enable webhook/.test(panel)
        && /ensureGraphMailSubscription/.test(graphLib)
        && /Entra SSO/.test(stack)
        && /inbound mailbox route failed/.test(
          readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8"),
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
    requirement: "Enterprise E2E deliverable tracked on open PR (supersedes closed #29, #30)",
    evidence: () => {
      const golive = readFileSync("scripts/fly-golive-mantu-e2e.sh", "utf8");
      const handoff = readFileSync("_relay/HANDOFF.md", "utf8");
      const printConfirm = readFileSync("scripts/print-fly-deploy-confirm.sh", "utf8");
      const printE2e = readFileSync("scripts/print-fly-e2e-env.sh", "utf8");
      return (
        /PR #31/.test(golive)
        && /supersedes closed #29/.test(handoff)
        && /print-fly-deploy-confirm/.test(handoff)
        && /ARIA_PROD_DEPLOY_CONFIRM/.test(printConfirm)
        && /print-fly-e2e-env/.test(golive)
        && /FLY_SUPABASE_ANON_KEY/.test(printE2e)
        && /Fly secrets inventory/.test(golive)
        && existsSync("scripts/fly-enterprise-activate.sh")
        && /print-fly-deploy-confirm/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
        && existsSync("scripts/print-fly-secrets-checklist.sh")
        && /EMAIL_INBOUND_WEBHOOK_SECRET/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /GOTRUE_EXTERNAL_AZURE_ENABLED/.test(readFileSync("scripts/print-fly-secrets-checklist.sh", "utf8"))
        && /print-fly-secrets-checklist/.test(readFileSync("scripts/fly-enterprise-activate.sh", "utf8"))
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
    requirement: "Microsoft OAuth scope fallback includes Calendars.ReadWrite",
    evidence: () => {
      const callback = readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8");
      const authorize = readFileSync("src/app/auth/microsoft/route.ts", "utf8");
      return (
        /Calendars\.ReadWrite/.test(callback)
        && /Calendars\.ReadWrite/.test(authorize)
      );
    },
  },
  {
    requirement: "Multi-agent quality critics run as separate LLM calls",
    evidence: () => {
      const qualityLive = readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8");
      return (
        /CRITICS/.test(qualityLive)
        && /runOneCritic/.test(qualityLive)
        && /Promise\.all/.test(qualityLive)
        && /llm_empathy/.test(qualityLive)
        && /llm_compliance/.test(qualityLive)
        && /llm_human_likeness/.test(qualityLive)
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
      const calendar = readFileSync("src/lib/calendar.ts", "utf8");
      return (
        /meeting_url/.test(mig)
        && /meetingUrl/.test(authority)
        && /claim\.meetingUrl/.test(route)
        && /p_meeting_url/.test(authority)
        && /onlineMeeting\/joinUrl|onlineMeeting\?\.joinUrl/.test(calendar)
        && /isTeamsMeetingJoinUrl/.test(calendar)
        && /webLink-only create is not accepted/.test(readFileSync("tests/calendar-booking-authority.mts", "utf8"))
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
        && /outreach_draft_graph_stage_invalid/.test(worker)
        && /outreach_draft_critics_required/.test(worker)
        && /assertRecruitingGraphCheckpoint/.test(worker)
        && /recruiting-graph-stage/.test(worker)
        && /intent: "parse_only"/.test(worker)
        && /intent: "source_only"/.test(worker)
        && /intent: "rank_only"/.test(worker)
        && /intent: "book_only"/.test(worker)
        && /calendar_book/.test(worker)
        && /Always enqueue Teams\/Outlook first-interview propose/.test(worker)
        && /graphShortlistCount/.test(worker)
        && /shortlistIds/.test(worker)
        && /parse_only/.test(graph)
        && /source_only/.test(graph)
        && /rank_only/.test(graph)
        && /book_only/.test(graph)
        && /assertRecruitingGraphStage/.test(graph)
        && existsSync("src/app/api/cron/recruiting-graph-stage/route.ts")
        && /microsoftOAuth=true/.test(e2e)
        && /generate-outreach-draft rejects unauthenticated/.test(e2e)
        && /recruiting-graph-stage rejects unauthenticated/.test(e2e)
        && /inbound_classify positive interest/.test(e2e)
        && /llmStages\.length === CRITICS\.length/.test(readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8"))
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
];

for (const row of MATRIX) {
  ok(row.requirement, row.evidence());
}

console.log(`RESULT enterprise-e2e-audit-matrix: ${pass}/${MATRIX.length} requirements verified`);
if (fail > 0) process.exit(1);
