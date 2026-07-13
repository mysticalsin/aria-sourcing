import type { Activity, Candidate, ChatThread, HermesState } from "@/lib/types";

const REDACTED_ACTIVITY = {
  title: "Candidate activity redacted",
  notes: "Candidate-linked content was removed during anonymization.",
  outcome: "Redacted",
} as const;

const REDACTED_CHAT_TITLE = "Candidate conversation redacted";
const REDACTED_CHAT_CONTENT = "Candidate-linked content was removed during anonymization.";
const IDENTITY_CORE = /[\p{L}\p{N}_]/u;
const IDENTITY_JOINER = /[@.+-]/;

export function anonymizeCandidateRecord(candidate: Candidate): Candidate {
  return {
    ...candidate,
    name: "Anonymized Candidate",
    email: "",
    phone: "",
    avatarInitials: "AN",
    currentTitle: "",
    currentCompany: "",
    location: "",
    timezone: "",
    linkedinUrl: "",
    githubUrl: "",
    sourceUrl: undefined,
    sourceExternalId: undefined,
    sourceAuthorityId: undefined,
    sourceQuery: "",
    matchScore: 0,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "Suppressed",
    lastContactedAt: null,
    lastRepliedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      ...candidate.complianceFlags,
      doNotContact: true,
      suppressed: true,
      unsubscribed: true,
      anonymized: true,
      suppressedUntil: null,
      preSuppressionStage:
        candidate.stage === "Suppressed"
          ? candidate.complianceFlags.preSuppressionStage ?? null
          : candidate.stage,
    },
    notes: [],
    rejectionReason: undefined,
    referredBy: undefined,
    starRating: undefined,
    vivier: false,
    silverMedalist: false,
    recontactAt: null,
    prequal: undefined,
    interviews: [],
    dna: [],
  };
}

export function redactCandidateLinkedActivities(
  activities: Activity[],
  candidateId: string,
  relatedEntityIds: ReadonlySet<string> = new Set(),
  sensitiveTokens: ReadonlySet<string> = new Set(),
  candidateCampaignId?: string,
): Activity[] {
  return activities.map((activity) => {
    const content = `${activity.title}\n${activity.notes}\n${activity.outcome}`.toLowerCase();
    const containsSensitiveToken = containsSensitiveIdentity(
      content,
      sensitiveTokens,
      Boolean(candidateCampaignId && activity.campaignId === candidateCampaignId),
    );
    return (activity.linkedEntityType === "candidate" && activity.linkedEntityId === candidateId) ||
      (activity.linkedEntityId !== null && relatedEntityIds.has(activity.linkedEntityId)) ||
      containsSensitiveToken
      ? { ...activity, ...REDACTED_ACTIVITY }
      : activity;
  });
}

function normalizedIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^\+/, "");
}

function urlIdentityTokens(value: string | undefined): string[] {
  try {
    const segments = new URL(value ?? "").pathname
      .split("/")
      .map(normalizedIdentity)
      .filter(Boolean);
    const last = segments.at(-1);
    return last && last.length >= 3 ? [last] : [];
  } catch {
    return [];
  }
}

function containsSensitiveIdentity(
  content: string,
  sensitiveTokens: ReadonlySet<string>,
  allowShortTokens = false,
): boolean {
  for (const token of sensitiveTokens) {
    if (!token || (!allowShortTokens && token.length < 3)) continue;
    let offset = 0;
    while (offset <= content.length - token.length) {
      const index = content.indexOf(token, offset);
      if (index < 0) break;
      const before = index > 0 ? content[index - 1] : "";
      const afterIndex = index + token.length;
      const after = afterIndex < content.length ? content[afterIndex] : "";
      const beforeContinues = before && (
        IDENTITY_CORE.test(before) ||
        (IDENTITY_JOINER.test(before) && index > 1 && IDENTITY_CORE.test(content[index - 2]))
      );
      const afterContinues = after && (
        IDENTITY_CORE.test(after) ||
        (IDENTITY_JOINER.test(after) &&
          afterIndex + 1 < content.length &&
          IDENTITY_CORE.test(content[afterIndex + 1]))
      );
      if (!beforeContinues && !afterContinues) return true;
      offset = index + 1;
    }
  }
  return false;
}

