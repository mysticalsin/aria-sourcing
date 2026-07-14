/* tests/metrics-canonical.mts — area: metrics
 * Canonical real-send KPI facts must not count demo sends, approvals awaiting
 * delivery, or synthetic candidates as live contact facts.
 * Run: tsx tests/metrics-canonical.mts
 */
import {
  computeCampaignMetrics,
  globalKpis,
  isRealSendFact,
  missionControlHudValues,
  realFunnelFacts,
} from "../src/lib/metrics";
import type {
  Booking,
  Campaign,
  Candidate,
  HermesState,
  OutreachLedgerEntry,
  OutreachMessage,
} from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const campaignId = "camp-real";
const sentAt = "2026-07-10T12:00:00.000Z";

function candidate(id: string, provenance: Candidate["provenance"] = "live"): Candidate {
  return {
    id,
    campaignId,
    name: id,
    title: "Engineer",
    company: "Example",
    location: "Paris",
    email: `${id}@example.com`,
    linkedinUrl: null,
    githubUrl: null,
    sourcePlatform: "GitHub",
    sourceQuery: "engineer",
    matchScore: 82,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: 6,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: { needsVisaCheck: false, missingContactInfo: false, gdprSensitive: false },
    createdAt: sentAt,
    provenance,
  } as Candidate;
}

function outreach(
  id: string,
  candidateId: string,
  dryRun: boolean,
  messageSentAt: string | null,
  status: OutreachMessage["status"] = "Scheduled",
): OutreachMessage {
  return {
    id,
    candidateId,
    campaignId,
    channel: "Email",
    subject: "Role",
    body: "Hello",
    tone: "Casual Professional",
    personalizationEvidence: [],
    status,
    sequenceStep: 1,
    scheduledFor: messageSentAt,
    sentAt: messageSentAt,
    approvedBy: "operator",
    dryRun,
    createdAt: sentAt,
  };
}

function ledger(
  id: string,
  candidateId: string,
  status: OutreachLedgerEntry["status"],
): OutreachLedgerEntry {
  return {
    id,
    candidateId,
    candidateEmail: `${candidateId}@example.com`,
    seatId: "seat-1",
    campaignId,
    channel: "Email",
    status,
    reason: null,
    at: sentAt,
  };
}

function booking(id: string, candidateId: string): Booking {
  return {
    id,
    candidateId,
    campaignId,
    candidateName: candidateId,
    role: "Engineer",
    startTime: "2026-07-11T12:00:00.000Z",
    endTime: "2026-07-11T12:30:00.000Z",
    timezone: "CET",
    interviewer: "Interviewer",
    interviewerEmail: "interviewer@example.com",
    teamsLink: "",
    calLink: "",
    status: "Confirmed",
    agenda: [],
    createdAt: sentAt,
  };
}

const candidates = [
  candidate("real-completed"),
  candidate("demo-dryrun"),
  candidate("approved-unsent"),
  candidate("synthetic-real", "synthetic"),
];

const outreachMessages = [
  outreach("msg-real", "real-completed", false, sentAt),
  // Trap A: demo dry-run approval can write a local ledger row as sent.
  outreach("msg-demo", "demo-dryrun", true, sentAt),
  // Trap B: approved live outreach is not a send fact until sentAt is stamped.
  outreach("msg-approved", "approved-unsent", false, null, "Approved"),
  // Trap C: synthetic candidates with otherwise real-looking sends are excluded in live mode.
  outreach("msg-synthetic", "synthetic-real", false, sentAt),
];

const state = {
  campaigns: [
    {
      id: campaignId,
      status: "Outreach",
      createdAt: "2026-07-09T12:00:00.000Z",
      metrics: computeCampaignMetrics([]),
    } as Campaign,
  ],
  candidates,
  outreach: outreachMessages,
  replies: [
    {
      id: "reply-real",
      candidateId: "real-completed",
      campaignId,
      channel: "Email",
      intent: "INTERESTED",
      handled: false,
      receivedAt: sentAt,
    },
    {
      id: "reply-demo",
      candidateId: "demo-dryrun",
      campaignId,
      channel: "Email",
      intent: "INTERESTED",
      handled: false,
      receivedAt: sentAt,
    },
    {
      id: "reply-synthetic",
      candidateId: "synthetic-real",
      campaignId,
      channel: "Email",
      intent: "INTERESTED",
      handled: false,
      receivedAt: sentAt,
    },
  ] as HermesState["replies"],
  bookings: [
    booking("booking-real", "real-completed"),
    booking("booking-demo", "demo-dryrun"),
    booking("booking-synthetic", "synthetic-real"),
  ],
  ledger: [
    ledger("led-real", "real-completed", "sent"),
    ledger("led-demo", "demo-dryrun", "sent"),
    ledger("led-approved", "approved-unsent", "claimed"),
    ledger("led-synthetic", "synthetic-real", "sent"),
  ],
  settings: { dryRunMode: false } as HermesState["settings"],
} satisfies Pick<
  HermesState,
  "campaigns" | "candidates" | "outreach" | "replies" | "bookings" | "ledger" | "settings"
>;

const facts = realFunnelFacts(state, { live: true, campaignId });
const kpis = globalKpis(state);
const campaignMetrics = computeCampaignMetrics(candidates, undefined, null, facts);
const hudValues = missionControlHudValues(state, { live: true });

ok("isRealSendFact requires dryRun false", !isRealSendFact(outreachMessages[1]));
ok("isRealSendFact requires sentAt", !isRealSendFact(outreachMessages[2]));
ok("isRealSendFact accepts a completed live send", isRealSendFact(outreachMessages[0]));

ok("fixture includes trap A ledger sent dry-run", state.ledger.some((l) => l.candidateId === "demo-dryrun" && l.status === "sent"));
ok("fixture includes trap B claimed approval", state.ledger.some((l) => l.candidateId === "approved-unsent" && l.status === "claimed"));
ok("fixture includes trap C synthetic real send", outreachMessages.some((m) => m.candidateId === "synthetic-real" && isRealSendFact(m)));

ok("live canonical contacted counts only the completed real send", facts.contacted === 1);
ok("trap A dry-run sent ledger is excluded", !facts.contactedCandidateIds.includes("demo-dryrun"));
ok("trap B approved-unsent is excluded", !facts.contactedCandidateIds.includes("approved-unsent"));
ok("trap C synthetic real send is excluded", !facts.contactedCandidateIds.includes("synthetic-real"));
ok("live canonical replies are tied to real contacted candidates", facts.repliedCount === 1);
ok("live canonical positive replies are tied to real contacted candidates", facts.positiveReplies === 1);
ok("live canonical bookings are tied to real contacted candidates", facts.booked === 1);

ok("globalKpis contacted agrees with canonical facts", kpis.contacted === facts.contacted);
ok("globalKpis replyRate agrees with canonical facts", kpis.replyRate === facts.replyRate);
ok("globalKpis interviewsBooked agrees with canonical facts", kpis.interviewsBooked === facts.booked);
ok("computeCampaignMetrics contacted agrees with canonical facts", campaignMetrics.contacted === facts.contacted);
ok("computeCampaignMetrics replyRate agrees with canonical facts", campaignMetrics.replyRate === facts.replyRate);
ok("computeCampaignMetrics booked agrees with canonical facts", campaignMetrics.booked === facts.booked);
ok("HUD contacted derivation agrees with canonical facts", hudValues.contacted === facts.contacted);
ok("HUD booked derivation agrees with canonical facts", hudValues.booked === facts.booked);

console.log(`RESULT metrics-canonical: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
