/* tests/winlog.mts - area: winlog
 * Structured wins must be derived from real completed sends only and stay
 * private to app state/browser export.
 * Run: tsx tests/winlog.mts
 */
import { readFileSync } from "node:fs";
import {
  appendWinRecord,
  deriveWinRecord,
  normalizeHermesState,
  WIN_RECORD_LIMIT,
} from "../src/lib/store";
import { buildSeedState } from "../src/lib/seed";
import type { Booking, Campaign, Candidate, HermesState, OutreachMessage, WinRecord } from "../src/lib/types";

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

const campaignId = "camp-winlog";
const candidateId = "cand-winlog";
const firstRealAt = "2026-07-10T08:00:00.000Z";
const dryRunAt = "2026-07-10T09:00:00.000Z";
const lastRealAt = "2026-07-10T10:00:00.000Z";
const bookingCreatedAt = "2026-07-10T12:00:00.000Z";

const seed = buildSeedState();
const campaign: Campaign = {
  ...seed.campaigns[0],
  id: campaignId,
  title: "Platform Search",
  jobAnalysis: {
    ...seed.campaigns[0].jobAnalysis,
    title: "Principal Platform Engineer",
    seniority: "Principal",
  },
};

const candidate: Candidate = {
  ...seed.candidates[0],
  id: candidateId,
  campaignId,
  name: "Ada Win",
  currentTitle: "Staff Backend Engineer",
  sourcePlatform: "GitHub",
  leadSource: "Outbound",
  matchScore: 93,
  stage: "Interested",
  outreachHistory: [
    { messageId: "msg-real-2", channel: "LinkedIn", subject: "Second real", status: "Scheduled", at: lastRealAt },
    { messageId: "msg-dry", channel: "Email", subject: "Dry run", status: "Scheduled", at: dryRunAt },
    { messageId: "msg-real-1", channel: "Email", subject: "First real", status: "Scheduled", at: firstRealAt },
  ],
  replyHistory: [
    { id: "reply-new", intent: "QUALIFIED_INTEREST", confidence: 0.82, excerpt: "Let's talk", at: "2026-07-10T11:00:00.000Z" },
    { id: "reply-old", intent: "INTERESTED", confidence: 0.9, excerpt: "Interested", at: "2026-07-10T10:30:00.000Z" },
  ],
  booking: null,
};

function message(
  id: string,
  channel: OutreachMessage["channel"],
  sentAt: string | null,
  dryRun: boolean,
  tone: OutreachMessage["tone"],
  subject: string,
  body: string,
): OutreachMessage {
  return {
    id,
    candidateId,
    campaignId,
    channel,
    subject,
    body,
    tone,
    personalizationEvidence: [],
    status: "Scheduled",
    sequenceStep: 1,
    scheduledFor: sentAt,
    sentAt,
    approvedBy: "Operator",
    dryRun,
    createdAt: sentAt ?? dryRunAt,
  };
}

const booking: Booking = {
  id: "booking-win",
  candidateId,
  campaignId,
  candidateName: candidate.name,
  role: campaign.jobAnalysis.title,
  startTime: "2026-07-11T12:00:00.000Z",
  endTime: "2026-07-11T12:30:00.000Z",
  timezone: "UTC",
  interviewer: "Interviewer",
  interviewerEmail: "interviewer@example.com",
  teamsLink: "",
  calLink: "",
  status: "Confirmed",
  agenda: [],
  createdAt: bookingCreatedAt,
};

