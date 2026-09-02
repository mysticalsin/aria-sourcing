/* ============================================================================
   LINKEDIN CAMPAIGN TARGETING — the section 4 table as a pure function
   (docs/outreach/ARIA-LINKEDIN-CONNECT.md, section 4 and S6).

   decideCampaignAction(person, vendorDegree, events, caps) answers, for one
   person on a launched list, what Aria may do next and which daily limit it
   spends. planCampaignDay orders a list for the day (highest match score
   first, then warm people, then new connects) and holds whoever does not fit
   today's limits as "Waiting for tomorrow's limit". draftConnectNote writes
   the connection note under 200 characters from the campaign brief and the
   person's headline.

   Everything here is deterministic: the clock, the seed and the caps are
   inputs. Nothing here reads a database or sends anything. The human gate is
   an input too: a person whose drafts were not shown at launch is held, and
   no branch below ever adds a person to a launched list.
   ========================================================================== */

import { createHash } from "crypto";
import {
  LINKEDIN_CONNECT_NOTE_MAX,
  effectiveConnectCap,
  effectiveMessageCap,
  loopNextDayStart,
  loopSendTime,
  type LoopControls,
  type LoopQuietHours,
} from "@/lib/linkedin-loop";

/** What the vendor reports about the sender's relationship to the person. */
export type VendorDegree = 1 | 2 | 3 | "unknown";

/** A first message stays short by the plan's own rule (section 4). */
export const LINKEDIN_FIRST_MESSAGE_MAX_WORDS = 80;

/** A connection request nobody answered in this long is marked no-response. */
export const LINKEDIN_CONNECT_PENDING_DAYS = 14;
export const LINKEDIN_CONNECT_PENDING_MS = LINKEDIN_CONNECT_PENDING_DAYS * 24 * 60 * 60_000;

export interface CampaignPerson {
  candidateId: string;
  /** Canonical LinkedIn profile URL. */
  profileUrl: string;
  matchScore: number;
  /** The launch tap covered this person's drafts and those approvals are live. */
  launched: boolean;
}

/** What has happened to this person since launch, as recorded by Aria. */
export interface CampaignPersonEvents {
  /** When the connection request left, ISO. null when none was sent. */
  connectSentAt: string | null;
  /** When CONNECTION_REQUEST_ACCEPTED arrived, ISO. null when it has not. */
  acceptedAt: string | null;
  /** When the first message left, ISO. null when it has not. */
  firstMessageSentAt: string | null;
  /** A reply arrived; the existing reply loop owns the conversation from here. */
  replied: boolean;
  /** Opt-out recorded or detected in the person's text. */
  optedOut: boolean;
}

export const NO_EVENTS: CampaignPersonEvents = {
  connectSentAt: null,
  acceptedAt: null,
  firstMessageSentAt: null,
  replied: false,
  optedOut: false,
};

/** Today's limits and usage for the workspace, plus the clock they are read at. */
export interface CampaignCaps {
  controls: LoopControls | null;
  /** Every LinkedIn message the workspace claimed or sent in its local day. */
  messagesToday: number;
  /** Every connection request the workspace claimed or sent in its local day. */
  connectsToday: number;
  now: Date;
  /** Quiet hours from the launch grant. */
  quiet: LoopQuietHours;
  /** The launch grant's timezone (quiet hours); caps roll in controls.timezone. */
  timezone: string;
}

export type CampaignCounter = "connect" | "message" | "none";

export type CampaignHoldReason =
  | "not-launched"
  | "kill-switch"
  | "sending-off"
  | "first-message-sent"
  | "connect-pending";

