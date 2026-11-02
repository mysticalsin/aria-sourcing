/* ============================================================================
   AI activities: the business reason behind each Claude call.

   A "task" (outreach, classify, extract, chat, sourcing) picks the model and
   its settings. An "activity" says what the recruiter got out of the call
   (a first-contact draft, a follow-up, a sorted reply...), so the cost page
   can show which activity costs most and what each one buys. Client-safe:
   no server imports.
   ========================================================================== */

export const AI_ACTIVITY_IDS = [
  "first-contact",
  "follow-up",
  "re-contact",
  "rewrite",
  "reply-triage",
  "reply-answer",
  "brief-extraction",
  "assistant-chat",
  "sourcing-agent",
  "untracked",
] as const;

export type AiActivity = (typeof AI_ACTIVITY_IDS)[number];

export interface AiActivityInfo {
  id: AiActivity;
  label: string;
  /** What one call produces, in the recruiter's words. */
  produces: string;
  /** Singular noun for one call's output ("draft", "reply"). */
  unit: string;
  /** Model tier and why it is the right one for this job. */
  model: "Haiku" | "Sonnet" | "Mixed";
  why: string;
}

export const AI_ACTIVITIES: Record<AiActivity, AiActivityInfo> = {
  "first-contact": {
    id: "first-contact",
    label: "First-contact messages",
    produces: "A personalised first message for a candidate, written from their recent work.",
    unit: "draft",
    model: "Sonnet",
    why: "Candidate-facing writing decides the reply rate, so it uses the stronger writer at medium effort.",
  },
  "follow-up": {
    id: "follow-up",
    label: "Follow-ups",
    produces: "A follow-up for someone who has not answered, with a new angle.",
    unit: "follow-up",
    model: "Sonnet",
    why: "Still read by the candidate, so it keeps the writer model; follow-ups are drafted only when due.",
  },
  "re-contact": {
    id: "re-contact",
    label: "Talent pool re-contact",
    produces: "A message that reopens the conversation with someone from the talent pool.",
    unit: "message",
    model: "Sonnet",
    why: "Re-engaging a past candidate is delicate writing; it runs only when a re-contact date arrives.",
  },
  rewrite: {
    id: "rewrite",
    label: "Draft rewrites",
    produces: "A new version of a draft after the recruiter changes the tone or asks to regenerate.",
    unit: "rewrite",
    model: "Sonnet",
    why: "Only on request: each click is one rewrite of a draft the recruiter is about to approve.",
  },
  "reply-triage": {
    id: "reply-triage",
    label: "Reply sorting",
    produces: "The intent of an incoming reply (interested, not now, referral…) with a suggested next step.",
    unit: "reply",
    model: "Haiku",
    why: "Classification is short and structured, so the smallest model does it for a fraction of a cent.",
  },
  "reply-answer": {
    id: "reply-answer",
    label: "Answers to replies",
    produces: "A draft answer to a candidate who replied and is waiting for us.",
    unit: "answer",
    model: "Haiku",
    why: "The answer comes with the classification in one small call, then waits for approval.",
  },
  "brief-extraction": {
    id: "brief-extraction",
    label: "Brief reading",
    produces: "A structured hiring brief read from a manager's email or job description.",
    unit: "brief",
    model: "Haiku",
    why: "Extraction into a fixed JSON schema needs accuracy, not style: the small model is enough.",
  },
  "assistant-chat": {
    id: "assistant-chat",
    label: "Assistant chat",
    produces: "An answer from the Ask Aria assistant, possibly after searching candidates.",
    unit: "answer",
    model: "Sonnet",
    why: "Open questions and tool use need reasoning; low effort keeps each answer short.",
  },
  "sourcing-agent": {
    id: "sourcing-agent",
    label: "Sourcing agent",
    produces: "One round of the sourcing agent: plan a search, call a source, read the results.",
    unit: "round",
    model: "Sonnet",
    why: "Deciding where and how to search is the hardest reasoning in the app; rounds are capped per run.",
  },
  untracked: {
    id: "untracked",
    label: "Before activity tracking",
    produces: "Calls made before costs were split by activity.",
    unit: "call",
    model: "Mixed",
    why: "Kept so the month total stays exact.",
  },
};

export function isAiActivity(value: unknown): value is AiActivity {
  return typeof value === "string" && (AI_ACTIVITY_IDS as readonly string[]).includes(value);
}

/** Best guess when a caller does not say why it called (older clients). */
export function defaultActivityForTask(task: string): AiActivity {
  switch (task) {
    case "classify":
      return "reply-triage";
    case "extract":
      return "brief-extraction";
    case "sourcing":
      return "sourcing-agent";
    case "chat":
      return "assistant-chat";
    case "outreach":
      return "first-contact";
    default:
      return "untracked";
  }
}
