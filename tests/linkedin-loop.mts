/**
 * LinkedIn reply loop: fail-closed proofs (docs/outreach/LINKEDIN-LOOP.md).
 *
 *   - no campaign launch: inbound does not auto-send
 *   - after launch: reply scheduled 2 to 10 minutes out, never immediate
 *   - quiet hours, kill switch, disabled loop, opt-out hold the send
 *   - booking intent creates a calendar event; a calendar failure never books
 *   - unconfigured vendor or assisted-manual seat is never counted as sent
 */
import {
  LOOP_REPLY_DELAY_MAX_MS,
  LOOP_REPLY_DELAY_MIN_MS,
  bookingConfirmCopy,
  decideLoopReply,
  detectBookingIntent,
  inLoopQuietHours,
  isLoopOptOut,
  loopDayStart,
  loopReplyDelayMs,
  loopSendTime,
  parseLinkedInInboundWebhook,
  verifyLoopWebhookSecret,
  type LoopInboundEvent,
} from "../src/lib/linkedin-loop";
import { gateOutbound } from "../src/lib/gate";
import { ingestLinkedInInbound, type LinkedInIngestDeps } from "../src/lib/linkedin-inbound";
import { dispatchLinkedInLoopDue } from "../src/lib/linkedin-loop-dispatch";
import { bookMeetingFromLoop, type LoopBookingDeps } from "../src/lib/linkedin-booking";
import type {
  LinkedInLoopStore,
  LoopGrantRow,
  LoopQueuedReply,
  LoopReplyInsert,
  LoopThread,
} from "../src/lib/linkedin-loop-store";
import type { LinkedInAdapter } from "../src/lib/linkedin-channel";
import type { LoopControls } from "../src/lib/linkedin-loop";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const NOW = new Date("2026-09-02T12:00:00.000Z"); // 14:00 Paris, daytime
const TZ = "Europe/Paris";
const PROFILE = "https://www.linkedin.com/in/marco-rossi";

function grant(over: Partial<LoopGrantRow> = {}): LoopGrantRow {
  return {
    id: "grant-1",
    workspaceId: "ws-1",
    scope: "replies",
    channel: "LinkedIn",
    campaignId: "camp-1",
    vendorCampaignId: "hr-77",
    seatId: "seat-vendor",
    calendarSeatId: "seat-cal",
    interviewerEmail: "tony@company.test",
    roleTitle: "Business Analyst",
    revokedAt: null,
    dailyCap: 20,
    quietStart: 21,
    quietEnd: 8,
    timezone: TZ,
    ...over,
  };
}

function event(over: Partial<LoopInboundEvent> = {}): LoopInboundEvent {
  return {
    profileUrl: PROFILE,
    text: "Sure, tell me more about the team?",
    providerId: "hr-msg-1",
    vendorCampaignId: "hr-77",
    receivedAt: NOW.getTime() - 1_000,
    firstName: "Marco",
    ...over,
  };
}

const CONTROLS_ON: LoopControls = { killSwitch: false, loopEnabled: true, messageCap: 25, connectCap: 25, timezone: TZ };

interface FakeStoreSeed {
  grant?: LoopGrantRow | null;
  controls?: LoopControls | null;
  thread?: LoopThread | null;
  suppressed?: boolean;
  sentToday?: number;
  messagesToday?: number;
  due?: LoopQueuedReply[];
  seat?: { provider: string; status: string; mode: string; providerState?: string } | null;
  claim?: { allowed: boolean; reason?: string; deliveryAttemptId?: string; profileUrl?: string } | null;
}

