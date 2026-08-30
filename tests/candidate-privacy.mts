import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  anonymizeCandidateRecord,
  anonymizeHermesState,
  isCandidateErasureTombstone,
  preserveCandidateErasureTombstones,
  redactCandidateLinkedActivities,
} from "../src/lib/candidate-privacy";
import { historicalCandidate, historicalSeedState } from "./seed-fixtures.mts";
import type { Activity, Candidate, ChatThread } from "../src/lib/types";

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const drawerSource = readFileSync(
  new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url),
  "utf8",
);

function sensitiveCandidate(): Candidate {
  const candidate = structuredClone(historicalCandidate());
  return {
    ...candidate,
    id: "33333333-3333-4333-8333-333333333333",
    campaignId: "campaign-1",
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+14165550123",
    currentTitle: "Secret title",
    currentCompany: "Secret company",
    location: "London",
    timezone: "Europe/London",
    linkedinUrl: "https://linkedin.example/ada",
    githubUrl: "https://github.example/ada",
    sourceUrl: "https://source.example/ada",
    sourceExternalId: "provider-person-1",
    sourceAuthorityId: "22222222-2222-4222-8222-222222222222",
    sourcePlatform: "Apollo",
    sourceQuery: "Ada unique query",
    recentActivity: "Ada changed jobs",
    notes: [{ id: "note-1", text: "Personal note", at: "2026-07-13T00:00:00.000Z" }],
    rejectionReason: "Personal assessment",
    referredBy: "Employee Name",
    dna: ["Personal trait"],
  };
}

test("candidate anonymization removes direct identifiers, authority, content, and contactability", () => {
  const redacted = anonymizeCandidateRecord(sensitiveCandidate());
  assert.equal(redacted.name, "Anonymized Candidate");
  assert.equal(redacted.email, "");
  assert.equal(redacted.phone, "");
  assert.equal(redacted.currentTitle, "");
  assert.equal(redacted.currentCompany, "");
  assert.equal(redacted.location, "");
  assert.equal(redacted.linkedinUrl, "");
  assert.equal(redacted.githubUrl, "");
  assert.equal(redacted.sourceUrl, undefined);
  assert.equal(redacted.sourceExternalId, undefined);
  assert.equal(redacted.sourceAuthorityId, undefined);
  assert.equal(redacted.sourceQuery, "");
  assert.deepEqual(redacted.matchBreakdown, []);
  assert.deepEqual(redacted.techStack, []);
  assert.deepEqual(redacted.outreachHistory, []);
  assert.deepEqual(redacted.replyHistory, []);
  assert.deepEqual(redacted.notes, []);
  assert.deepEqual(redacted.interviews, []);
  assert.deepEqual(redacted.dna, []);
  assert.equal(redacted.stage, "Suppressed");
  assert.equal(redacted.complianceFlags.anonymized, true);
  assert.equal(redacted.complianceFlags.doNotContact, true);
  assert.equal(redacted.complianceFlags.suppressed, true);
  assert.equal(redacted.complianceFlags.unsubscribed, true);
  assert.equal(JSON.stringify(redacted).includes("Ada Lovelace"), false);
  assert.equal(JSON.stringify(redacted).includes("ada@example.test"), false);
  assert.equal(JSON.stringify(redacted).includes("provider-person-1"), false);
});

test("candidate erasure tombstones remain immutable across later local mutations", () => {
  const state = historicalSeedState();
  const candidate = state.candidates[0];
  const tombstone = anonymizeCandidateRecord(candidate);
  const current = {
    ...state,
    candidates: [tombstone, ...state.candidates.slice(1)],
  };
  const rewritten = {
    ...current,
    candidates: current.candidates.map((item) => item.id === tombstone.id
      ? {
          ...item,
          name: "Restored Person",
          stage: "Sourced" as const,
          complianceFlags: {
            ...item.complianceFlags,
            anonymized: false,
            doNotContact: false,
            suppressed: false,
          },
        }
      : item),
  };

  assert.equal(isCandidateErasureTombstone(tombstone), true);
  assert.strictEqual(preserveCandidateErasureTombstones(current, rewritten), current);
  assert.strictEqual(
    preserveCandidateErasureTombstones(current, { ...rewritten, candidates: rewritten.candidates.slice(1) }),
    current,
  );
  const unrelated = { ...current, activeCampaignId: "another-campaign" };
  assert.strictEqual(preserveCandidateErasureTombstones(current, unrelated), unrelated);
});

