/* ============================================================================
   LINKEDIN REPLY LOOP — pure decisions for the launched-campaign reply loop.

   Shape (docs/outreach/LINKEDIN-LOOP.md):
     human launches a campaign (grant) → vendor webhook delivers a reply →
     ingest stores the inbound → decideLoopReply() schedules a reply 2 to 10
     minutes out (never instant, never inside quiet hours) → the loop
     dispatcher sends through the configured vendor adapter → booking intent
     creates a real calendar event and a confirmation.

   Everything here is deterministic and side-effect free: the clock, the seed
   and the grant are inputs, so every verdict is reproducible in tests. The
   channel is a parameter because the same loop is meant to carry WhatsApp
   next; nothing in this file knows how a message is delivered.
   ========================================================================== */

import { createHash, timingSafeEqual } from "crypto";

export type LoopChannel = "LinkedIn" | "WhatsApp";

/** Human cadence: a reply lands between two and ten minutes after the inbound. */
export const LOOP_REPLY_DELAY_MIN_MS = 2 * 60_000;
export const LOOP_REPLY_DELAY_MAX_MS = 10 * 60_000;

export interface LoopQuietHours {
  /** Local hour 0-23, inclusive start of the quiet window (e.g. 21). */
  start: number;
  /** Local hour 0-23, exclusive end of the quiet window (e.g. 8). */
  end: number;
}

export const LOOP_DEFAULT_QUIET_HOURS: LoopQuietHours = { start: 21, end: 8 };
export const LOOP_DEFAULT_DAILY_CAP = 20;
export const LOOP_MEETING_MINUTES = 30;

/** The durable record a human creates when they launch a campaign. */
export interface LoopGrant {
  id: string;
  channel: LoopChannel;
  campaignId: string;
  revokedAt: string | null;
  dailyCap: number;
  quietStart: number;
  quietEnd: number;
  timezone: string;
}