export type CampaignDecision =
  /** Not a connection: a connection request with a note under 200 characters. */
  | { action: "connect"; countsAgainst: "connect"; noteMax: number }
  /** A first message under 80 words, either because the person is a connection
   *  already (degree 1) or because the connection request was accepted. */
  | { action: "first-message"; countsAgainst: "message"; trigger: "degree-1" | "accepted"; sendAt: Date; wordMax: number }
  /** A reply arrived: the existing reply loop answers, inside the message cap. */
  | { action: "reply-loop"; countsAgainst: "message" }
  /** Opt-out: every queued connect and message for the person is cancelled. */
  | { action: "cancel"; countsAgainst: "none"; reason: "opted-out" }
  /** Connection request pending over 14 days: marked, never withdrawn, nothing else sent. */
  | { action: "no-response"; countsAgainst: "none"; pendingDays: number }
  /** Today's limit is spent: the person waits for tomorrow, visibly. */
  | { action: "wait"; countsAgainst: "connect" | "message"; reason: "waiting-for-tomorrow-limit"; resumeAt: Date; next: "connect" | "first-message" }
  /** Nothing may happen; the reason is for a person to read. */
  | { action: "hold"; countsAgainst: "none"; reason: CampaignHoldReason };

function seedFor(person: CampaignPerson, trigger: string): string {
  return `${person.candidateId}:${person.profileUrl}:${trigger}`;
}

/** Tomorrow's first send: local midnight of the cap day, jittered, past quiet hours. */
export function waitingResumeAt(caps: CampaignCaps, seed: string): Date {
  const capTimezone = caps.controls?.timezone || caps.timezone;
  return loopSendTime(loopNextDayStart(caps.now, capTimezone), `${seed}:tomorrow`, caps.quiet, caps.timezone);
}

function firstMessage(person: CampaignPerson, trigger: "degree-1" | "accepted", caps: CampaignCaps): CampaignDecision {
  if (caps.messagesToday >= effectiveMessageCap(caps.controls)) {
    return {
      action: "wait",
      countsAgainst: "message",
      reason: "waiting-for-tomorrow-limit",
      resumeAt: waitingResumeAt(caps, seedFor(person, trigger)),
      next: "first-message",
    };
  }
  return {
    action: "first-message",
    countsAgainst: "message",
    trigger,
    sendAt: loopSendTime(caps.now, seedFor(person, trigger), caps.quiet, caps.timezone),
    wordMax: LINKEDIN_FIRST_MESSAGE_MAX_WORDS,
  };
}

/**
 * The section 4 table for one person. Read top to bottom, every early return
 * is fail closed:
 *   opt-out            → cancel (nothing is ever sent to someone who said stop)
 *   not launched       → hold (the human gate; agents never widen a launch)
 *   kill switch / off  → hold
 *   replied            → the reply loop, message cap
 *   first message sent → hold (targeting is done with this person)
 *   accepted           → first message 2 to 10 minutes out, message cap
 *   connect pending    → no-response after 14 days, otherwise hold
 *   degree 1           → first message, message cap
 *   degree 2, 3, unknown → connection request, connect cap
 * A spent cap turns a send into a wait for tomorrow's limit.
 */
export function decideCampaignAction(
  person: CampaignPerson,
  vendorDegree: VendorDegree,
  events: CampaignPersonEvents,
  caps: CampaignCaps,
): CampaignDecision {
  if (events.optedOut) return { action: "cancel", countsAgainst: "none", reason: "opted-out" };
  if (!person.launched) return { action: "hold", countsAgainst: "none", reason: "not-launched" };
  if (!caps.controls || caps.controls.killSwitch) return { action: "hold", countsAgainst: "none", reason: "kill-switch" };
  if (!caps.controls.loopEnabled) return { action: "hold", countsAgainst: "none", reason: "sending-off" };
  if (events.replied) return { action: "reply-loop", countsAgainst: "message" };
  if (events.firstMessageSentAt) return { action: "hold", countsAgainst: "none", reason: "first-message-sent" };
  if (events.acceptedAt) return firstMessage(person, "accepted", caps);
  if (events.connectSentAt) {
    const sentAt = Date.parse(events.connectSentAt);
    const pendingMs = Number.isFinite(sentAt) ? caps.now.getTime() - sentAt : 0;
    if (pendingMs > LINKEDIN_CONNECT_PENDING_MS) {
      return { action: "no-response", countsAgainst: "none", pendingDays: Math.floor(pendingMs / (24 * 60 * 60_000)) };
    }
    return { action: "hold", countsAgainst: "none", reason: "connect-pending" };
  }
  if (vendorDegree === 1) return firstMessage(person, "degree-1", caps);
  if (caps.connectsToday >= effectiveConnectCap(caps.controls)) {
    return {
      action: "wait",
      countsAgainst: "connect",
      reason: "waiting-for-tomorrow-limit",
      resumeAt: waitingResumeAt(caps, seedFor(person, "connect")),
      next: "connect",
    };
  }
  return { action: "connect", countsAgainst: "connect", noteMax: LINKEDIN_CONNECT_NOTE_MAX };
}