test("candidate-linked activities are redacted without changing unrelated audit facts", () => {
  const activities: Activity[] = [
    {
      id: "activity-1",
      type: "compliance",
      title: "Ada Lovelace enriched",
      notes: "ada@example.test",
      outcome: "Email revealed",
      campaignId: "campaign-1",
      linkedEntityType: "candidate",
      linkedEntityId: "candidate-1",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    {
      id: "activity-2",
      type: "sourcing",
      title: "Campaign sourced",
      notes: "No candidate content",
      outcome: "Complete",
      campaignId: "campaign-1",
      linkedEntityType: "campaign",
      linkedEntityId: "campaign-1",
      createdAt: "2026-07-13T00:01:00.000Z",
    },
  ];
  const result = redactCandidateLinkedActivities(activities, "candidate-1");
  assert.deepEqual(result[0], {
    ...activities[0],
    title: "Candidate activity redacted",
    notes: "Candidate-linked content was removed during anonymization.",
    outcome: "Redacted",
  });
  assert.deepEqual(result[1], activities[1]);
});

test("state anonymization removes structured candidate PII across linked collections", () => {
  const state = historicalSeedState();
  const candidate = sensitiveCandidate();
  const candidateId = candidate.id;
  const campaignId = state.campaigns[0].id;
  const canary = "ARIA-PII-CANARY-9f7c";
  candidate.campaignId = campaignId;
  candidate.name = canary;
  candidate.email = `${canary.toLowerCase()}@example.test`;
  candidate.phone = "+14165550123";
  state.candidates = [candidate, ...state.candidates.filter((item) => item.id !== candidateId)];
  state.outreach = [{
    id: "outreach-canary",
    candidateId,
    campaignId,
    channel: "Email",
    subject: canary,
    body: canary,
    tone: "Executive",
    personalizationEvidence: [canary],
    status: "Draft",
    sequenceStep: 1,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: "2026-07-13T00:00:00.000Z",
  }];
  state.replies = [{
    id: "reply-canary",
    candidateId,
    campaignId,
    channel: "Email",
    body: canary,
    intent: "INTERESTED",
    confidence: 1,
    reasoning: canary,
    suggestedAction: canary,
    draftResponse: canary,
    handled: false,
    slaDueAt: null,
    receivedAt: "2026-07-13T00:00:00.000Z",
    fromAddress: candidate.email,
    messageId: "message-canary",
  }];
  state.bookings = [{
    id: "booking-canary",
    candidateId,
    campaignId,
    candidateName: canary,
    role: canary,
    startTime: "2026-07-14T00:00:00.000Z",
    endTime: "2026-07-14T01:00:00.000Z",
    timezone: "UTC",
    interviewer: "Interviewer",
    interviewerEmail: "interviewer@example.test",
    teamsLink: `https://teams.example/${canary}`,
    calLink: `https://cal.example/${canary}`,
    status: "Confirmed",
    agenda: [canary],
    createdAt: "2026-07-13T00:00:00.000Z",
  }];
  state.wins = [{
    id: "win-canary",
    at: "2026-07-13T00:00:00.000Z",
    candidateId,
    candidateName: canary,
    campaignId,
    campaignTitle: "Campaign",
    bookingId: "booking-canary",
    sourcePlatform: "Apollo",
    leadSource: "Outbound",
    matchScore: 90,
    seniority: "Senior",
    roleTitle: canary,
    outreachChannel: "Email",
    touchCount: 1,
    timeToBookMs: 1,
    triggeringReplyIntent: null,
    messageTraits: {},
  }];
  state.ledger = [{
    id: "ledger-canary",
    candidateId,
    candidateEmail: candidate.email,
    seatId: "seat-1",
    campaignId,
    channel: "Email",
    status: "sent",
    reason: canary,
    at: "2026-07-13T00:00:00.000Z",
  }];
  state.suppression = [{
    id: "suppression-canary",
    type: "email",
    value: candidate.email,
    reason: canary,
    source: "Operator",
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: null,
  }];
  const relatedActivity: Activity = {
    id: "activity-related",
    type: "outreach",
    title: canary,
    notes: canary,
    outcome: canary,
    campaignId,
    linkedEntityType: "outreach",
    linkedEntityId: "outreach-canary",
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  state.activities = [relatedActivity];
  state.campaigns = state.campaigns.map((campaign) =>
    campaign.id === campaignId ? { ...campaign, activities: [relatedActivity] } : campaign,
  );
  state.ingestedMessageIds = ["message-canary", "message-unrelated"];
  state.chatboxSubmissions = [{
    id: "submission-canary",
    path: "A",
    campaignId,
    roleTitle: canary,
    firstName: canary,
    lastName: canary,
    email: candidate.email,
    phone: candidate.phone,
    detected: { nationality: canary },
    answers: [],
    score: { total: 0, location: 0, visa: 0, keySkill: 0, project: 0, availability: 0 },
    starRating: "C",
    status: "advanced",
    handoffCandidateId: candidateId,
    createdAt: "2026-07-13T00:00:00.000Z",
  }];

  const redacted = anonymizeHermesState(state, candidateId);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes(candidate.email), false);
  assert.equal(serialized.includes(candidate.phone), false);
  assert.equal(redacted.outreach.some((item) => item.candidateId === candidateId), false);
  assert.equal(redacted.replies.some((item) => item.candidateId === candidateId), false);
  assert.equal(redacted.bookings.some((item) => item.candidateId === candidateId), false);
  assert.equal(redacted.wins[0].candidateName, "Anonymized Candidate");
  assert.equal(redacted.ledger[0].candidateEmail, "");
  assert.deepEqual(redacted.ingestedMessageIds, ["message-unrelated"]);
  assert.equal(redacted.chatboxSubmissions?.length, 0);
});

test("legacy campaign-linked intake activities are redacted by exact identity tokens", () => {
  const state = historicalSeedState();
  const candidate = sensitiveCandidate();
  candidate.campaignId = state.campaigns[0].id;
  state.candidates = [candidate, ...state.candidates];
  const legacy: Activity = {
    id: "legacy-intake",
    type: "sourcing",
    title: `Added ${candidate.name} from GitHub`,
    notes: `Provider profile ${candidate.githubUrl}`,
    outcome: "Added",
    campaignId: candidate.campaignId,
    linkedEntityType: "campaign",
    linkedEntityId: candidate.campaignId,
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  state.activities = [legacy];
  state.campaigns = state.campaigns.map((campaign) =>
    campaign.id === candidate.campaignId ? { ...campaign, activities: [legacy] } : campaign,
  );
  const redacted = anonymizeHermesState(state, candidate.id);
  assert.equal(redacted.activities[0].title, "Candidate activity redacted");
  assert.equal(redacted.campaigns[0].activities[0].notes.includes(candidate.githubUrl), false);
});

test("identity matching preserves unrelated activity words that merely contain a candidate name", () => {
  const state = historicalSeedState();
  const candidate = sensitiveCandidate();
  candidate.campaignId = state.campaigns[0].id;
  candidate.name = "Ian";
  candidate.email = "ian@example.test";
  candidate.linkedinUrl = "";
  candidate.githubUrl = "";
  candidate.sourceUrl = undefined;
  candidate.sourceExternalId = undefined;
  state.candidates = [candidate, ...state.candidates];
  const unrelated: Activity = {
    id: "unrelated-compliance-audit",
    type: "compliance",
    title: "Compliance review passed",
    notes: "Annual policy control verified",
    outcome: "Approved",
    campaignId: candidate.campaignId,
    linkedEntityType: "campaign",
    linkedEntityId: candidate.campaignId,
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  state.activities = [unrelated];

  const redacted = anonymizeHermesState(state, candidate.id);

  assert.deepEqual(redacted.activities[0], unrelated);
});

test("short names redact only exact campaign-scoped legacy activity tokens", () => {
  const state = historicalSeedState();
  const candidate = sensitiveCandidate();
  candidate.campaignId = state.campaigns[0].id;
  candidate.name = "Al";
  candidate.email = "";
  candidate.phone = "";
  candidate.linkedinUrl = "";
  candidate.githubUrl = "";
  candidate.sourceUrl = undefined;
  candidate.sourceExternalId = undefined;
  state.candidates = [candidate, ...state.candidates];
  const exact: Activity = {
    id: "short-name-exact",
    type: "sourcing",
    title: "Added Al manually",
    notes: "Operator-entered candidate",
    outcome: "Added",
    campaignId: candidate.campaignId,
    linkedEntityType: "campaign",
    linkedEntityId: candidate.campaignId,
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  const unrelated: Activity = {
    ...exact,
    id: "short-name-substring",
    title: "Allocation completed",
  };
  state.activities = [exact, unrelated];

  const redacted = anonymizeHermesState(state, candidate.id);

  assert.equal(redacted.activities[0].title, "Candidate activity redacted");
  assert.deepEqual(redacted.activities[1], unrelated);
});

test("structured chats redact exact candidate identities without corrupting unrelated conversation", () => {
  const state = historicalSeedState();
  const candidate = sensitiveCandidate();
  candidate.campaignId = state.campaigns[0].id;
  candidate.name = "Ian";
  candidate.email = "ian@example.test";
  candidate.linkedinUrl = "";
  candidate.githubUrl = "";
  candidate.sourceUrl = undefined;
  candidate.sourceExternalId = undefined;
  state.candidates = [candidate, ...state.candidates];
  const thread: ChatThread = {
    id: "chat-candidate-pii",
    seatId: "seat-1",
    title: "Research Ian",
    messages: [
      {
        id: "chat-sensitive",
        role: "user",
        content: "Email: ian@example.test.",
        at: "2026-07-13T00:00:00.000Z",
      },
      {
        id: "chat-unrelated",
        role: "assistant",
        content: "Compliance review passed for the annual policy.",
        at: "2026-07-13T00:01:00.000Z",
      },
    ],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:01:00.000Z",
  };
  state.chats = [thread];

  const redacted = anonymizeHermesState(state, candidate.id);
  const serialized = JSON.stringify(redacted.chats).toLowerCase();

  assert.equal(serialized.includes("ian@example.test"), false);
  assert.equal(redacted.chats[0].title, "Candidate conversation redacted");
  assert.equal(redacted.chats[0].messages[0].content, "Candidate-linked content was removed during anonymization.");
  assert.deepEqual(redacted.chats[0].messages[1], thread.messages[1]);
});

test("manual, GitHub, and chatbox intake canaries do not survive full-state anonymization", () => {
  for (const source of ["Manual", "GitHub", "Applicant"] as const) {
    const state = historicalSeedState();
    const candidate = sensitiveCandidate();
    candidate.campaignId = state.campaigns[0].id;
    candidate.sourcePlatform = source === "Applicant" ? "Manual" : source;
    candidate.name = `${source} Canary Person`;
    candidate.githubUrl = source === "GitHub" ? "https://github.com/github-canary-operator" : "";
    state.candidates = [candidate, ...state.candidates];
    const exposed = source === "GitHub" ? "github-canary-operator" : candidate.name;
    const activity: Activity = {
      id: `activity-${source}`,
      type: "sourcing",
      title: source === "Applicant" ? `Applicant handed off: ${exposed}` : `Added ${exposed}`,
      notes: `Legacy ${source} intake`,
      outcome: "Added",
      campaignId: candidate.campaignId,
      linkedEntityType: "campaign",
      linkedEntityId: candidate.campaignId,
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    state.activities = [activity];
    state.campaigns = state.campaigns.map((campaign) =>
      campaign.id === candidate.campaignId ? { ...campaign, activities: [activity] } : campaign,
    );
    if (source === "Applicant") {
      state.chatboxSubmissions = [{
        id: "submission-applicant",
        path: "A",
        campaignId: candidate.campaignId,
        roleTitle: "Role",
        firstName: "Applicant",
        lastName: "Canary Person",
        email: candidate.email,
        phone: candidate.phone ?? "",
        detected: {},
        answers: [],
        score: { total: 0, location: 0, visa: 0, keySkill: 0, project: 0, availability: 0 },
        starRating: "C",
        status: "advanced",
        handoffCandidateId: candidate.id,
        createdAt: "2026-07-13T00:00:00.000Z",
      }];
    }
    const redacted = anonymizeHermesState(state, candidate.id);
    assert.equal(JSON.stringify(redacted).toLowerCase().includes(exposed.toLowerCase()), false, source);
  }
});

test("candidate-rights UI waits for server erasure and shared persistence before success", () => {
  const actionStart = storeSource.indexOf("const anonymizeCandidate = useCallback(async");
  const actionEnd = storeSource.indexOf("const exportCandidate", actionStart);
  const action = storeSource.slice(actionStart, actionEnd);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  assert.ok(action.indexOf('workspaceFetch("/api/admin/candidates/erasure"') >= 0);
  assert.doesNotMatch(action, /\/api\/admin\/source\/apollo\/erasure/);
  assert.match(action, /\(status === "completed"\) !== receipt\.completed/);
  assert.match(action, /invalid authority receipt/i);
  const liveResultStart = action.indexOf("let response: Response;");
  const liveResult = action.slice(liveResultStart);
  assert.ok(liveResultStart >= 0);
  assert.match(liveResult, /await hydrateWorkspace\(\)/);
  const receiptValidated = liveResult.indexOf("invalid authority receipt");
  const localMask = liveResult.indexOf("anonymizeHermesState");
  const hydration = liveResult.indexOf("await hydrateWorkspace()");
  assert.ok(
    receiptValidated >= 0 && localMask > receiptValidated && hydration > localMask,
    "live erasure must mask the candidate only after a valid server receipt and before hydration",
  );
  assert.match(
    liveResult,
    /try\s*\{\s*await hydrateWorkspace\(\);\s*\}\s*catch\s*\{[\s\S]*server erasure receipt remains authoritative/,
  );
  assert.match(drawerSource, /const result = await actions\.anonymizeCandidate\(c\.id\)/);
  assert.match(drawerSource, /if \(!result\.ok\)[\s\S]*Candidate anonymization failed/);
  assert.match(drawerSource, /invalidateErasureRequests\(\);\s*onClose\(\)/);
  assert.match(drawerSource, /\/api\/admin\/candidates\/erasure[\s\S]*method: "PATCH"[\s\S]*action: "list"/);
  assert.match(drawerSource, /action: "inspect"/);
  assert.match(drawerSource, /action: "complete"/);
  assert.match(drawerSource, /Evidence SHA-256/);
});
