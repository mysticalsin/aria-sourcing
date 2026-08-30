/* tests/exec-dashboard.mts - area: exec-dashboard
 * The exec dashboard must consume canonical W1 metric derivations and keep
 * open-rate/RBAC/provenance claims honest.
 * Run: node --import tsx tests/exec-dashboard.mts
 */
import { readFileSync } from "fs";
import { deriveExecDashboard, execCanExport, execWinCandidateLabel } from "../src/lib/exec-dashboard";
import { globalKpis, isRealSendFact, realFunnelFacts } from "../src/lib/metrics";
import type { Activity, Booking, Campaign, Candidate, HermesState, OutreachMessage, WinRecord } from "../src/lib/types";

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

const campaignId = "camp-exec";
const sentAt = "2026-07-10T10:00:00.000Z";

function candidate(
  id: string,
  sourcePlatform: Candidate["sourcePlatform"] = "GitHub",
  provenance: Candidate["provenance"] = "live",
): Candidate {
  return {
    id,
    campaignId,
    name: id,
    email: `${id}@example.com`,
    phone: "",
    avatarInitials: id.slice(0, 2).toUpperCase(),
    currentTitle: "Engineer",
    currentCompany: "Example",
    location: "Paris",
    timezone: "CET",
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform,
    sourceQuery: "engineer",
    matchScore: id === "real-completed" ? 90 : 70,
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
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: sentAt,
    provenance,
  };
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

function booking(id: string, candidateId: string, withMeeting = false): Booking {
  return {
    id,
    candidateId,
    campaignId,
    candidateName: candidateId,
    role: "Engineer",
    startTime: "2026-07-11T10:00:00.000Z",
    endTime: "2026-07-11T10:30:00.000Z",
    timezone: "CET",
    interviewer: "Interviewer",
    interviewerEmail: "interviewer@example.com",
    teamsLink: withMeeting
      ? "https://teams.microsoft.com/l/meetup-join/19%3ameeting_exec"
      : "",
    calLink: "",
    status: withMeeting ? "Confirmed" : "Proposed",
    agenda: [],
    createdAt: "2026-07-10T12:00:00.000Z",
  };
}

const campaign = {
  id: campaignId,
  title: "Engineering",
  status: "Outreach",
  createdAt: "2026-07-09T10:00:00.000Z",
  metrics: {
    sourced: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    booked: 0,
    interviewed: 0,
    offer: 0,
    hired: 0,
    notInterested: 0,
    replyRate: 0,
    avgMatchScore: 0,
    timeToFirstInterviewHours: 24,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  },
} as Campaign;

const candidates = [
  candidate("real-completed", "GitHub"),
  candidate("dry-run-contact", "LinkedIn"),
  candidate("approved-unsent", "Apollo"),
  candidate("synthetic-real", "Seamless", "synthetic"),
];

const outreachMessages = [
  outreach("msg-real", "real-completed", false, sentAt),
  outreach("msg-dry-run", "dry-run-contact", true, sentAt),
  outreach("msg-approved", "approved-unsent", false, null, "Approved"),
  outreach("msg-synthetic", "synthetic-real", false, sentAt),
];

const wins: WinRecord[] = [
  {
    id: "win-1",
    at: "2026-07-10T12:00:00.000Z",
    candidateId: "real-completed",
    candidateName: "Ada Lovelace",
    campaignId,
    campaignTitle: "Engineering",
    bookingId: "booking-real",
    sourcePlatform: "GitHub",
    leadSource: "Outbound",
    matchScore: 90,
    seniority: "Senior",
    roleTitle: "Engineer",
    outreachChannel: "Email",
    touchCount: 1,
    timeToBookMs: 7_200_000,
    triggeringReplyIntent: { intent: "INTERESTED", confidence: 0.95 },
    messageTraits: { tone: "Casual Professional" },
  },
];

const state = {
  campaigns: [campaign],
  candidates,
  outreach: outreachMessages,
  replies: [
    {
      id: "reply-real",
      candidateId: "real-completed",
      campaignId,
      channel: "Email",
      body: "Interested",
      intent: "INTERESTED",
      confidence: 0.95,
      reasoning: "",
      suggestedAction: "",
      draftResponse: "",
      handled: false,
      slaDueAt: null,
      receivedAt: "2026-07-10T11:00:00.000Z",
    },
    {
      id: "reply-dry-run",
      candidateId: "dry-run-contact",
      campaignId,
      channel: "Email",
      body: "Interested",
      intent: "INTERESTED",
      confidence: 0.9,
      reasoning: "",
      suggestedAction: "",
      draftResponse: "",
      handled: false,
      slaDueAt: null,
      receivedAt: "2026-07-10T11:00:00.000Z",
    },
  ],
  bookings: [booking("booking-real", "real-completed", true), booking("booking-dry", "dry-run-contact")],
  activities: [
    {
      id: "act-1",
      type: "sourcing",
      title: "Sourced",
      notes: "",
      outcome: "",
      campaignId,
      linkedEntityType: "candidate",
      linkedEntityId: "real-completed",
      createdAt: sentAt,
    } satisfies Activity,
  ],
  settings: { dryRunMode: false } as HermesState["settings"],
  wins,
} satisfies Pick<
  HermesState,
  "campaigns" | "candidates" | "outreach" | "replies" | "bookings" | "activities" | "settings" | "wins"
>;

const model = deriveExecDashboard(state, false);
const canonicalFacts = realFunnelFacts(state, { live: true });
const canonicalKpis = globalKpis(state);

ok("fixture real send is real", isRealSendFact(outreachMessages[0]));
ok("fixture dry-run send is not real", !isRealSendFact(outreachMessages[1]));
ok("fixture approved-unsent send is not real", !isRealSendFact(outreachMessages[2]));

ok("exec contacted equals canonical realFunnelFacts", model.kpis.contacted === canonicalFacts.contacted);
ok("exec sourced equals canonical globalKpis", model.kpis.candidatesSourced === canonicalKpis.candidatesSourced);
ok("exec reply rate equals canonical globalKpis", model.kpis.replyRate === canonicalKpis.replyRate);
ok("exec booked equals canonical globalKpis", model.kpis.interviewsBooked === canonicalKpis.interviewsBooked);
ok("exec positive-reply rate equals canonical realFunnelFacts", model.facts.positiveReplyRate === canonicalFacts.positiveReplyRate);
ok("exec avg match equals canonical globalKpis", model.kpis.avgMatchScore === canonicalKpis.avgMatchScore);

ok("live tiles count only the completed real send as contacted", model.kpis.contacted === 1);
ok("dry-run candidate is excluded from contacted ids", !model.facts.contactedCandidateIds.includes("dry-run-contact"));
ok("approved-unsent candidate is excluded from contacted ids", !model.facts.contactedCandidateIds.includes("approved-unsent"));
ok("synthetic candidate is excluded from contacted ids", !model.facts.contactedCandidateIds.includes("synthetic-real"));
ok("live bookings are tied to real contacted candidates only", model.kpis.interviewsBooked === 1);
ok("platform funnel derives GitHub contacted from canonical facts", model.platformFunnels.find((row) => row.id === "GitHub")?.facts.contacted === 1);
ok("campaign funnel derives contacted from canonical facts", model.campaignFunnels[0]?.facts.contacted === canonicalFacts.contacted);

ok("viewer cannot export", !execCanExport("viewer"));
ok("admin can export", execCanExport("admin"));
ok("viewer win label is first-name only", execWinCandidateLabel(wins[0], "viewer") === "Ada");
ok("admin win label is full name", execWinCandidateLabel(wins[0], "admin") === "Ada Lovelace");

const pageSource = readFileSync(new URL("../src/app/exec/page.tsx", import.meta.url), "utf8");
const derivationSource = readFileSync(new URL("../src/lib/exec-dashboard.ts", import.meta.url), "utf8");
const navSource = readFileSync(new URL("../src/components/app/nav.ts", import.meta.url), "utf8");
const combinedSource = `${pageSource}\n${derivationSource}`;

ok("exec page exists as client page", pageSource.includes('title="Exec Dashboard"'));
ok("exec nav route is registered", navSource.includes('href: "/exec"'));
ok("exec source contains no Math.random", !combinedSource.includes("Math.random"));
ok(
  "exec source has no hardcoded KPI metric literal assignments",
  !/(candidatesSourced|contacted|replyRate|positiveReplyRate|interviewsBooked|avgMatchScore|timeToFirstInterviewHours)\s*[:=]\s*["']?\d/.test(
    combinedSource,
  ),
);
ok("open-rate tile renders Not tracked yet", pageSource.includes("Not tracked yet"));
ok("open-rate tile explains no email-open events exist", pageSource.includes("No email-open events exist"));
ok("open-rate tile does not format an open-rate number", !/formatPercent\([^)]*openRate|openRate\s*[:=]\s*\d/.test(pageSource));
ok("page gates export through RBAC helper", pageSource.includes("execCanExport(role)"));

console.log(`RESULT exec-dashboard: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
