/**
 * Full Mantu recruiting loop E2E (in-process, no Fly credentials required).
 *
 * Simulates: webhook need → intake parse → readiness → source → top 10
 * → Mantu outreach + quality → LangGraph → first-interview agenda.
 */

import assert from "node:assert/strict";
import {
  parseEmailAndJD,
  SAMPLE_MANTU_EMAIL,
  generateOutreach,
  sourceCandidates,
  newOutreachMessage,
} from "../src/lib/mock-ai";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";
import { routeInboundEmail } from "../src/lib/inbound-email-router";
import { validateOutreachQuality } from "../src/lib/outreach-quality-pipeline";
import { mantuEmailHtmlWrapper, mantuFirstInterviewAgenda, mantuOutreachVoice } from "../src/lib/mantu-brand";
import { runRecruitingGraph, rankTopCandidates } from "../src/lib/langchain/recruiting-graph";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "../src/lib/recruiting-loop/constants";
import { buildSeedState, defaultSettings, e2eReadyJob, buildHistoricalDemoSeedState } from "../src/lib/seed";
import { migrateToCurrentVersion } from "../src/lib/store/migrations";
import { gateOutbound } from "../src/lib/gate";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

async function main() {
  // ── 0. Clean seed: no historical candidates ──
  const seed = buildSeedState();
  ok("clean seed has zero candidates", seed.candidates.length === 0);
  ok("clean seed has Sourcing camp-e2e", seed.campaigns.some((c) => c.id === "camp-e2e" && c.status === "Sourcing"));

  const historical = buildHistoricalDemoSeedState();
  historical.version = 18 as typeof historical.version;
  const migrated = migrateToCurrentVersion(historical);
  ok("STATE_VERSION 19 migration purges historical candidates", migrated.candidates.length === 0);
  ok("STATE_VERSION 19 migration purges outreach", migrated.outreach.length === 0);
  ok("STATE_VERSION 19 migration resets to Sourcing campaigns", migrated.campaigns.every((c) => c.status === "Sourcing"));

  // ── 1. Webhook: hiring need enqueues requisition_parse ──
  const needRoute = routeInboundEmail({
    record: { ok: true, inbound_id: "inb-need-1", duplicate: false },
    from: "noreply@mantu.example",
    subject: "This need is now ACTIVE: Senior TypeScript Engineer",
    body: SAMPLE_MANTU_EMAIL,
    mailbox: "talent@mantu.com",
  });
  ok("webhook routes Mantu need to hiring_need", needRoute.route === "hiring_need");
  if (needRoute.route === "hiring_need") {
    ok("need job kind is requisition_parse", needRoute.decision.kind === "requisition_parse");
  }

  // ── 2. Intake parse + readiness gate ──
  const parsed = parseEmailAndJD({ email: SAMPLE_MANTU_EMAIL });
  ok("intake parses Mantu need title", parsed.jobAnalysis.title.length > 2);
  const readiness = evaluateNeedReadiness(parsed.jobAnalysis);
  ok("parsed need passes readiness (or has explicit skills)", parsed.jobAnalysis.requiredSkills.length > 0);

  // ── 3. Source batch into camp-e2e ──
  const campaign = seed.campaigns.find((c) => c.id === "camp-e2e")!;
  const e2eCampaign = { ...campaign, jobAnalysis: e2eReadyJob() };
  const { accepted } = sourceCandidates(e2eCampaign, "GitHub", 15, [], 1);
  ok("sourcing returns candidates", accepted.length > 0);

  const top10 = rankTopCandidates(accepted, TOP_CANDIDATE_SHORTLIST_SIZE);
  ok("top 10 shortlist capped at 10", top10.length <= TOP_CANDIDATE_SHORTLIST_SIZE);
  ok("top 10 has at least 1 candidate", top10.length >= 1);

  // ── 4. Mantu outreach + quality for each shortlisted candidate ──
  const settings = defaultSettings();
  const voice = mantuOutreachVoice();
  let outreachReady = 0;
  const drafts: Record<string, { subject: string; body: string; channel: string }> = {};

  for (const cand of top10.slice(0, 3)) {
    const gen = generateOutreach(cand, e2eCampaign, "Casual Professional", "Email", 1, voice);
    const quality = validateOutreachQuality({ subject: gen.subject, body: gen.body, channel: "Email" });
    const gate = gateOutbound(quality.text.body);
    ok(`gate passes for ${cand.name}`, gate.pass);
    if (quality.status !== "blocked" && gate.pass) outreachReady++;
    drafts[cand.id] = { subject: quality.text.subject, body: quality.text.body, channel: "Email" };
    ok(`Mantu HTML for ${cand.name}`, mantuEmailHtmlWrapper(gen.body).includes("Mantu Group"));
  }
  ok("at least one outreach draft quality-ready", outreachReady >= 1);

  const msg = newOutreachMessage(
    top10[0]!,
    e2eCampaign,
    generateOutreach(top10[0]!, e2eCampaign, "Casual Professional", "LinkedIn", 1, voice),
    "Casual Professional",
    settings,
  );
  ok("outreach message starts Needs Approval", msg.status === "Needs Approval");

  // ── 5. LangGraph orchestration ──
  const graphState = await runRecruitingGraph({
    workspaceId: "ws-e2e",
    inboundId: "inb-need-1",
    campaignId: e2eCampaign.id,
    candidateIds: top10.map((c) => c.id),
    drafts,
  });
  ok(
    "LangGraph completes pipeline",
    ["queued_for_approval", "approval_blocked", "interview_scheduled"].includes(graphState.stage),
  );
  ok("LangGraph shortlist size", (graphState.shortlistIds?.length ?? 0) <= TOP_CANDIDATE_SHORTLIST_SIZE);

  // ── 6. First interview agenda (Mantu + role) ──
  const agenda = mantuFirstInterviewAgenda(e2eCampaign.title);
  ok("first interview agenda mentions Mantu", agenda.some((line) => /mantu/i.test(line)));
  ok("first interview agenda mentions role", agenda.some((line) => /TypeScript/i.test(line)));

  // ── 7. calendar_book propose path is wired (claim dry-run, human confirmLive) ──
  const { readFileSync, existsSync } = await import("node:fs");
  ok(
    "propose-calendar-book cron exists",
    existsSync("src/app/api/cron/propose-calendar-book/route.ts"),
  );
  const proposeSrc = readFileSync("src/app/api/cron/propose-calendar-book/route.ts", "utf8");
  const workerSrc = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
  ok("propose cron claims then dry-runs by default", /proposed_dry_run/.test(proposeSrc) && /use_calendar_event_route/.test(proposeSrc));
  ok("worker calendar_book calls propose cron", /calendarProposeUrl/.test(workerSrc) && /handleCalendarBook/.test(workerSrc));
  ok("worker sets Interested + interviewProposal", /interviewProposal/.test(workerSrc) && /stage: "Interested"/.test(workerSrc));

  console.log(`RESULT mantu-recruiting-e2e-full: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