const state: HermesState = {
  ...seed,
  campaigns: [campaign],
  candidates: [candidate],
  outreach: [
    message("msg-real-1", "Email", firstRealAt, false, "Technical", "First real", "First real body"),
    message("msg-dry", "Email", dryRunAt, true, "Casual Professional", "Dry run", "Dry run body"),
    message("msg-real-2", "LinkedIn", lastRealAt, false, "Executive", "Second real", "Second real body"),
    message("msg-unjoined", "WhatsApp", "2026-07-10T11:30:00.000Z", false, "Technical", "Unjoined", "Must not count"),
  ],
  replies: [
    {
      id: "reply-old",
      candidateId,
      campaignId,
      channel: "Email",
      body: "Interested",
      intent: "INTERESTED",
      confidence: 0.9,
      reasoning: "",
      suggestedAction: "",
      draftResponse: "",
      handled: true,
      slaDueAt: null,
      receivedAt: "2026-07-10T10:30:00.000Z",
    },
    {
      id: "reply-new",
      candidateId,
      campaignId,
      channel: "LinkedIn",
      body: "Let's talk",
      intent: "QUALIFIED_INTEREST",
      confidence: 0.82,
      reasoning: "",
      suggestedAction: "",
      draftResponse: "",
      handled: true,
      slaDueAt: null,
      receivedAt: "2026-07-10T11:00:00.000Z",
    },
  ],
  bookings: [booking],
  wins: [],
};

const win = deriveWinRecord(state, candidate, campaign, booking);

ok("win links the booking", win.bookingId === booking.id);
ok("win records candidate", win.candidateId === candidateId && win.candidateName === "Ada Win");
ok("win records campaign", win.campaignId === campaignId && win.campaignTitle === "Platform Search");
ok("touchCount counts only history-joined real completed sends", win.touchCount === 2);
ok("dry-run touch is excluded", win.touchCount < candidate.outreachHistory.length);
ok("unjoined real message is excluded", win.outreachChannel === "LinkedIn");
ok("winning channel is the last real send channel", win.outreachChannel === "LinkedIn");
ok("timeToBookMs uses earliest real send", win.timeToBookMs === 4 * 3_600_000);
ok("newest reply intent is captured", win.triggeringReplyIntent?.intent === "QUALIFIED_INTEREST");
ok("newest reply confidence is captured", win.triggeringReplyIntent?.confidence === 0.82);
ok("message traits come from the winning joined message", win.messageTraits.tone === "Executive");
ok("message subject length captured", win.messageTraits.subjectLength === "Second real".length);
ok("message body length captured", win.messageTraits.bodyLength === "Second real body".length);
ok("role title captured", win.roleTitle === "Principal Platform Engineer");
ok("seniority captured", win.seniority === "Principal");

function oldWin(i: number): WinRecord {
  return { ...win, id: `old-${i}`, bookingId: `old-booking-${i}`, at: `2026-07-09T${String(i % 24).padStart(2, "0")}:00:00.000Z` };
}

const stateWithFullWinlog: HermesState = {
  ...state,
  wins: Array.from({ length: WIN_RECORD_LIMIT }, (_, i) => oldWin(i)),
};
const capped = appendWinRecord(stateWithFullWinlog, candidate, campaign, booking);
ok("append keeps the winlog bounded at 500", capped.wins.length === WIN_RECORD_LIMIT);
ok("new win is prepended", capped.wins[0].bookingId === booking.id);
ok("oldest win is trimmed", !capped.wins.some((item) => item.id === `old-${WIN_RECORD_LIMIT - 1}`));

const sameVersionWithoutWins = { ...state } as HermesState & { wins?: WinRecord[] };
delete sameVersionWithoutWins.wins;
const normalized = normalizeHermesState(sameVersionWithoutWins as HermesState);
ok("same-version state without wins hydrates to []", Array.isArray(normalized.wins) && normalized.wins.length === 0);

const winlogPage = readFileSync("src/app/winlog/page.tsx", "utf8");
ok("winlog export uses browser download helper", winlogPage.includes('downloadText("winlog.md"'));
ok("winlog page does not import fs", !/from ["']node:fs["']|from ["']fs["']/.test(winlogPage));
ok("winlog page does not write docs/public/_relay/.rocket-fuel", !/docs\/|public\/|_relay\/|\.rocket-fuel\/|writeFile/.test(winlogPage));

console.log(`RESULT winlog: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