// ---------------------------------------------------------------------------
// The day plan: ordering and the cap hold across a list
// ---------------------------------------------------------------------------

export interface CampaignPlanInput {
  person: CampaignPerson;
  /** What LinkedIn reports about the relationship; "unknown" until it does. */
  degree: VendorDegree;
  events: CampaignPersonEvents;
}

export interface CampaignPlanEntry extends CampaignPlanInput {
  decision: CampaignDecision;
}

export interface CampaignDayPlan {
  /** Every person, in send order, with the decision after today's limits are allocated. */
  entries: CampaignPlanEntry[];
  /** People who send today, per counter. */
  today: { connects: number; messages: number };
  /** People shown as waiting for tomorrow's limit. */
  waiting: number;
}

/** Warm people (accepted) come before new connects when scores tie. */
function warmth(d: CampaignDecision): number {
  if (d.action === "first-message" && d.trigger === "accepted") return 0;
  if (d.action === "wait" && d.next === "first-message") return 0;
  if (d.action === "reply-loop") return 0;
  if (d.action === "first-message") return 1;
  if (d.action === "connect" || (d.action === "wait" && d.next === "connect")) return 2;
  return 3;
}

/**
 * Order a launched list for the day and allocate today's limits: highest
 * match score first, then people whose connect was accepted (warm), then new
 * connects. Each send spends one slot of its counter; when a counter is spent
 * the rest of that kind wait for tomorrow, visible as
 * "Waiting for tomorrow's limit". Nobody is added, nobody is reordered past
 * someone with a higher score.
 */
export function planCampaignDay(inputs: CampaignPlanInput[], caps: CampaignCaps): CampaignDayPlan {
  const decided = inputs.map((input) => ({ ...input, decision: decideCampaignAction(input.person, input.degree, input.events, caps) }));
  decided.sort(
    (a, b) =>
      b.person.matchScore - a.person.matchScore ||
      warmth(a.decision) - warmth(b.decision) ||
      a.person.candidateId.localeCompare(b.person.candidateId),
  );

  let messagesLeft = Math.max(0, effectiveMessageCap(caps.controls) - caps.messagesToday);
  let connectsLeft = Math.max(0, effectiveConnectCap(caps.controls) - caps.connectsToday);
  const today = { connects: 0, messages: 0 };
  let waiting = 0;
  const entries: CampaignPlanEntry[] = decided.map((entry) => {
    const { decision, person } = entry;
    if (decision.action === "first-message") {
      if (messagesLeft > 0) {
        messagesLeft--;
        today.messages++;
        return entry;
      }
      waiting++;
      return {
        ...entry,
        decision: {
          action: "wait",
          countsAgainst: "message",
          reason: "waiting-for-tomorrow-limit",
          resumeAt: waitingResumeAt(caps, seedFor(person, decision.trigger)),
          next: "first-message",
        },
      };
    }
    if (decision.action === "connect") {
      if (connectsLeft > 0) {
        connectsLeft--;
        today.connects++;
        return entry;
      }
      waiting++;
      return {
        ...entry,
        decision: {
          action: "wait",
          countsAgainst: "connect",
          reason: "waiting-for-tomorrow-limit",
          resumeAt: waitingResumeAt(caps, seedFor(person, "connect")),
          next: "connect",
        },
      };
    }
    if (decision.action === "wait") waiting++;
    return entry;
  });
  return { entries, today, waiting };
}

// ---------------------------------------------------------------------------
// The connection note
// ---------------------------------------------------------------------------