function fakeStore(seed: FakeStoreSeed) {
  const inbound: { id: string; processed: boolean; reason: string | null }[] = [];
  const replies: (LoopReplyInsert & { id: string })[] = [];
  const optOuts: string[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const outcomes: { id: string; outcome: string; providerMessageId: string | null }[] = [];
  const claims: string[] = [];
  const thread: LoopThread | null =
    seed.thread === undefined
      ? {
          conversationId: "convo-1",
          candidateId: "cand-1",
          candidateName: "Marco Rossi",
          seatId: "seat-vendor",
          specId: null,
          ownerId: "owner-1",
          lastOutboundBody: "Hi Marco, quick note about a BA role in Montreal.",
          roleBrief: { title: "Business Analyst" },
        }
      : seed.thread;
  const store: LinkedInLoopStore = {
    async findGrantForInbound() {
      return seed.grant === undefined ? grant() : seed.grant;
    },
    async getGrant(id) {
      const g = seed.grant === undefined ? grant() : seed.grant;
      return g && g.id === id ? g : null;
    },
    async readControls() {
      return seed.controls === undefined ? CONTROLS_ON : seed.controls;
    },
    async insertInbound(row) {
      const id = `in-${inbound.length + 1}`;
      inbound.push({ id, processed: false, reason: null });
      void row;
      return { ok: true, id };
    },
    async markInbound(id, patch) {
      const row = inbound.find((r) => r.id === id);
      if (row) {
        row.processed = patch.processed;
        if (patch.reason !== undefined) row.reason = patch.reason;
      }
      return true;
    },
    async resolveThread() {
      return thread;
    },
    async isSuppressed() {
      return seed.suppressed ?? false;
    },
    async recordOptOut(_ws, profileUrl) {
      optOuts.push(profileUrl);
      return true;
    },
    async cancelQueuedReplies() {
      return true;
    },
    async countAttemptsToday() {
      return seed.sentToday ?? 0;
    },
    async countWorkspaceMessagesToday() {
      return seed.messagesToday ?? 0;
    },
    async insertReply(row) {
      const id = `out-${replies.length + 1}`;
      replies.push({ ...row, id });
      return { ok: true, id };
    },
    async listDueReplies() {
      return seed.due ?? [];
    },
    async readSeat() {
      return seed.seat === undefined
        ? { provider: "LinkedIn Vendor API", status: "active", mode: "live", providerState: "connected" }
        : seed.seat;
    },
    async readRoleBrief() {
      return null;
    },
    async updateReply(id, patch) {
      updates.push({ id, patch: patch as Record<string, unknown> });
      return true;
    },
    async claimReply(id) {
      claims.push(id);
      return seed.claim === undefined
        ? { allowed: true, deliveryAttemptId: "attempt-1", profileUrl: PROFILE }
        : seed.claim;
    },
    async recordOutcome(id, _attempt, outcome, _reason, providerMessageId) {
      outcomes.push({ id, outcome, providerMessageId });
      return true;
    },
  };
  return { store, inbound, replies, optOuts, updates, outcomes, claims };
}

const composeFixed = async () => "Happy to share more. The team is eight analysts working with the finance group in Montreal. What matters most to you?";

function deps(store: LinkedInLoopStore, extra: Partial<LinkedInIngestDeps> = {}): LinkedInIngestDeps {
  return { store, compose: composeFixed, now: () => NOW, ...extra };
}

// ---------------------------------------------------------------------------
// Webhook secret and parsing
// ---------------------------------------------------------------------------
{
  ok("secret: matching header passes", verifyLoopWebhookSecret("s3cret", "s3cret"));
  ok("secret: wrong header fails", !verifyLoopWebhookSecret("other", "s3cret"));
  ok("secret: missing header fails", !verifyLoopWebhookSecret(null, "s3cret"));
  ok("secret: unset secret refuses everything", !verifyLoopWebhookSecret("s3cret", ""));

  const heyreach = {
    eventType: "MESSAGE_REPLY_RECEIVED",
    campaignId: 77,
    lead: { profileUrl: "https://www.linkedin.com/in/Marco-Rossi/?trk=x", firstName: "Marco" },
    message: { id: "m-1", text: "Sure, tell me more", timestamp: "2026-09-02T11:59:00Z" },
  };
  const parsed = parseLinkedInInboundWebhook(heyreach);
  ok("parse: HeyReach-shaped reply extracted", parsed.length === 1);
  ok("parse: profile url canonical", parsed[0]?.profileUrl === PROFILE);
  ok("parse: vendor campaign id preserved", parsed[0]?.vendorCampaignId === "77");
  ok("parse: message id preserved", parsed[0]?.providerId === "m-1");
  ok("parse: first name preserved", parsed[0]?.firstName === "Marco");

  const accepted = parseLinkedInInboundWebhook({ ...heyreach, eventType: "CONNECTION_REQUEST_ACCEPTED" });
  ok("parse: non-reply event ignored", accepted.length === 0);
  ok("parse: no profile url → ignored", parseLinkedInInboundWebhook({ text: "hi", campaignId: "1" }).length === 0);
  ok("parse: junk → [] (no throw)", parseLinkedInInboundWebhook(null).length === 0 && parseLinkedInInboundWebhook([1, "x"]).length === 0);
  const generic = parseLinkedInInboundWebhook({ events: [{ profileUrl: PROFILE, text: "yes", campaignId: "77" }] });
  ok("parse: generic vendor shape with synthesized id", generic.length === 1 && generic[0]!.providerId.length === 64);
}

// ---------------------------------------------------------------------------
// Delay: 2 to 10 minutes, deterministic, quiet hours honored in timezone
// ---------------------------------------------------------------------------
{
  let inWindow = true;
  for (let i = 0; i < 200; i++) {
    const ms = loopReplyDelayMs(`seed-${i}`);
    if (ms < LOOP_REPLY_DELAY_MIN_MS || ms > LOOP_REPLY_DELAY_MAX_MS) inWindow = false;
  }
  ok("delay: 200 seeds all inside [2min, 10min]", inWindow);
  ok("delay: deterministic per seed", loopReplyDelayMs("a") === loopReplyDelayMs("a"));
  ok("delay: never zero", loopReplyDelayMs("x") >= 120_000);

  const quiet = { start: 21, end: 8 };
  ok("quiet: 14:00 Paris is not quiet", !inLoopQuietHours(NOW, quiet, TZ));
  const night = new Date("2026-09-02T22:30:00.000Z"); // 00:30 Paris
  ok("quiet: 00:30 Paris is quiet", inLoopQuietHours(night, quiet, TZ));
  const pushed = loopSendTime(night, "n", quiet, TZ);
  ok("quiet: send pushed past 08:00 Paris", pushed.getTime() >= Date.parse("2026-09-03T06:00:00.000Z"));
  ok("quiet: pushed send still jittered, not HH:00:00", pushed.getTime() > Date.parse("2026-09-03T06:00:00.000Z") + LOOP_REPLY_DELAY_MIN_MS - 1);
  const day = loopSendTime(NOW, "d", quiet, TZ);
  ok("day: send is now + delay", day.getTime() - NOW.getTime() === loopReplyDelayMs("d"));
  ok("quiet: bad timezone falls back to UTC without throwing", typeof inLoopQuietHours(NOW, quiet, "Not/AZone") === "boolean");

  // Daily cap day is the grant's local day: 00:30 Paris on Sep 3 is still Sep 2 in UTC.
  ok("cap day: 00:30 Paris → day starts 22:00Z the day before", loopDayStart(night, TZ).toISOString() === "2026-09-02T22:00:00.000Z");
  ok("cap day: 14:00 Paris → day starts 22:00Z previous day", loopDayStart(NOW, TZ).toISOString() === "2026-09-01T22:00:00.000Z");
  ok("cap day: UTC grant uses the UTC day", loopDayStart(night, "UTC").toISOString() === "2026-09-02T00:00:00.000Z");
}

// ---------------------------------------------------------------------------
// decideLoopReply: every hold reason
// ---------------------------------------------------------------------------
{
  const base = {
    now: NOW,
    seed: "in-1",
    grant: grant(),
    controls: CONTROLS_ON,
    inboundText: "sure",
    optedOut: false,
    sentToday: 0,
    messagesToday: 0,
  };
  const scheduled = decideLoopReply(base);
  ok("decide: launched → scheduled", scheduled.action === "schedule");
  ok(
    "decide: scheduled 2 to 10 min out",
    scheduled.action === "schedule" && scheduled.delayMs >= LOOP_REPLY_DELAY_MIN_MS && scheduled.delayMs <= LOOP_REPLY_DELAY_MAX_MS,
  );
  const none = decideLoopReply({ ...base, grant: null });
  ok("decide: no launch → hold no-campaign-launch", none.action === "hold" && none.reason === "no-campaign-launch");
  const revoked = decideLoopReply({ ...base, grant: grant({ revokedAt: "2026-09-01T00:00:00Z" }) });
  ok("decide: revoked launch → hold", revoked.action === "hold" && revoked.reason === "campaign-launch-revoked");
  const kill = decideLoopReply({ ...base, controls: { ...CONTROLS_ON, killSwitch: true } });
  ok("decide: kill switch → hold", kill.action === "hold" && kill.reason === "kill-switch");
  const noControls = decideLoopReply({ ...base, controls: null });
  ok("decide: missing controls row → hold (fail closed)", noControls.action === "hold" && noControls.reason === "kill-switch");
  const off = decideLoopReply({ ...base, controls: { ...CONTROLS_ON, loopEnabled: false } });
  ok("decide: loop disabled → hold", off.action === "hold" && off.reason === "loop-disabled");
  const opted = decideLoopReply({ ...base, inboundText: "Please stop messaging me" });
  ok("decide: opt-out text → hold", opted.action === "hold" && opted.reason === "opted-out");
  const suppressed = decideLoopReply({ ...base, optedOut: true });
  ok("decide: suppressed recipient → hold", suppressed.action === "hold" && suppressed.reason === "opted-out");
  const capped = decideLoopReply({ ...base, sentToday: 20 });
  ok("decide: daily cap reached → hold", capped.action === "hold" && capped.reason === "daily-cap-reached");
  ok("opt-out: not interested", isLoopOptOut("Thanks but not interested"));
  ok("opt-out: plain yes is not an opt-out", !isLoopOptOut("Yes, sounds good"));
}

// ---------------------------------------------------------------------------
// Booking intent and time parsing
// ---------------------------------------------------------------------------
{
  const received = new Date("2026-09-02T12:00:00.000Z"); // Wednesday 14:00 Paris
  const tue = detectBookingIntent("Yes! Tuesday at 3pm works for me", received, TZ);
  ok("intent: yes + time → book with proposed start", tue.intent === "book" && tue.proposedStart !== null);
  ok("intent: Tuesday 3pm Paris → next Tuesday 13:00Z", tue.proposedStart?.toISOString() === "2026-09-08T13:00:00.000Z");
  const tomorrow = detectBookingIntent("tomorrow 10:30 is fine", received, TZ);
  ok("intent: tomorrow 10:30 → 08:30Z", tomorrow.proposedStart?.toISOString() === "2026-09-03T08:30:00.000Z");
  const agree = detectBookingIntent("Let's talk, happy to chat", received, TZ);
  ok("intent: agreement without time → book, no start", agree.intent === "book" && agree.proposedStart === null);
  const question = detectBookingIntent("What is the salary range?", received, TZ);
  ok("intent: question → none", question.intent === "none");
  const negative = detectBookingIntent("Not interested, thanks", received, TZ);
  ok("intent: opt-out never books", negative.intent === "none");
  const iso = detectBookingIntent("2026-09-10 09:00 please", received, TZ);
  ok("intent: ISO wall time in tz", iso.proposedStart?.toISOString() === "2026-09-10T07:00:00.000Z");
  const past = detectBookingIntent("today 9am", received, TZ);
  ok("intent: a time already past today is not bookable", past.proposedStart === null);

  const copy = bookingConfirmCopy({ firstName: "Marco", when: "Tuesday 8 September, 15:00", link: "https://cal" });
  ok("copy: confirm passes the outbound gate", gateOutbound(copy).pass);
  ok("copy: no em dash", !copy.includes("—"));
  ok("copy: never mentions AI", !/\b(AI|automated|bot)\b/i.test(copy));
}

// ---------------------------------------------------------------------------
// Ingest: no launch → no auto-send
// ---------------------------------------------------------------------------
await (async () => {
  const unknown = fakeStore({ grant: null });
  const r1 = await ingestLinkedInInbound(deps(unknown.store), event());
  ok("ingest: unknown campaign → skipped, nothing stored", r1.outcome === "skipped" && unknown.replies.length === 0 && unknown.inbound.length === 0);

  const revoked = fakeStore({ grant: grant({ revokedAt: "2026-09-01T00:00:00Z" }) });
  const r2 = await ingestLinkedInInbound(deps(revoked.store), event());
  ok("ingest: revoked launch → held, inbound kept for a person", r2.outcome === "held" && r2.reason === "campaign-launch-revoked");
  ok("ingest: revoked launch → no reply row", revoked.replies.length === 0);
  ok("ingest: revoked launch → inbound processed with reason", revoked.inbound[0]?.processed === true && revoked.inbound[0]?.reason === "campaign-launch-revoked");
})();

// ---------------------------------------------------------------------------
// Ingest: launched → scheduled 2 to 10 minutes out, never immediate
// ---------------------------------------------------------------------------
await (async () => {
  const s = fakeStore({});
  const r = await ingestLinkedInInbound(deps(s.store), event());
  ok("ingest: launched → scheduled", r.outcome === "scheduled");
  const reply = s.replies[0];
  ok("ingest: one queued reply row", reply?.status === "queued" && s.replies.length === 1);
  const delay = reply ? Date.parse(reply.scheduledAt ?? "") - NOW.getTime() : -1;
  ok("ingest: scheduled_at is 2 to 10 min after now", delay >= LOOP_REPLY_DELAY_MIN_MS && delay <= LOOP_REPLY_DELAY_MAX_MS);
  ok("ingest: reply bound to grant and thread", reply?.grantId === "grant-1" && reply?.conversationId === "convo-1" && reply?.candidateId === "cand-1");
  ok("ingest: reply passes the gate", reply?.gateResult !== null && (reply?.gateResult as { pass: boolean }).pass === true);
  ok("ingest: not booked", r.outcome === "scheduled" && r.booked === false);

  // The dispatcher only sends rows that are due: the fresh row is not.
  const due = await s.store.listDueReplies(NOW, 10);
  ok("ingest: nothing due at ingest time (fake store lists none)", Array.isArray(due) && due.length === 0);
})();

// ---------------------------------------------------------------------------
// Ingest: quiet hours push, kill switch / disabled / opt-out hold
// ---------------------------------------------------------------------------
await (async () => {
  const night = new Date("2026-09-02T22:30:00.000Z"); // 00:30 Paris
  const q = fakeStore({});
  const r = await ingestLinkedInInbound(deps(q.store, { now: () => night }), event({ receivedAt: night.getTime() }));
  const at = q.replies[0]?.scheduledAt ?? "";
  ok("ingest: quiet hours → still scheduled, but after 08:00 Paris", r.outcome === "scheduled" && Date.parse(at) >= Date.parse("2026-09-03T06:00:00.000Z"));

  const kill = fakeStore({ controls: { ...CONTROLS_ON, killSwitch: true } });
  const rk = await ingestLinkedInInbound(deps(kill.store), event());
  ok("ingest: kill switch → held, no reply row", rk.outcome === "held" && rk.reason === "kill-switch" && kill.replies.length === 0);

  const off = fakeStore({ controls: { ...CONTROLS_ON, loopEnabled: false } });
  const ro = await ingestLinkedInInbound(deps(off.store), event());
  ok("ingest: loop disabled → held", ro.outcome === "held" && ro.reason === "loop-disabled" && off.replies.length === 0);

  const opt = fakeStore({});
  const rp = await ingestLinkedInInbound(deps(opt.store), event({ text: "Please remove me from your list" }));
  ok("ingest: opt-out → held and suppressed", rp.outcome === "held" && rp.reason === "opted-out" && opt.optOuts[0] === PROFILE);
  ok("ingest: opt-out → no reply composed", opt.replies.length === 0);

  const sup = fakeStore({ suppressed: true });
  const rs = await ingestLinkedInInbound(deps(sup.store), event());
  ok("ingest: already suppressed → held", rs.outcome === "held" && rs.reason === "opted-out");

  const cap = fakeStore({ sentToday: 20 });
  const rc = await ingestLinkedInInbound(deps(cap.store), event());
  ok("ingest: daily cap → held", rc.outcome === "held" && rc.reason === "daily-cap-reached");

  const stranger = fakeStore({ thread: null });
  const rt = await ingestLinkedInInbound(deps(stranger.store), event());
  ok("ingest: profile Aria never messaged → triage, no reply", rt.outcome === "triage" && rt.reason === "no-conversation" && stranger.replies.length === 0);

  const noModel = fakeStore({});
  const rm = await ingestLinkedInInbound(deps(noModel.store, { compose: async () => null }), event());
  ok("ingest: no reply provider → triage", rm.outcome === "triage" && rm.reason === "reply-provider-unavailable");

  const leaky = fakeStore({});
  const rl = await ingestLinkedInInbound(
    deps(leaky.store, { compose: async () => "As an AI assistant I can confirm the role is open and the team is great." }),
    event(),
  );
  ok("ingest: AI disclosure → blocked draft, never queued", rl.outcome === "triage" && leaky.replies[0]?.status === "blocked" && leaky.replies[0]?.scheduledAt === null);
})();

// ---------------------------------------------------------------------------
// Booking: intent creates the event; calendar failure never books
// ---------------------------------------------------------------------------
function bookingDeps(over: Partial<{ createOk: boolean; state: "not-sent" | "unknown"; connected: boolean; claimStatus: string }> = {}) {
  const calls: string[] = [];
  const reconciled: string[] = [];
  const deps: LoopBookingDeps = {
    async claim(input) {
      calls.push(`claim:${input.startTime}`);
      if (over.claimStatus === "double_booked") return { status: "double_booked" };
      return { status: "claimed", id: "book-1", bookingStatus: "claimed", externalEventId: null, replay: false };
    },
    async reconcile(input) {
      reconciled.push(input.status);
      return { status: "reconciled", id: input.id, bookingStatus: input.status };
    },
    async resolveCalendar() {
      if (over.connected === false) return null;
      return {
        provider: "Gmail API",
        interviewerEmail: "tony@company.test",
        createEvent: async () => {
          calls.push("create");
          if (over.createOk === false) {
            return { ok: false, provider: "Gmail API", deliveryState: over.state ?? "not-sent", detail: "Google Calendar 403" };
          }
          return { ok: true, provider: "Gmail API", deliveryState: "accepted", eventId: "evt-1", link: "https://cal/evt-1", detail: "Event created." };
        },
      };
    },
  };
  return { deps, calls, reconciled };
}

await (async () => {
  const booked = bookingDeps();
  const s = fakeStore({});
  const r = await ingestLinkedInInbound(deps(s.store, { booking: booked.deps }), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: intent with time → scheduled and booked", r.outcome === "scheduled" && r.booked === true);
  ok("booking: claim before create, then confirmed", booked.calls[0]?.startsWith("claim:2026-09-08T13:00") === true && booked.calls[1] === "create" && booked.reconciled[0] === "confirmed");
  ok("booking: confirmation queued with delay", s.replies[0]?.status === "queued" && /booked for/i.test(s.replies[0]?.body ?? ""));
  const delay = Date.parse(s.replies[0]?.scheduledAt ?? "") - NOW.getTime();
  ok("booking: confirmation also waits 2 to 10 min", delay >= LOOP_REPLY_DELAY_MIN_MS && delay <= LOOP_REPLY_DELAY_MAX_MS);

  const rejected = bookingDeps({ createOk: false, state: "not-sent" });
  const f = fakeStore({});
  const rf = await ingestLinkedInInbound(deps(f.store, { booking: rejected.deps }), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: calendar rejection → triage, not booked", rf.outcome === "triage" && rf.reason === "booking-failed:calendar-rejected");
  ok("booking: rejection → no confirmation written", f.replies.length === 0);
  ok("booking: rejection releases the claim", rejected.reconciled[0] === "failed");

  const unknown = bookingDeps({ createOk: false, state: "unknown" });
  const u = fakeStore({});
  const ru = await ingestLinkedInInbound(deps(u.store, { booking: unknown.deps }), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: unknown outcome → triage, claim kept, nothing booked", ru.outcome === "triage" && ru.reason === "booking-failed:calendar-outcome-unknown" && unknown.reconciled.length === 0 && u.replies.length === 0);

  const disconnected = bookingDeps({ connected: false });
  const d = fakeStore({});
  const rd = await ingestLinkedInInbound(deps(d.store, { booking: disconnected.deps }), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: calendar not connected → triage", rd.outcome === "triage" && rd.reason === "booking-failed:calendar-not-connected" && disconnected.calls.length === 0);

  const noSeat = fakeStore({ grant: grant({ calendarSeatId: null }) });
  const rn = await ingestLinkedInInbound(deps(noSeat.store, { booking: bookingDeps().deps }), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: no calendar seat on the grant → triage", rn.outcome === "triage" && rn.reason === "booking-failed:calendar-seat-not-configured");

  const noDeps = fakeStore({});
  const rx = await ingestLinkedInInbound(deps(noDeps.store), event({ text: "Yes, Tuesday at 3pm works" }));
  ok("booking: no booking wiring → human", rx.outcome === "triage" && rx.reason === "booking-needs-human");

  const askTime = fakeStore({});
  const ra = await ingestLinkedInInbound(deps(askTime.store, { booking: bookingDeps().deps }), event({ text: "Let's talk!" }));
  ok("booking: agreement without a time → normal reply, no calendar call", ra.outcome === "scheduled" && ra.booked === false);

  const direct = await bookMeetingFromLoop(bookingDeps({ claimStatus: "double_booked" }).deps, {
    workspaceId: "ws-1",
    candidateId: "cand-1",
    candidateName: "Marco",
    candidateEmail: "",
    role: "BA",
    start: new Date("2026-09-08T13:00:00.000Z"),
    timezone: TZ,
    calendarSeatId: "seat-cal",
    interviewerEmail: "",
    requestId: "in-1",
  });
  ok("booking: double booked slot → not booked", direct.booked === false && direct.reason === "calendar-claim-double_booked");
})();

// ---------------------------------------------------------------------------
// Dispatch: vendor sends, unconfigured vendor / assisted-manual never "sent"
// ---------------------------------------------------------------------------
function dueReply(over: Partial<LoopQueuedReply> = {}): LoopQueuedReply {
  return {
    id: "out-1",
    workspaceId: "ws-1",
    grantId: "grant-1",
    candidateId: "cand-1",
    seatId: "seat-vendor",
    specId: null,
    profileUrl: PROFILE,
    subject: "",
    body: "Happy to share more. The team is eight analysts in Montreal. What matters most to you?",
    scheduledAt: "2026-09-02T11:55:00.000Z",
    ...over,
  };
}

function adapter(kind: "vendor-api" | "assisted-manual", configured: boolean, outcome?: Partial<Awaited<ReturnType<LinkedInAdapter["deliver"]>>>) {
  let calls = 0;
  const a: LinkedInAdapter = {
    kind,
    provider: kind === "vendor-api" ? "LinkedIn Vendor API" : "LinkedIn Assisted Manual",
    configured: () => configured,
    async deliver(req) {
      calls++;
      return {
        status: "sent",
        deliveryState: "accepted",
        provider: "LinkedIn Vendor API",
        detail: "Sent through LinkedIn vendor API.",
        id: `vendor-${req.attemptId}`,
        ...outcome,
      };
    },
    // The reply loop never sends a connection request.
    connectConfigured: () => false,
    async connect() {
      throw new Error("connect must not be called by the reply loop");
    },
  };
  return { adapter: a, calls: () => calls };
}

await (async () => {
  const live = adapter("vendor-api", true);
  const s = fakeStore({ due: [dueReply()] });
  const stats = await dispatchLinkedInLoopDue({ store: s.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: configured vendor → sent", stats.sent === 1 && stats.blocked === 0 && live.calls() === 1);
  ok("dispatch: claim ran before transport", s.claims[0] === "out-1");
  ok("dispatch: outcome recorded sent with vendor id", s.outcomes[0]?.outcome === "sent" && s.outcomes[0]?.providerMessageId === "vendor-attempt-1");

  const dark = adapter("vendor-api", false);
  const d = fakeStore({ due: [dueReply()] });
  const ds = await dispatchLinkedInLoopDue({ store: d.store, now: () => NOW, adapterFor: () => dark.adapter });
  ok("dispatch: unconfigured vendor → unconfigured, not sent", ds.unconfigured === 1 && ds.sent === 0 && dark.calls() === 0);
  ok("dispatch: unconfigured vendor → row blocked with reason", d.updates[0]?.patch.status === "blocked" && JSON.stringify(d.updates[0]?.patch.gateResult).includes("linkedin-provider-unconfigured"));
  ok("dispatch: unconfigured vendor → no claim, no outcome", d.claims.length === 0 && d.outcomes.length === 0);

  const manual = adapter("assisted-manual", true);
  const m = fakeStore({ due: [dueReply()], seat: { provider: "LinkedIn Assisted Manual", status: "active", mode: "live" } });
  const ms = await dispatchLinkedInLoopDue({ store: m.store, now: () => NOW, adapterFor: () => manual.adapter });
  ok("dispatch: assisted-manual seat → never counted as sent", ms.sent === 0 && ms.unconfigured === 1 && manual.calls() === 0);
  ok("dispatch: assisted-manual → blocked draft for a person", JSON.stringify(m.updates[0]?.patch.gateResult).includes("requires-vendor-api"));

  // 0058: the sender behind the seat must be connected. The default and every
  // other state hold before the claim, with the transport never called.
  for (const providerState of [undefined, "disconnected", "paused", "restricted"]) {
    const sender = adapter("vendor-api", true);
    const st = fakeStore({ due: [dueReply()], seat: { provider: "LinkedIn Vendor API", status: "active", mode: "live", providerState } });
    const ss = await dispatchLinkedInLoopDue({ store: st.store, now: () => NOW, adapterFor: () => sender.adapter });
    ok(
      `dispatch: sender state ${providerState ?? "missing"} → blocked linkedin-sender-not-connected, no claim, no send`,
      ss.blocked === 1 && ss.sent === 0 && sender.calls() === 0 && st.claims.length === 0 &&
        JSON.stringify(st.updates[0]?.patch.gateResult).includes("linkedin-sender-not-connected"),
    );
  }

  const noId = adapter("vendor-api", true, { id: undefined, status: "error", deliveryState: "unknown", detail: "no durable id" });
  const n = fakeStore({ due: [dueReply()] });
  const ns = await dispatchLinkedInLoopDue({ store: n.store, now: () => NOW, adapterFor: () => noId.adapter });
  ok("dispatch: vendor without message id → ambiguous, not sent", ns.sent === 0 && n.outcomes[0]?.outcome === "ambiguous");

  const k = fakeStore({ due: [dueReply()], controls: { ...CONTROLS_ON, killSwitch: true } });
  const ks = await dispatchLinkedInLoopDue({ store: k.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: kill switch at send time → blocked, transport never runs", ks.blocked === 1 && ks.sent === 0 && k.claims.length === 0);

  const off = fakeStore({ due: [dueReply()], controls: { ...CONTROLS_ON, loopEnabled: false } });
  const os = await dispatchLinkedInLoopDue({ store: off.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: loop disabled at send time → blocked", os.blocked === 1 && os.sent === 0);

  const rv = fakeStore({ due: [dueReply()], grant: grant({ revokedAt: "2026-09-02T11:58:00Z" }) });
  const rs = await dispatchLinkedInLoopDue({ store: rv.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: launch revoked while waiting → blocked", rs.blocked === 1 && rs.sent === 0);

  const night = new Date("2026-09-02T22:30:00.000Z");
  const q = fakeStore({ due: [dueReply()] });
  const qs = await dispatchLinkedInLoopDue({ store: q.store, now: () => night, adapterFor: () => live.adapter });
  ok("dispatch: quiet hours at send time → rescheduled, not sent", qs.rescheduled === 1 && qs.sent === 0 && typeof q.updates[0]?.patch.scheduledAt === "string");

  const claimDenied = fakeStore({ due: [dueReply()], claim: { allowed: false, reason: "loop-daily-cap-reached" } });
  const cs = await dispatchLinkedInLoopDue({ store: claimDenied.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: DB claim refuses → blocked with guardrail reason", cs.blocked === 1 && JSON.stringify(claimDenied.updates[0]?.patch.gateResult).includes("guardrail:loop-daily-cap-reached"));

  const leak = fakeStore({ due: [dueReply({ body: "I am an AI assistant and I can confirm the role." })] });
  const ls = await dispatchLinkedInLoopDue({ store: leak.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: AI disclosure re-checked at send → blocked", ls.blocked === 1 && ls.sent === 0);
})();

console.log(`linkedin-loop: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