function redactCandidateLinkedChats(
  chats: ChatThread[],
  sensitiveTokens: ReadonlySet<string>,
): ChatThread[] {
  return chats.map((thread) => ({
    ...thread,
    title: containsSensitiveIdentity(thread.title.toLowerCase(), sensitiveTokens)
      ? REDACTED_CHAT_TITLE
      : thread.title,
    messages: thread.messages.map((message) =>
      containsSensitiveIdentity(message.content.toLowerCase(), sensitiveTokens)
        ? { ...message, content: REDACTED_CHAT_CONTENT }
        : message,
    ),
  }));
}

export function anonymizeHermesState(state: HermesState, candidateId: string): HermesState {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) return state;

  const relatedEntityIds = new Set<string>([
    ...state.outreach.filter((item) => item.candidateId === candidateId).map((item) => item.id),
    ...state.replies.filter((item) => item.candidateId === candidateId).map((item) => item.id),
    ...state.bookings.filter((item) => item.candidateId === candidateId).map((item) => item.id),
    ...candidate.outreachHistory.map((item) => item.messageId),
    ...candidate.replyHistory.map((item) => item.id),
    ...(candidate.booking ? [candidate.booking.id] : []),
  ]);
  const ingestedMessageIds = new Set(
    state.replies
      .filter((item) => item.candidateId === candidateId)
      .map((item) => item.messageId)
      .filter((value): value is string => Boolean(value)),
  );
  const candidateIdentities = new Set(
    [candidate.email, candidate.phone, candidate.linkedinUrl, candidate.sourceUrl]
      .map(normalizedIdentity)
      .filter(Boolean),
  );
  const sensitiveTokens = new Set(
    [
      candidate.name,
      candidate.email,
      candidate.phone,
      candidate.linkedinUrl,
      candidate.githubUrl,
      candidate.sourceUrl,
      candidate.sourceExternalId,
      ...urlIdentityTokens(candidate.linkedinUrl),
      ...urlIdentityTokens(candidate.githubUrl),
      ...urlIdentityTokens(candidate.sourceUrl),
    ]
      .map(normalizedIdentity)
      .filter(Boolean),
  );

  return {
    ...state,
    candidates: state.candidates.map((item) =>
      item.id === candidateId ? anonymizeCandidateRecord(item) : item,
    ),
    outreach: state.outreach.filter((item) => item.candidateId !== candidateId),
    replies: state.replies.filter((item) => item.candidateId !== candidateId),
    bookings: state.bookings.filter((item) => item.candidateId !== candidateId),
    wins: state.wins.map((win) =>
      win.candidateId === candidateId
        ? { ...win, candidateName: "Anonymized Candidate", roleTitle: "", matchScore: 0 }
        : win,
    ),
    ledger: state.ledger.map((entry) =>
      entry.candidateId === candidateId
        ? { ...entry, candidateEmail: "", reason: entry.reason ? "Redacted" : null }
        : entry,
    ),
    // The server enforcement list has its own controlled retention policy. Its
    // browser mirror must not retain a directly identifying value after erasure.
    suppression: state.suppression.filter(
      (entry) => !candidateIdentities.has(normalizedIdentity(entry.value)),
    ),
    activities: redactCandidateLinkedActivities(
      state.activities,
      candidateId,
      relatedEntityIds,
      sensitiveTokens,
      candidate.campaignId,
    ),
    campaigns: state.campaigns.map((campaign) => ({
      ...campaign,
      activities: redactCandidateLinkedActivities(
        campaign.activities,
        candidateId,
        relatedEntityIds,
        sensitiveTokens,
        candidate.campaignId,
      ),
    })),
    chats: redactCandidateLinkedChats(state.chats, sensitiveTokens),
    ingestedMessageIds: state.ingestedMessageIds?.filter(
      (messageId) => !ingestedMessageIds.has(messageId),
    ),
    chatboxSubmissions: state.chatboxSubmissions?.filter(
      (submission) => submission.handoffCandidateId !== candidateId,
    ),
  };
}