export interface ConnectNotePerson {
  name: string;
  /** "Title at Company" as the launch sheet shows it; may be empty. */
  headline: string;
}

export interface ConnectNoteBrief {
  roleTitle: string;
  /** Concrete place when the brief names one, e.g. "Paris". */
  location?: string;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function clean(value: string): string {
  return value.replace(/[—–]/g, ",").replace(/\s+/g, " ").trim();
}

/**
 * A connection note under 200 characters, original copy: who is writing, what
 * the role is, why this person. Longest variant that fits wins; the headline
 * clause goes first when space runs out, then the location. Never mentions a
 * tool. Deterministic for the same person and brief, so the note shown at
 * launch hashes to the same approval every time it is rebuilt.
 */
export function draftConnectNote(person: ConnectNotePerson, brief: ConnectNoteBrief): string {
  const name = firstName(clean(person.name));
  const role = clean(brief.roleTitle);
  const place = clean(brief.location ?? "");
  const headline = clean(person.headline);

  const greeting = name ? `Hi ${name}, ` : "Hi, ";
  const roleClause = role ? `I am hiring for a ${role}${place ? ` role in ${place}` : " role"}.` : "I am hiring for a new role on my team.";
  const roleClauseShort = role ? `I am hiring for a ${role} role.` : "I am hiring for a new role.";
  const whyClause = headline ? ` Your work as ${headline} stood out.` : "";
  const close = " Happy to connect?";

  const variants = [
    `${greeting}${roleClause}${whyClause}${close}`,
    `${greeting}${roleClause}${close}`,
    `${greeting}${roleClauseShort}${close}`,
    `${greeting}I am hiring and would like to connect.`,
  ];
  const fit = variants.find((v) => v.length <= LINKEDIN_CONNECT_NOTE_MAX);
  return fit ?? variants[variants.length - 1]!.slice(0, LINKEDIN_CONNECT_NOTE_MAX);
}

/**
 * Stable draft id for a person's connection note in a campaign: the launch
 * approval, the outbox row's approval_message_id and the sheet all use it,
 * so a re-tap after an edit replaces the hash instead of adding a row.
 */
export function connectDraftId(campaignId: string, candidateId: string): string {
  return `connect-${createHash("sha256").update(`${campaignId}\n${candidateId}`).digest("hex").slice(0, 32)}`;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Original Aria copy for the sheet. No em dashes, no vendor, never AI. */
export const TARGETING_COPY = {
  connectFirst: "Connection request first",
  firstMessage: "First message",
  firstMessageAfterAccept: "First message once they accept",
  replyLoop: "In conversation",
  optedOut: "Opted out, nothing more is sent",
  noResponse: "No answer after 14 days, nothing more is sent",
  connectPending: "Connection request pending",
  firstMessageSent: "First message sent",
  waitingForLimit: "Waiting for tomorrow's limit",
  notLaunched: "Not launched yet",
  sendingOff: "LinkedIn sending is off in Settings",
  connectionNote: "Connection note",
  noteTooLong: "The connection note must stay under 200 characters.",
  messageTooLong: "The first message must stay under 80 words.",
} as const;

/** The badge a person's row shows in the launch sheet for a decision. */
export function decisionLabel(decision: CampaignDecision): string {
  switch (decision.action) {
    case "connect":
      return TARGETING_COPY.connectFirst;
    case "first-message":
      return decision.trigger === "accepted" ? TARGETING_COPY.firstMessageAfterAccept : TARGETING_COPY.firstMessage;
    case "reply-loop":
      return TARGETING_COPY.replyLoop;
    case "cancel":
      return TARGETING_COPY.optedOut;
    case "no-response":
      return TARGETING_COPY.noResponse;
    case "wait":
      return TARGETING_COPY.waitingForLimit;
    case "hold":
      switch (decision.reason) {
        case "not-launched":
          return TARGETING_COPY.notLaunched;
        case "connect-pending":
          return TARGETING_COPY.connectPending;
        case "first-message-sent":
          return TARGETING_COPY.firstMessageSent;
        default:
          return TARGETING_COPY.sendingOff;
      }
  }
}