export interface LoopControls {
  killSwitch: boolean;
  loopEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Webhook secret
// ---------------------------------------------------------------------------

/** Shared-secret header check, constant time. Unset secret always fails. */
export function verifyLoopWebhookSecret(presented: string | null, secret: string): boolean {
  if (!presented || !secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Inbound payload (HeyReach-shaped or generic vendor)
// ---------------------------------------------------------------------------

export interface LoopInboundEvent {
  /** Canonical lowercase linkedin.com/in or /pub profile URL. */
  profileUrl: string;
  text: string;
  /** Vendor message id when present, otherwise a deterministic digest. */
  providerId: string;
  /** Vendor campaign id, used to resolve the launch grant and the tenant. */
  vendorCampaignId: string | null;
  /** Unix milliseconds. */
  receivedAt: number;
  firstName: string;
}

const LINKEDIN_PROFILE_RE = /^https?:\/\/([^/]+\.)?linkedin\.com\/(in|pub)\/.+/i;

const REPLY_EVENT_TYPES = new Set([
  "message_reply_received",
  "inmail_reply_received",
  "message_received",
  "reply",
  "reply_received",
  "inbound_message",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function firstString(source: Record<string, unknown> | null, keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return "";
}

export function normalizeLinkedInProfileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!LINKEDIN_PROFILE_RE.test(trimmed)) return "";
  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `https://${url.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return "";
  }
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? Math.floor(numeric * 1000) : Math.floor(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function parseOneEvent(raw: unknown, now: number): LoopInboundEvent | null {
  const event = record(raw);
  if (!event) return null;
  const type = firstString(event, ["eventType", "event_type", "event", "type"]).toLowerCase();
  // A typed event that is not a reply (connection accepted, profile viewed,
  // campaign completed) never enters the reply loop.
  if (type && !REPLY_EVENT_TYPES.has(type)) return null;

  const lead = record(event.lead) ?? record(event.contact) ?? record(event.profile);
  const profileUrl = normalizeLinkedInProfileUrl(
    firstString(lead, ["profileUrl", "linkedinUrl", "linkedInProfileUrl", "linkedin_url", "url"]) ||
      firstString(event, ["profileUrl", "linkedinUrl", "linkedInProfileUrl", "linkedin_url"]),
  );
  if (!profileUrl) return null;

  const message = record(event.message);
  const text =
    firstString(message, ["text", "body", "content"]) ||
    firstString(event, ["messageText", "message_text", "text", "body", "content"]) ||
    (typeof event.message === "string" ? event.message.trim() : "");
  if (!text) return null;

  const campaign = record(event.campaign);
  const vendorCampaignId =
    firstString(event, ["campaignId", "campaign_id"]) || firstString(campaign, ["id", "campaignId"]) || null;
  const receivedAt = parseTimestamp(
    message?.timestamp ?? message?.createdAt ?? event.timestamp ?? event.receivedAt ?? event.createdAt ?? event.created_at,
    now,
  );
  const explicitId =
    firstString(message, ["id", "messageId"]) || firstString(event, ["messageId", "message_id", "id", "eventId"]);
  const providerId =
    explicitId ||
    createHash("sha256").update(`${vendorCampaignId ?? ""}\n${profileUrl}\n${receivedAt}\n${text}`).digest("hex");
  const firstName = firstString(lead, ["firstName", "first_name"]) || firstString(event, ["firstName", "first_name"]);

  return { profileUrl, text, providerId, vendorCampaignId, receivedAt, firstName };
}

/**
 * Extract candidate replies from a vendor webhook body. Accepts one event, an
 * array, or `{ events: [...] }` / `{ data: [...] }`. Field names are tolerant
 * of the HeyReach shape (eventType, campaignId, lead.profileUrl, message) and
 * of a generic vendor shape (profileUrl, text). Anything without a real
 * LinkedIn profile URL and message text is ignored, never guessed.
 */
export function parseLinkedInInboundWebhook(payload: unknown, now = Date.now()): LoopInboundEvent[] {
  const out: LoopInboundEvent[] = [];
  const seen = new Set<string>();
  const container = record(payload);
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.events)
      ? (container!.events as unknown[])
      : Array.isArray(container?.data)
        ? (container!.data as unknown[])
        : [payload];
  for (const raw of list) {
    const event = parseOneEvent(raw, now);
    if (!event || seen.has(event.providerId)) continue;
    seen.add(event.providerId);
    out.push(event);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delay and quiet hours (timezone aware)
// ---------------------------------------------------------------------------

/** Deterministic jitter in [2 min, 10 min] from a seed (inbound id). */
export function loopReplyDelayMs(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  const fraction = digest.readUInt32BE(0) / 0xffffffff;
  return Math.floor(LOOP_REPLY_DELAY_MIN_MS + fraction * (LOOP_REPLY_DELAY_MAX_MS - LOOP_REPLY_DELAY_MIN_MS));
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday.slice(0, 3).toLowerCase()),
  };
}

/** Wall-clock time in a timezone → UTC instant. */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const parts = zonedParts(new Date(guess), timezone);
    const seen = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    guess += asUtc - seen;
  }
  return new Date(guess);
}

/** Start of the local day containing `date` in the grant's timezone, as UTC.
 *  Daily caps count against this day, never the UTC day. */
export function loopDayStart(date: Date, timezone: string): Date {
  const parts = zonedParts(date, timezone);
  return zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 }, timezone);
}

/** Local hour (0-23) of `date` in the grant's timezone. */
export function loopLocalHour(date: Date, timezone: string): number {
  return zonedParts(date, timezone).hour;
}

export function inLoopQuietHours(date: Date, quiet: LoopQuietHours, timezone: string): boolean {
  const h = loopLocalHour(date, timezone);
  return quiet.start <= quiet.end ? h >= quiet.start && h < quiet.end : h >= quiet.start || h < quiet.end;
}

/**
 * Earliest human-plausible send time: now + jitter, pushed past quiet hours in
 * the grant's timezone with a fresh jitter so unblocked replies do not all
 * fire at HH:00:00.
 */
export function loopSendTime(now: Date, seed: string, quiet: LoopQuietHours, timezone: string): Date {
  const at = new Date(now.getTime() + loopReplyDelayMs(seed));
  if (!inLoopQuietHours(at, quiet, timezone)) return at;
  const parts = zonedParts(at, timezone);
  let resumed = zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: quiet.end, minute: 0 }, timezone);
  if (resumed.getTime() <= at.getTime()) {
    resumed = zonedTimeToUtc(
      { year: parts.year, month: parts.month, day: parts.day + 1, hour: quiet.end, minute: 0 },
      timezone,
    );
  }
  return new Date(resumed.getTime() + loopReplyDelayMs(`${seed}:resume`));
}

// ---------------------------------------------------------------------------
// Opt-out and booking intent (candidate text is untrusted data)
// ---------------------------------------------------------------------------

const OPT_OUT_PATTERNS = [
  /\b(stop|unsubscribe)\b/i,
  /\bnot interested\b/i,
  /\b(remove|take) me (off|from)\b/i,
  /\b(don'?t|do not|please stop) (contact|message|reach out|write)\b/i,
  /\bno thanks?\b/i,
  /\bleave me alone\b/i,
];

export function isLoopOptOut(text: string): boolean {
  const normalized = (text ?? "").trim();
  if (!normalized) return false;
  return OPT_OUT_PATTERNS.some((re) => re.test(normalized));
}

const BOOKING_INTENT_PATTERNS = [
  /\b(yes|yeah|yep|sure|absolutely|definitely)\b/i,
  /\b(sounds|works) (good|great|fine|for me)\b/i,
  /\blet'?s (meet|talk|chat|do it|schedule|book)\b/i,
  /\bbook (it|me|a (call|slot|meeting))\b/i,
  /\b(happy|glad|keen|open) to (chat|talk|meet|connect)\b/i,
  /\bset up a (call|meeting)\b/i,
  /\bwhen (can|could) we (talk|meet|chat)\b/i,
  /\bi'?m (in|available|free)\b/i,
];

const NEGATION_PATTERNS = [/\bnot (available|free|interested)\b/i, /\bno (longer|thanks)\b/i, /\bcan'?t (make|do)\b/i];

export interface BookingIntent {
  intent: "book" | "none";
  /** Present only when the candidate named a concrete, parseable time. */
  proposedStart: Date | null;
}

const ISO_TIME_RE = /(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/;
const DAY_TIME_RE =
  /\b(today|tomorrow|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b[^0-9\n]{0,16}?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\b/i;
const TIME_DAY_RE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\b[^0-9\n]{0,16}?\b(today|tomorrow|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

function resolveHour(rawHour: number, meridiem: string | undefined): number | null {
  if (!Number.isFinite(rawHour) || rawHour < 0 || rawHour > 23) return null;
  const m = (meridiem ?? "").toLowerCase();
  if (m === "am") return rawHour === 12 ? 0 : rawHour > 12 ? null : rawHour;
  if (m === "pm") return rawHour === 12 ? 12 : rawHour > 12 ? null : rawHour + 12;
  if (m === "h" || rawHour >= 13) return rawHour;
  // Bare 1 to 7 reads as afternoon in a business conversation; 8 to 12 as morning.
  return rawHour >= 1 && rawHour <= 7 ? rawHour + 12 : rawHour;
}

function dayOffset(token: string, weekdayNow: number, hourNow: number, minuteNow: number, hour: number, minute: number): number {
  const key = token.toLowerCase().slice(0, 3);
  if (key === "tod") return 0;
  if (key === "tom") return 1;
  const target = WEEKDAYS.indexOf(key);
  if (target < 0) return -1;
  let offset = (target - weekdayNow + 7) % 7;
  if (offset === 0 && (hour < hourNow || (hour === hourNow && minute <= minuteNow))) offset = 7;
  return offset;
}

/**
 * Parse a concrete meeting time from candidate text, relative to when the
 * message arrived and in the grant's timezone. Returns null unless the time is
 * explicit enough to put on a calendar without guessing.
 */
export function parseProposedTime(text: string, receivedAt: Date, timezone: string): Date | null {
  const source = (text ?? "").trim();
  if (!source) return null;

  const iso = source.match(ISO_TIME_RE);
  if (iso) {
    const [, y, mo, d, h, mi] = iso;
    const candidate = zonedTimeToUtc({ year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi) }, timezone);
    return Number.isFinite(candidate.getTime()) && candidate.getTime() > receivedAt.getTime() ? candidate : null;
  }

  let token = "";
  let rawHour = NaN;
  let minute = 0;
  let meridiem: string | undefined;
  const dayFirst = source.match(DAY_TIME_RE);
  const timeFirst = source.match(TIME_DAY_RE);
  if (dayFirst) {
    token = dayFirst[1];
    rawHour = Number(dayFirst[2]);
    minute = Number(dayFirst[3] ?? 0);
    meridiem = dayFirst[4];
  } else if (timeFirst) {
    rawHour = Number(timeFirst[1]);
    minute = Number(timeFirst[2] ?? 0);
    meridiem = timeFirst[3];
    token = timeFirst[4];
  } else {
    return null;
  }
  const hour = resolveHour(rawHour, meridiem);
  if (hour === null || minute < 0 || minute > 59) return null;

  const now = zonedParts(receivedAt, timezone);
  const offset = dayOffset(token, now.weekday, now.hour, now.minute, hour, minute);
  if (offset < 0) return null;
  const candidate = zonedTimeToUtc({ year: now.year, month: now.month, day: now.day + offset, hour, minute }, timezone);
  return candidate.getTime() > receivedAt.getTime() ? candidate : null;
}

export function detectBookingIntent(text: string, receivedAt: Date, timezone: string): BookingIntent {
  const source = (text ?? "").trim();
  if (!source || isLoopOptOut(source) || NEGATION_PATTERNS.some((re) => re.test(source))) {
    return { intent: "none", proposedStart: null };
  }
  const proposedStart = parseProposedTime(source, receivedAt, timezone);
  const phrased = BOOKING_INTENT_PATTERNS.some((re) => re.test(source));
  if (!phrased && !proposedStart) return { intent: "none", proposedStart: null };
  return { intent: "book", proposedStart };
}

export function meetingSlot(start: Date, minutes = LOOP_MEETING_MINUTES): { startTime: string; endTime: string } {
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
}

/** Human readable slot in the grant's timezone, for the confirmation text. */
export function formatMeetingTime(start: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimezone(timezone),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(start);
}

/** Original Aria copy. Plain, personal, no em dashes, no mention of tools. */
export function bookingConfirmCopy(input: { firstName: string; when: string; link?: string | null }): string {
  const name = input.firstName.trim();
  const greeting = name ? `Great, ${name}.` : "Great.";
  const invite = input.link ? "The invite is in your inbox with the details." : "The invite is on its way to your inbox.";
  return `${greeting} You are booked for ${input.when}. ${invite} Looking forward to speaking with you.`;
}

// ---------------------------------------------------------------------------
// The scheduling decision
// ---------------------------------------------------------------------------

export interface LoopScheduleInput {
  now: Date;
  /** Stable per-inbound seed (inbound id or provider id). */
  seed: string;
  grant: LoopGrant | null;
  controls: LoopControls | null;
  inboundText: string;
  /** Already recorded opt-out for this recipient. */
  optedOut: boolean;
  /** Loop replies already claimed or sent today under this grant. */
  sentToday: number;
}

export type LoopScheduleDecision =
  | { action: "schedule"; sendAt: Date; delayMs: number }
  | { action: "hold"; reason: LoopHoldReason };

export type LoopHoldReason =
  | "no-campaign-launch"
  | "campaign-launch-revoked"
  | "kill-switch"
  | "loop-disabled"
  | "opted-out"
  | "daily-cap-reached";

/**
 * Whether and when an automatic reply may go out. Every hold reason is fail
 * closed: no grant, a revoked grant, an engaged kill switch, a disabled loop,
 * an opt-out, or a spent daily cap all mean a human answers instead.
 */
export function decideLoopReply(input: LoopScheduleInput): LoopScheduleDecision {
  if (!input.grant) return { action: "hold", reason: "no-campaign-launch" };
  if (input.grant.revokedAt) return { action: "hold", reason: "campaign-launch-revoked" };
  if (!input.controls || input.controls.killSwitch) return { action: "hold", reason: "kill-switch" };
  if (!input.controls.loopEnabled) return { action: "hold", reason: "loop-disabled" };
  if (input.optedOut || isLoopOptOut(input.inboundText)) return { action: "hold", reason: "opted-out" };
  if (input.sentToday >= Math.max(0, input.grant.dailyCap)) return { action: "hold", reason: "daily-cap-reached" };
  const quiet: LoopQuietHours = { start: input.grant.quietStart, end: input.grant.quietEnd };
  const sendAt = loopSendTime(input.now, input.seed, quiet, input.grant.timezone);
  return { action: "schedule", sendAt, delayMs: sendAt.getTime() - input.now.getTime() };
}
