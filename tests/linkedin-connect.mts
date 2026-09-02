/**
 * Connect primitive and accepted event: fail-closed proofs
 * (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S5).
 *
 *   - connect without LINKEDIN_VENDOR_CONNECT_URL is blocked, never sent
 *   - no durable id from the vendor is ambiguous, not sent
 *   - an accepted event for a person without a campaign launch is stored and held
 *   - the 2 to 10 minute jitter window holds for connects too
 *   - the connect cap of 25 holds the 26th: it waits for tomorrow's limit
 *   - the SQL claim is service-only, checks the launch, the sender and the cap
 *     before writing, and the message claim refuses a connection request
 *   - copy: no vendor names, no em dashes, never AI
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LINKEDIN_CONNECT_NOTE_MAX,
  LOOP_REPLY_DELAY_MAX_MS,
  LOOP_REPLY_DELAY_MIN_MS,
  decideFirstMessageAfterAccept,
  loopNextDayStart,
  parseLinkedInConnectionAccepted,
  parseLinkedInInboundWebhook,
  type LoopConnectionAcceptedEvent,
  type LoopControls,
} from "../src/lib/linkedin-loop";
import { getLinkedInAdapter, type LinkedInAdapter, type LinkedInDeliveryOutcome } from "../src/lib/linkedin-channel";
import { WAITING_FOR_LIMIT_REASON, dispatchLinkedInCampaignDue } from "../src/lib/linkedin-connect-dispatch";
import { ingestLinkedInConnectionAccepted } from "../src/lib/linkedin-connect-inbound";
import type { ConnectAttemptRow, LinkedInConnectStore, QueuedConnect } from "../src/lib/linkedin-connect-store";
import type { LoopGrantRow } from "../src/lib/linkedin-loop-store";
import { LAUNCH_COPY } from "../src/lib/linkedin-campaign";
import { testManifest } from "./test-manifest.mjs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function functionBlock(sql: string, name: string, args = "\\(p_message_id uuid\\)"): string {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}${args}[\\s\\S]*?\\n\\$\\$;`));
  return m ? m[0] : "";
}

const NOW = new Date("2026-09-02T12:00:00.000Z"); // 14:00 Paris, daytime
const NIGHT = new Date("2026-09-02T22:30:00.000Z"); // 00:30 Paris, quiet
const TZ = "Europe/Paris";
const PROFILE = "https://www.linkedin.com/in/marco-rossi";
const CONTROLS_ON: LoopControls = { killSwitch: false, loopEnabled: true, messageCap: 25, connectCap: 25, timezone: TZ };

function grant(over: Partial<LoopGrantRow> = {}): LoopGrantRow {
  return {
    id: "grant-1",
    workspaceId: "ws-1",
    scope: "campaign",
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

// ---------------------------------------------------------------------------
// The adapter primitive, against the real adapters with a stubbed transport
// ---------------------------------------------------------------------------
const ENV_KEYS = ["LINKEDIN_VENDOR_API_URL", "LINKEDIN_VENDOR_API_KEY", "LINKEDIN_VENDOR_CONNECT_URL"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const savedFetch = globalThis.fetch;
function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

await (async () => {
  const vendor = getLinkedInAdapter("vendor-api");
  const req = { workspaceId: "ws-1", messageId: "out-1", candidateId: "cand-1", profileUrl: PROFILE, note: "Hi Marco, happy to connect.", attemptId: "attempt-1" };

  // Message endpoint configured, connect endpoint not: connects are blocked, never sent.
  setEnv({ LINKEDIN_VENDOR_API_URL: "https://vendor.example/messages", LINKEDIN_VENDOR_API_KEY: "k" });
  let calls = stubFetch(200, { id: "should-never-be-used" });
  ok("adapter: message endpoint alone does not configure connects", vendor.configured() && !vendor.connectConfigured());
  const unset = await vendor.connect(req);
  ok("adapter: connect without LINKEDIN_VENDOR_CONNECT_URL is refused", unset.status === "error" && unset.deliveryState === "not-sent" && !unset.id);
  ok("adapter: connect without the endpoint never touches the network", calls.length === 0);
  ok("adapter: refusal names the missing variable, not a vendor console", /LINKEDIN_VENDOR_CONNECT_URL/.test(unset.detail));

  // Connect endpoint set: the request goes to it, with exactly the plan's payload.
  setEnv({ LINKEDIN_VENDOR_API_URL: "https://vendor.example/messages", LINKEDIN_VENDOR_API_KEY: "k", LINKEDIN_VENDOR_CONNECT_URL: "https://vendor.example/connect" });
  calls = stubFetch(200, { requestId: "inv-1" });
  ok("adapter: connect endpoint plus key means configured", vendor.connectConfigured());
  const sent = await vendor.connect(req);
  ok("adapter: durable id → sent, accepted, id kept", sent.status === "sent" && sent.deliveryState === "accepted" && sent.id === "inv-1");
  ok("adapter: the connect endpoint is used, not the message endpoint", calls[0]?.url === "https://vendor.example/connect");
  ok(
    "adapter: payload is { profileUrl, note, attemptId } and nothing else",
    JSON.stringify(Object.keys(calls[0]?.body as object).sort()) === JSON.stringify(["attemptId", "note", "profileUrl"]) &&
      (calls[0]?.body as { note: string }).note === req.note,
  );

  calls = stubFetch(200, { ok: true });
  const noId = await vendor.connect(req);
  ok("adapter: no durable id → unknown (ambiguous), not sent", noId.status === "error" && noId.deliveryState === "unknown" && !noId.id);
  calls = stubFetch(200, { id: 4242 });
  const numeric = await vendor.connect(req);
  ok("adapter: a numeric id is still a durable id", numeric.status === "sent" && numeric.id === "4242");
  calls = stubFetch(500, {});
  const failed = await vendor.connect(req);
  ok("adapter: vendor 500 is never sent", failed.status === "error" && !failed.id);
  globalThis.fetch = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;
  const thrown = await vendor.connect(req);
  ok("adapter: a transport error is unknown, not sent", thrown.status === "error" && thrown.deliveryState === "unknown");

  const manual = getLinkedInAdapter("assisted-manual");
  const paste = await manual.connect(req);
  ok("adapter: assisted-manual connect is a copy and paste outcome, never sent", paste.status === "dry-run" && paste.deliveryState === "not-sent" && !paste.id);
  const noProfile = await manual.connect({ ...req, profileUrl: " " });
  ok("adapter: assisted-manual connect without a profile is an error", noProfile.status === "error");

  setEnv({});
  globalThis.fetch = savedFetch;
})();

// ---------------------------------------------------------------------------
// Parsing: accepted events are recognised, and stay out of the reply loop
// ---------------------------------------------------------------------------
{
  const accepted = {
    eventType: "CONNECTION_REQUEST_ACCEPTED",
    eventId: "ev-1",
    campaignId: 77,
    lead: { profileUrl: "https://www.linkedin.com/in/Marco-Rossi/?trk=x", firstName: "Marco" },
    timestamp: "2026-09-02T11:59:00Z",
  };
  const parsed = parseLinkedInConnectionAccepted(accepted);
  ok("parse: accepted event extracted", parsed.length === 1);
  ok("parse: profile canonical, campaign and id preserved", parsed[0]?.profileUrl === PROFILE && parsed[0]?.vendorCampaignId === "77" && parsed[0]?.providerId === "ev-1");
  ok("parse: first name preserved", parsed[0]?.firstName === "Marco");
  ok("parse: accepted event never enters the reply loop", parseLinkedInInboundWebhook(accepted).length === 0);
  ok("parse: a reply is not an acceptance", parseLinkedInConnectionAccepted({ ...accepted, eventType: "MESSAGE_REPLY_RECEIVED", message: { text: "hi" } }).length === 0);
  ok("parse: an untyped event is not an acceptance", parseLinkedInConnectionAccepted({ lead: accepted.lead, campaignId: 77 }).length === 0);
  ok("parse: no profile url → ignored", parseLinkedInConnectionAccepted({ eventType: "CONNECTION_REQUEST_ACCEPTED", campaignId: 77 }).length === 0);
  ok("parse: junk → [] (no throw)", parseLinkedInConnectionAccepted(null).length === 0 && parseLinkedInConnectionAccepted([1, "x"]).length === 0);
  const twice = parseLinkedInConnectionAccepted({ events: [accepted, accepted] });
  ok("parse: duplicate ids collapse", twice.length === 1);
  const generic = parseLinkedInConnectionAccepted({ events: [{ type: "connection_accepted", profileUrl: PROFILE }] });
  ok("parse: generic shape with synthesized id", generic.length === 1 && generic[0]!.providerId.length === 64);
}

// ---------------------------------------------------------------------------
// The in-memory connect store
// ---------------------------------------------------------------------------
interface DraftSeed {
  status: "composed" | "queued" | "sent";
  approvalGrantId: string | null;
}
interface FakeSeed {
  controls?: LoopControls | null;
  grants?: LoopGrantRow[];
  campaignGrant?: LoopGrantRow | null;
  approval?: { grantId: string | null; revokedAt: string | null } | null;
  seat?: { provider: string; status: string; mode: string; providerState?: string } | null;
  connectsToday?: number | null;
  messagesToday?: number | null;
  suppressed?: boolean;
  due?: QueuedConnect[];
  claim?: { allowed: boolean; reason?: string; deliveryAttemptId?: string; profileUrl?: string } | null;
  attempts?: ConnectAttemptRow[];
  draft?: DraftSeed | null;
  duplicateEvent?: boolean;
}

function fakeStore(seed: FakeSeed) {
  const grants = seed.grants ?? [grant()];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const claims: string[] = [];
  const outcomes: { id: string; outcome: string; providerRequestId: string | null }[] = [];
  const events: { id: string; grantId: string | null; status: string; reason: string | null; outboundMessageId: string | null }[] = [];
  const scheduled: { id: string; scheduledAt: string }[] = [];
  const store: LinkedInConnectStore = {
    async readControls() {
      return seed.controls === undefined ? CONTROLS_ON : seed.controls;
    },
    async getGrant(id) {
      return grants.find((g) => g.id === id) ?? null;
    },
    async readSeat() {
      return seed.seat === undefined
        ? { provider: "LinkedIn Vendor API", status: "active", mode: "live", providerState: "connected" }
        : seed.seat;
    },
    async readRoleBrief() {
      return null;
    },
    async isSuppressed() {
      return seed.suppressed ?? false;
    },
    async countWorkspaceMessagesToday() {
      return seed.messagesToday === undefined ? 0 : seed.messagesToday;
    },
    async findGrantForInbound() {
      return seed.campaignGrant === undefined ? null : seed.campaignGrant;
    },
    async listDueConnects() {
      return seed.due ?? [];
    },
    async readLaunchApproval() {
      return seed.approval === undefined ? { grantId: "grant-1", revokedAt: null } : seed.approval;
    },
    async countWorkspaceConnectsToday() {
      return seed.connectsToday === undefined ? 0 : seed.connectsToday;
    },
    async updateConnect(id, patch) {
      updates.push({ id, patch: patch as Record<string, unknown> });
      return true;
    },
    async claimConnect(id) {
      claims.push(id);
      return seed.claim === undefined ? { allowed: true, deliveryAttemptId: "attempt-1", profileUrl: PROFILE } : seed.claim;
    },
    async recordConnectOutcome(id, _attempt, outcome, _reason, providerRequestId) {
      outcomes.push({ id, outcome, providerRequestId });
      return true;
    },
    async findConnectAttempts() {
      return seed.attempts ?? [];
    },
    async insertConnectEvent(row) {
      if (seed.duplicateEvent) return { ok: false, duplicate: true };
      const id = `ev-${events.length + 1}`;
      events.push({ id, grantId: row.grantId, status: "held", reason: null, outboundMessageId: null });
      return { ok: true, id };
    },
    async markConnectEvent(id, patch) {
      const row = events.find((e) => e.id === id);
      if (row) {
        row.status = patch.status;
        if (patch.reason !== undefined) row.reason = patch.reason;
        if (patch.outboundMessageId !== undefined) row.outboundMessageId = patch.outboundMessageId;
      }
      return true;
    },
    async scheduleFirstMessageAfterAccept(input) {
      const draft = seed.draft === undefined ? { status: "composed", approvalGrantId: "grant-1" } : seed.draft;
      if (!draft) return { ok: false, reason: "no-first-message-draft" };
      if (draft.status === "queued") return { ok: false, reason: "already-scheduled" };
      if (draft.status === "sent") return { ok: false, reason: "already-sent" };
      if (draft.approvalGrantId !== input.grantId) return { ok: false, reason: "draft-not-launched" };
      scheduled.push({ id: "msg-1", scheduledAt: input.scheduledAt });
      return { ok: true, id: "msg-1" };
    },
  };
  return { store, updates, claims, outcomes, events, scheduled };
}

function dueConnect(over: Partial<QueuedConnect> = {}): QueuedConnect {
  return {
    id: "out-1",
    workspaceId: "ws-1",
    candidateId: "cand-1",
    seatId: "seat-vendor",
    specId: null,
    profileUrl: PROFILE,
    note: "Hi Marco, I lead hiring for a finance analytics team in Paris and would like to connect.",
    approvalMessageId: "draft-1",
    scheduledAt: "2026-09-02T11:55:00.000Z",
    ...over,
  };
}

function adapter(kind: "vendor-api" | "assisted-manual", connectConfigured: boolean, outcome?: Partial<LinkedInDeliveryOutcome>) {
  let calls = 0;
  const a: LinkedInAdapter = {
    kind,
    provider: kind === "vendor-api" ? "LinkedIn Vendor API" : "LinkedIn Assisted Manual",
    configured: () => true,
    async deliver() {
      throw new Error("deliver must not be called for a connection request");
    },
    connectConfigured: () => connectConfigured,
    async connect(req) {
      calls++;
      return {
        status: "sent",
        deliveryState: "accepted",
        provider: "LinkedIn Vendor API",
        detail: "Connection request sent through LinkedIn vendor API.",
        id: `inv-${req.attemptId}`,
        ...outcome,
      };
    },
  };
  return { adapter: a, calls: () => calls };
}

const inWindow = (from: Date, iso: string | undefined) => {
  const delay = Date.parse(iso ?? "") - from.getTime();
  return delay >= LOOP_REPLY_DELAY_MIN_MS && delay <= LOOP_REPLY_DELAY_MAX_MS;
};

// ---------------------------------------------------------------------------
// Dispatch: send, block, reschedule, wait
// ---------------------------------------------------------------------------
await (async () => {
  const live = adapter("vendor-api", true);
  const s = fakeStore({ due: [dueConnect()] });
  const stats = await dispatchLinkedInCampaignDue({ store: s.store, now: () => NOW, adapterFor: () => live.adapter });
  ok("dispatch: configured connect → sent once", stats.sent === 1 && stats.blocked === 0 && live.calls() === 1);
  ok("dispatch: claim ran before the transport", s.claims[0] === "out-1");
  ok("dispatch: outcome recorded sent with the vendor request id", s.outcomes[0]?.outcome === "sent" && s.outcomes[0]?.providerRequestId === "inv-attempt-1");

  const empty = adapter("vendor-api", true);
  const e = fakeStore({ due: [dueConnect({ note: "" })] });
  const es = await dispatchLinkedInCampaignDue({ store: e.store, now: () => NOW, adapterFor: () => empty.adapter });
  ok("dispatch: an invitation without a note is allowed", es.sent === 1);

  // connect without LINKEDIN_VENDOR_CONNECT_URL is blocked, never sent
  const dark = adapter("vendor-api", false);
  const d = fakeStore({ due: [dueConnect()] });
  const ds = await dispatchLinkedInCampaignDue({ store: d.store, now: () => NOW, adapterFor: () => dark.adapter });
  ok("dispatch: unconfigured connect endpoint → unconfigured, not sent", ds.unconfigured === 1 && ds.sent === 0 && dark.calls() === 0);
  ok("dispatch: unconfigured → row blocked linkedin-connect-unconfigured", d.updates[0]?.patch.status === "blocked" && JSON.stringify(d.updates[0]?.patch.gateResult).includes("linkedin-connect-unconfigured"));
  ok("dispatch: unconfigured → no claim, no outcome", d.claims.length === 0 && d.outcomes.length === 0);

  setEnv({ LINKEDIN_VENDOR_API_URL: "https://vendor.example/messages", LINKEDIN_VENDOR_API_KEY: "k" });
  const netCalls = stubFetch(200, { id: "never" });
  const real = fakeStore({ due: [dueConnect()] });
  const rs = await dispatchLinkedInCampaignDue({ store: real.store, now: () => NOW, adapterFor: () => getLinkedInAdapter("vendor-api") });
  ok("dispatch: the real adapter without LINKEDIN_VENDOR_CONNECT_URL is blocked before the claim", rs.unconfigured === 1 && rs.sent === 0 && real.claims.length === 0 && netCalls.length === 0);
  setEnv({});
  globalThis.fetch = savedFetch;

  // no durable id is ambiguous, not sent
  const noId = adapter("vendor-api", true, { id: undefined, status: "error", deliveryState: "unknown", detail: "no durable id" });
  const n = fakeStore({ due: [dueConnect()] });
  const ns = await dispatchLinkedInCampaignDue({ store: n.store, now: () => NOW, adapterFor: () => noId.adapter });
  ok("dispatch: vendor without a request id → ambiguous, not sent", ns.sent === 0 && n.outcomes[0]?.outcome === "ambiguous" && n.outcomes[0]?.providerRequestId === null);

  const rejected = adapter("vendor-api", true, { id: undefined, status: "error", deliveryState: "not-sent", detail: "LinkedIn vendor API 422" });
  const rj = fakeStore({ due: [dueConnect()] });
  await dispatchLinkedInCampaignDue({ store: rj.store, now: () => NOW, adapterFor: () => rejected.adapter });
  ok("dispatch: a definitive vendor rejection → skipped, the slot is released", rj.outcomes[0]?.outcome === "skipped");

  const manual = adapter("assisted-manual", true);
  const m = fakeStore({ due: [dueConnect()], seat: { provider: "LinkedIn Assisted Manual", status: "active", mode: "live" } });
  const ms = await dispatchLinkedInCampaignDue({ store: m.store, now: () => NOW, adapterFor: () => manual.adapter });
  ok("dispatch: assisted-manual seat → never counted as sent", ms.sent === 0 && ms.unconfigured === 1 && manual.calls() === 0);
  ok("dispatch: assisted-manual → blocked draft for a person", JSON.stringify(m.updates[0]?.patch.gateResult).includes("requires-vendor-api"));

  for (const providerState of [undefined, "disconnected", "paused", "restricted"]) {
    const sender = adapter("vendor-api", true);
    const st = fakeStore({ due: [dueConnect()], seat: { provider: "LinkedIn Vendor API", status: "active", mode: "live", providerState } });
    const ss = await dispatchLinkedInCampaignDue({ store: st.store, now: () => NOW, adapterFor: () => sender.adapter });
    ok(
      `dispatch: sender state ${providerState ?? "missing"} → blocked linkedin-sender-not-connected, no claim, no send`,
      ss.blocked === 1 && ss.sent === 0 && sender.calls() === 0 && st.claims.length === 0 &&
        JSON.stringify(st.updates[0]?.patch.gateResult).includes("linkedin-sender-not-connected"),
    );
  }

  const holds: { name: string; seed: FakeSeed; reason: string }[] = [
    { name: "kill switch", seed: { controls: { ...CONTROLS_ON, killSwitch: true } }, reason: "linkedin-campaign:kill-switch" },
    { name: "missing controls row", seed: { controls: null }, reason: "linkedin-campaign:kill-switch" },
    { name: "sending off", seed: { controls: { ...CONTROLS_ON, loopEnabled: false } }, reason: "linkedin-campaign:sending-off" },
    { name: "no approval row", seed: { approval: null }, reason: "linkedin-campaign:not-launched" },
    { name: "approval not written by a launch", seed: { approval: { grantId: null, revokedAt: null } }, reason: "linkedin-campaign:not-launched" },
    { name: "approval revoked", seed: { approval: { grantId: "grant-1", revokedAt: "2026-09-02T11:00:00Z" } }, reason: "linkedin-campaign:not-launched" },
    { name: "reply-only launch", seed: { grants: [grant({ scope: "replies" })] }, reason: "linkedin-campaign:not-launched" },
    { name: "launch in another workspace", seed: { grants: [grant({ workspaceId: "ws-2" })] }, reason: "linkedin-campaign:not-launched" },
    { name: "launch revoked", seed: { grants: [grant({ revokedAt: "2026-09-02T11:58:00Z" })] }, reason: "linkedin-campaign:launch-revoked" },
    { name: "note over 200 characters", seed: { due: [dueConnect({ note: "x".repeat(LINKEDIN_CONNECT_NOTE_MAX + 1) })] }, reason: "linkedin-campaign:note-too-long" },
    { name: "note that identifies as AI", seed: { due: [dueConnect({ note: "I am an AI assistant helping a recruiter, let us connect." })] }, reason: "gate:" },
    { name: "seat not live", seed: { seat: { provider: "LinkedIn Vendor API", status: "active", mode: "dry-run", providerState: "connected" } }, reason: "linkedin-seat-not-live" },
    { name: "DB claim refuses", seed: { claim: { allowed: false, reason: "recently-contacted" } }, reason: "guardrail:recently-contacted" },
  ];
  for (const h of holds) {
    const a = adapter("vendor-api", true);
    const f = fakeStore({ due: h.seed.due ?? [dueConnect()], ...h.seed });
    const st = await dispatchLinkedInCampaignDue({ store: f.store, now: () => NOW, adapterFor: () => a.adapter });
    ok(
      `dispatch: ${h.name} → blocked ${h.reason}, transport never runs`,
      st.blocked === 1 && st.sent === 0 && a.calls() === 0 && f.updates[0]?.patch.status === "blocked" &&
        JSON.stringify(f.updates[0]?.patch.gateResult).includes(h.reason),
    );
  }
  ok("dispatch: the note ceiling is 200 characters", LINKEDIN_CONNECT_NOTE_MAX === 200);

  // jitter window 2 to 10 min holds for connects too
  const two = adapter("vendor-api", true);
  const j = fakeStore({ due: [dueConnect({ id: "out-1" }), dueConnect({ id: "out-2", profileUrl: "https://www.linkedin.com/in/anna-k" })] });
  const js = await dispatchLinkedInCampaignDue({ store: j.store, now: () => NOW, adapterFor: () => two.adapter });
  ok("jitter: two due rows in one workspace → one sent, one rescheduled", js.sent === 1 && js.rescheduled === 1 && two.calls() === 1);
  const pushed = j.updates.find((u) => u.id === "out-2");
  ok("jitter: the second row is pushed 2 to 10 minutes out, still queued", pushed !== undefined && pushed.patch.status === undefined && inWindow(NOW, pushed.patch.scheduledAt as string));
  const other = adapter("vendor-api", true);
  const w = fakeStore({ due: [dueConnect({ id: "out-1" }), dueConnect({ id: "out-2", workspaceId: "ws-1" }), dueConnect({ id: "out-3", workspaceId: "ws-2" })], grants: [grant(), grant({ id: "grant-2", workspaceId: "ws-2" })], approval: { grantId: "grant-1", revokedAt: null } });
  // ws-2 rows resolve to grant-1 (ws-1) through the shared fake approval and are blocked as not launched; the point is ws-1 spacing.
  const ws = await dispatchLinkedInCampaignDue({ store: w.store, now: () => NOW, adapterFor: () => other.adapter });
  ok("jitter: only one request leaves per workspace per pass", ws.sent === 1 && ws.rescheduled === 1);

  const night = adapter("vendor-api", true);
  const q = fakeStore({ due: [dueConnect()] });
  const qs = await dispatchLinkedInCampaignDue({ store: q.store, now: () => NIGHT, adapterFor: () => night.adapter });
  const at = q.updates[0]?.patch.scheduledAt as string | undefined;
  ok("quiet hours: connect at 00:30 Paris → rescheduled after 08:00 Paris, no claim", qs.rescheduled === 1 && qs.sent === 0 && q.claims.length === 0 && Date.parse(at ?? "") >= Date.parse("2026-09-03T06:00:00.000Z"));
  ok("quiet hours: the pushed send is jittered, not 08:00:00", Date.parse(at ?? "") > Date.parse("2026-09-03T06:00:00.000Z") + LOOP_REPLY_DELAY_MIN_MS - 1);

  // connect cap 25 holds the 26th
  const capped = adapter("vendor-api", true);
  const c = fakeStore({ due: [dueConnect()], connectsToday: 25 });
  const cs = await dispatchLinkedInCampaignDue({ store: c.store, now: () => NOW, adapterFor: () => capped.adapter });
  const wait = c.updates[0];
  ok("cap: 25 connects today → the 26th waits, no claim, no send", cs.waiting === 1 && cs.sent === 0 && cs.blocked === 0 && c.claims.length === 0 && capped.calls() === 0);
  ok("cap: the waiting row stays queued (no status change) with the waiting reason", wait?.patch.status === undefined && JSON.stringify(wait?.patch.gateResult).includes(WAITING_FOR_LIMIT_REASON));
  const tomorrow = loopNextDayStart(NOW, TZ);
  ok("cap: tomorrow starts at local midnight (22:00Z for Paris)", tomorrow.toISOString() === "2026-09-02T22:00:00.000Z");
  ok("cap: the waiting row is scheduled for tomorrow, after quiet hours, jittered", Date.parse((wait?.patch.scheduledAt as string) ?? "") >= Date.parse("2026-09-03T06:00:00.000Z") + LOOP_REPLY_DELAY_MIN_MS);

  const under = adapter("vendor-api", true);
  const u = fakeStore({ due: [dueConnect()], connectsToday: 24 });
  const us = await dispatchLinkedInCampaignDue({ store: u.store, now: () => NOW, adapterFor: () => under.adapter });
  ok("cap: 24 connects today → the 25th goes", us.sent === 1);

  const race = adapter("vendor-api", true);
  const r = fakeStore({ due: [dueConnect()], connectsToday: 24, claim: { allowed: false, reason: "workspace-connect-cap-reached" } });
  const rsx = await dispatchLinkedInCampaignDue({ store: r.store, now: () => NOW, adapterFor: () => race.adapter });
  ok("cap: the claim serialises, the 26th in the same second waits instead of failing", rsx.waiting === 1 && rsx.blocked === 0 && race.calls() === 0);

  // Two drains at once: the claim's two-minute spacing wins, the row is rescheduled inside the window.
  const spaced = adapter("vendor-api", true);
  const sp = fakeStore({ due: [dueConnect()], claim: { allowed: false, reason: "connect-too-soon" } });
  const sps = await dispatchLinkedInCampaignDue({ store: sp.store, now: () => NOW, adapterFor: () => spaced.adapter });
  ok("jitter: a concurrent drain's send under two minutes ago → rescheduled 2 to 10 min, not blocked, no transport", sps.rescheduled === 1 && sps.blocked === 0 && spaced.calls() === 0 && sp.updates[0]?.patch.status === undefined && inWindow(NOW, sp.updates[0]?.patch.scheduledAt as string));

  const lowered = adapter("vendor-api", true);
  const l = fakeStore({ due: [dueConnect()], controls: { ...CONTROLS_ON, connectCap: 3 }, connectsToday: 3 });
  const ls = await dispatchLinkedInCampaignDue({ store: l.store, now: () => NOW, adapterFor: () => lowered.adapter });
  ok("cap: a workspace limit under 25 holds at that limit", ls.waiting === 1 && ls.sent === 0);
  const over = adapter("vendor-api", true);
  const o = fakeStore({ due: [dueConnect()], controls: { ...CONTROLS_ON, connectCap: 40 }, connectsToday: 25 });
  const os = await dispatchLinkedInCampaignDue({ store: o.store, now: () => NOW, adapterFor: () => over.adapter });
  ok("cap: a limit above 25 is still 25", os.waiting === 1 && os.sent === 0);
  const countless = adapter("vendor-api", true);
  const x = fakeStore({ due: [dueConnect()], connectsToday: null });
  const xs = await dispatchLinkedInCampaignDue({ store: x.store, now: () => NOW, adapterFor: () => countless.adapter });
  ok("cap: an unavailable count is a failure, never a send", xs.failed === 1 && xs.sent === 0 && countless.calls() === 0);
})();

// ---------------------------------------------------------------------------
// Accepted event: stored, then the first message is scheduled or held
// ---------------------------------------------------------------------------
function accepted(over: Partial<LoopConnectionAcceptedEvent> = {}): LoopConnectionAcceptedEvent {
  return { profileUrl: PROFILE, providerId: "ev-hr-1", vendorCampaignId: null, receivedAt: NOW.getTime() - 1_000, firstName: "Marco", ...over };
}
const attempt = (over: Partial<ConnectAttemptRow> = {}): ConnectAttemptRow => ({
  workspaceId: "ws-1",
  grantId: "grant-1",
  candidateId: "cand-1",
  profileUrl: PROFILE,
  status: "sent",
  ...over,
});

await (async () => {
  const stranger = fakeStore({ attempts: [] });
  const r0 = await ingestLinkedInConnectionAccepted({ store: stranger.store, now: () => NOW }, accepted());
  ok("accepted: nobody asked this person to connect → skipped, nothing stored, never guessed", r0.outcome === "skipped" && r0.reason === "no-connection-request" && stranger.events.length === 0 && stranger.scheduled.length === 0);

  const ambiguous = fakeStore({ attempts: [attempt(), attempt({ workspaceId: "ws-2", grantId: "grant-2" })] });
  const r1 = await ingestLinkedInConnectionAccepted({ store: ambiguous.store, now: () => NOW }, accepted());
  ok("accepted: two workspaces asked and no campaign id → skipped ambiguous-tenant, nothing stored", r1.outcome === "skipped" && r1.reason === "ambiguous-tenant" && ambiguous.events.length === 0);

  // accepted event for a person without a campaign grant is stored and held
  const replyOnly = fakeStore({ attempts: [attempt()], grants: [grant({ scope: "replies" })] });
  const r2 = await ingestLinkedInConnectionAccepted({ store: replyOnly.store, now: () => NOW }, accepted());
  ok("accepted: reply-only launch → stored and held no-campaign-launch", r2.outcome === "held" && r2.reason === "no-campaign-launch" && replyOnly.events[0]?.status === "held" && replyOnly.events[0]?.reason === "no-campaign-launch");
  ok("accepted: held → no first message queued", replyOnly.scheduled.length === 0);

  const noGrant = fakeStore({ attempts: [attempt({ grantId: "grant-gone" })], grants: [] });
  const r3 = await ingestLinkedInConnectionAccepted({ store: noGrant.store, now: () => NOW }, accepted());
  ok("accepted: launch no longer exists → stored and held", r3.outcome === "held" && r3.reason === "no-campaign-launch" && noGrant.events.length === 1 && noGrant.events[0]?.grantId === null);

  const revoked = fakeStore({ attempts: [attempt()], grants: [grant({ revokedAt: "2026-09-02T11:00:00Z" })] });
  const r4 = await ingestLinkedInConnectionAccepted({ store: revoked.store, now: () => NOW }, accepted());
  ok("accepted: launch revoked → held, event kept for a person", r4.outcome === "held" && r4.reason === "campaign-launch-revoked" && revoked.events.length === 1);

  // the happy path: first message scheduled 2 to 10 minutes out
  const s = fakeStore({ attempts: [attempt()] });
  const r5 = await ingestLinkedInConnectionAccepted({ store: s.store, now: () => NOW }, accepted());
  ok("accepted: campaign launch → first message scheduled", r5.outcome === "scheduled" && r5.messageId === "msg-1");
  ok("accepted: scheduled 2 to 10 minutes out, never immediate", inWindow(NOW, s.scheduled[0]?.scheduledAt));
  ok("accepted: event marked scheduled with the outbox row", s.events[0]?.status === "scheduled" && s.events[0]?.outboundMessageId === "msg-1" && s.events[0]?.grantId === "grant-1");

  const night = fakeStore({ attempts: [attempt()] });
  const r6 = await ingestLinkedInConnectionAccepted({ store: night.store, now: () => NIGHT }, accepted({ receivedAt: NIGHT.getTime() }));
  ok("accepted: quiet hours → still scheduled, but after 08:00 Paris", r6.outcome === "scheduled" && Date.parse(night.scheduled[0]?.scheduledAt ?? "") >= Date.parse("2026-09-03T06:00:00.000Z"));

  const viaCampaign = fakeStore({ attempts: [], campaignGrant: grant() });
  const r7 = await ingestLinkedInConnectionAccepted({ store: viaCampaign.store, now: () => NOW }, accepted({ vendorCampaignId: "hr-77" }));
  ok("accepted: the vendor campaign resolves the tenant when the ledger has no row", r7.outcome === "scheduled" && viaCampaign.events[0]?.grantId === "grant-1");

  const holds: { name: string; seed: FakeSeed; reason: string }[] = [
    { name: "kill switch", seed: { attempts: [attempt()], controls: { ...CONTROLS_ON, killSwitch: true } }, reason: "kill-switch" },
    { name: "missing controls row", seed: { attempts: [attempt()], controls: null }, reason: "kill-switch" },
    { name: "sending off", seed: { attempts: [attempt()], controls: { ...CONTROLS_ON, loopEnabled: false } }, reason: "loop-disabled" },
    { name: "suppressed person", seed: { attempts: [attempt()], suppressed: true }, reason: "opted-out" },
    { name: "message cap reached", seed: { attempts: [attempt()], messagesToday: 25 }, reason: "workspace-message-cap-reached" },
    { name: "no first message draft", seed: { attempts: [attempt()], draft: null }, reason: "no-first-message-draft" },
    { name: "draft not approved at this launch", seed: { attempts: [attempt()], draft: { status: "composed", approvalGrantId: "grant-other" } }, reason: "draft-not-launched" },
    { name: "draft already queued", seed: { attempts: [attempt()], draft: { status: "queued", approvalGrantId: "grant-1" } }, reason: "already-scheduled" },
    { name: "draft already sent", seed: { attempts: [attempt()], draft: { status: "sent", approvalGrantId: "grant-1" } }, reason: "already-sent" },
  ];
  for (const h of holds) {
    const f = fakeStore(h.seed);
    const r = await ingestLinkedInConnectionAccepted({ store: f.store, now: () => NOW }, accepted());
    ok(`accepted: ${h.name} → held ${h.reason}, stored, nothing queued`, r.outcome === "held" && r.reason === h.reason && f.events[0]?.reason === h.reason && f.scheduled.length === 0);
  }

  const dup = fakeStore({ attempts: [attempt()], duplicateEvent: true });
  const r8 = await ingestLinkedInConnectionAccepted({ store: dup.store, now: () => NOW }, accepted());
  ok("accepted: the same vendor event twice → skipped duplicate, nothing queued", r8.outcome === "skipped" && r8.reason === "duplicate-event" && dup.scheduled.length === 0);

  const countless = fakeStore({ attempts: [attempt()], messagesToday: null });
  const r9 = await ingestLinkedInConnectionAccepted({ store: countless.store, now: () => NOW }, accepted());
  ok("accepted: an unavailable message count → retry, nothing queued", r9.outcome === "retry" && countless.scheduled.length === 0);

  // The pure decision on its own.
  const base = { now: NOW, seed: "ev-1", grant: grant(), controls: CONTROLS_ON, optedOut: false, messagesToday: 0 };
  const d = decideFirstMessageAfterAccept(base);
  ok("decide: campaign launch → schedule inside the window", d.action === "schedule" && d.delayMs >= LOOP_REPLY_DELAY_MIN_MS && d.delayMs <= LOOP_REPLY_DELAY_MAX_MS);
  ok("decide: replies scope → no-campaign-launch", decideFirstMessageAfterAccept({ ...base, grant: grant({ scope: "replies" }) }).action === "hold");
  ok("decide: cap 25 reached → hold", decideFirstMessageAfterAccept({ ...base, messagesToday: 25 }).action === "hold");
  ok("decide: 24 sent → schedule", decideFirstMessageAfterAccept({ ...base, messagesToday: 24 }).action === "schedule");
})();

// ---------------------------------------------------------------------------
// SQL contract (0059)
// ---------------------------------------------------------------------------
{
  const m58 = readFileSync("supabase/migrations/0058_linkedin_sender_state_authority.sql", "utf8");
  const m59 = readFileSync("supabase/migrations/0059_linkedin_connect_primitive_authority.sql", "utf8");
  const code59 = m59.replace(/^--.*$/gm, "");

  ok(
    "0059 widens the outbox kind to connection_request and finds the old check by content",
    /check \(type in \('candidate_reply', 'approved_template', 'connection_request'\)\)/.test(m59) &&
      /pg_get_constraintdef\(oid\) ~ 'candidate_reply'/.test(m59),
  );
  ok("0059 binds the connect ledger to its outbox row", /alter table public\.linkedin_connect_attempts\s+add column if not exists outbound_message_id uuid references public\.messages_outbound\(id\)/.test(m59));
  ok(
    "0059 stores accepted events per workspace, idempotent on the vendor id, held by default",
    /create table if not exists public\.linkedin_connect_events/.test(m59) &&
      /status\s+text not null default 'held' check \(status in \('held', 'scheduled'\)\)/.test(m59) &&
      /unique \(workspace_id, provider_id\)/.test(m59) &&
      /for select to authenticated using \(workspace_id = public\.current_workspace_id\(\)\)/.test(m59),
  );

  const claim = functionBlock(m59, "claim_linkedin_connect");
  ok("claim_linkedin_connect exists and is service-only in the body", claim.length > 0 && /coalesce\(auth\.role\(\), ''\) <> 'service_role'/.test(claim));
  ok("claim: only a queued connection request without a loop grant id", /outbound\.type <> 'connection_request' or outbound\.linkedin_reply_grant_id is not null/.test(claim) && /'not-a-connection-request'/.test(claim));
  ok("claim: the note ceiling is enforced in SQL too", /length\(outbound\.body\) > 200/.test(claim) && /'note-too-long'/.test(claim));
  ok(
    "claim: the note must match a live human approval, hashed like 0054",
    /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/.test(claim) &&
      /approval\.approval_scope_hash is distinct from encode\(digest\(outbound\.candidate_id \|\| E'\\n' \|\| outbound\.channel \|\| E'\\n' \|\| recipient, 'sha256'\), 'hex'\)/.test(claim) &&
      /approval\.approval_source <> 'human'/.test(claim),
  );
  ok(
    "claim: the launch comes from the approval row and must be a live campaign launch",
    /if approval\.linkedin_reply_grant_id is null then\s+return json_build_object\('allowed', false, 'reason', 'no-campaign-launch'\)/.test(claim) &&
      /where id = approval\.linkedin_reply_grant_id and workspace_id = outbound\.workspace_id/.test(claim) &&
      /if not found or grant_row\.scope <> 'campaign' then/.test(claim) &&
      /if not public\.linkedin_reply_grant_active\(outbound\.workspace_id, grant_row\.id\) then\s+return json_build_object\('allowed', false, 'reason', 'campaign-launch-revoked'\)/.test(claim),
  );
  ok("claim: suppression is honoured", /'suppressed'/.test(claim) && /s\.type = 'linkedin'/.test(claim));
  ok(
    "claim: vendor seat only, sender connected only",
    /seat\.provider <> 'LinkedIn Vendor API'/.test(claim) && /'seat-not-live-vendor'/.test(claim) &&
      /if seat\.provider_state <> 'connected' then\s+return json_build_object\('allowed', false, 'reason', 'linkedin-sender-not-connected'\)/.test(claim),
  );
  ok("claim: the 90-day contact window applies", /interval '90 days'/.test(claim) && /'recently-contacted'/.test(claim));
  const capCheck =
    /select c\.linkedin_daily_connect_cap into ws_cap[\s\S]*?for update;[\s\S]*?if not found then ws_cap := 0; end if;[\s\S]*?ws_used := public\.linkedin_connects_today\(outbound\.workspace_id\);[\s\S]*?if ws_used >= ws_cap then[\s\S]*?'workspace-connect-cap-reached'/;
  ok("claim: locks the controls row and checks the connect cap (missing row is 0)", capCheck.test(claim));
  ok(
    "claim: two minutes between requests in a workspace, checked after the cap and before the insert",
    /x\.at > now\(\) - interval '2 minutes'/.test(claim) && /'connect-too-soon'/.test(claim) &&
      claim.indexOf("'workspace-connect-cap-reached'") < claim.indexOf("'connect-too-soon'") &&
      claim.indexOf("'connect-too-soon'") < claim.indexOf("insert into public.linkedin_connect_attempts("),
  );
  ok(
    "claim: every check happens before the ledger insert; the ledger carries the grant and the outbox row",
    claim.indexOf("'workspace-connect-cap-reached'") < claim.indexOf("insert into public.linkedin_connect_attempts(") &&
      claim.indexOf("'linkedin-sender-not-connected'") < claim.indexOf("insert into public.linkedin_connect_attempts(") &&
      /insert into public\.linkedin_connect_attempts\(\s+workspace_id, grant_id, outbound_message_id, candidate_id, profile_url, send_attempt_id, status\s+\)/.test(claim) &&
      /exception when unique_violation then\s+return json_build_object\('allowed', false, 'reason', 'already-requested'\)/.test(claim),
  );
  ok("claim: never touches outreach_ledger or the message cap", !/insert into public\.outreach_ledger/.test(claim) && !/linkedin_messages_today/.test(claim) && !/linkedin_daily_message_cap/.test(claim));
  ok("claim: queued → dispatching under a delivery attempt id", /set status = 'dispatching',\s+dispatching_at = now\(\),\s+delivery_attempt_id = attempt_id/.test(claim));

  const outcome = functionBlock(m59, "record_linkedin_connect_outcome", "\\(");
  ok(
    "record_linkedin_connect_outcome: service-only, connection requests only, attempt must be claimed",
    /coalesce\(auth\.role\(\), ''\) <> 'service_role'/.test(outcome) &&
      /outbound\.type <> 'connection_request'/.test(outcome) &&
      /if attempt\.status <> 'claimed' then/.test(outcome) &&
      /update public\.linkedin_connect_attempts\s+set status = p_outcome/.test(outcome),
  );

  // The message claim is the 0058 body plus one branch that refuses a connection request.
  const outbound58 = functionBlock(m58, "claim_linkedin_outbound_queued");
  const outbound59 = functionBlock(m59, "claim_linkedin_outbound_queued");
  const branch = /\n  -- Connection request \(0059\)\.[^\n]*\n(?:  --[^\n]*\n)*  if outbound\.type = 'connection_request' then\n    return json_build_object\('allowed', false, 'reason', 'not-a-message'\);\n  end if;\n/;
  ok("message claim refuses a connection request", branch.test(outbound59));
  ok("message claim is the 0058 body plus that one branch, byte for byte", outbound59.replace(branch, "") === outbound58);
  ok("the 0058 message claim this slice builds on is frozen", sha256(outbound58) === "ba2b976b4802ebbfdb1ab1ff9ed51921d3c8eca3b5e22364f2a8cd48f79c2331");
  ok(
    "the refusal happens before the approval lookup and before any write",
    outbound59.indexOf("'not-a-message'") < outbound59.indexOf("select * into approval") &&
      outbound59.indexOf("'not-a-message'") < outbound59.indexOf("insert into public.outreach_ledger("),
  );
  ok("0059 does not redefine the loop claim, the approval trigger or the launch", !/claim_linkedin_loop_reply/.test(code59) && !/enforce_active_linkedin_approval/.test(code59) && !/create trigger/.test(m59) && !/launch_linkedin_campaign/.test(code59));
  ok("nothing in 0059 sets a sender connected", !/provider_state = 'connected'/.test(m59.replace(/<> 'connected'/g, "")));
  ok(
    "the new RPCs are service-role only",
    /grant execute on function public\.claim_linkedin_connect\(uuid\) to service_role;/.test(m59) &&
      /revoke all on function public\.claim_linkedin_connect\(uuid\) from public, anon, authenticated, service_role, authenticator;/.test(m59) &&
      /grant execute on function public\.record_linkedin_connect_outcome\(uuid, uuid, text, text, text\) to service_role;/.test(m59) &&
      /revoke all on function public\.record_linkedin_connect_outcome\(uuid, uuid, text, text, text\) from public, anon, authenticated, service_role, authenticator;/.test(m59) &&
      !/to authenticated;/.test(code59.slice(code59.indexOf("grant execute"))),
  );
  const priv = readFileSync("tests/db/function-privileges.sql", "utf8");
  ok(
    "privilege proof lists both RPCs as service_role and in the in-body assertion list",
    /public\.claim_linkedin_connect\(uuid\)'\s*,\s*'service_role'/.test(priv) &&
      /public\.record_linkedin_connect_outcome\(uuid,uuid,text,text,text\)'\s*,\s*'service_role'/.test(priv) &&
      /\('public\.claim_linkedin_connect\(uuid\)'\),/.test(priv) &&
      /\('public\.record_linkedin_connect_outcome\(uuid,uuid,text,text,text\)'\),/.test(priv),
  );
}

// ---------------------------------------------------------------------------
// Wiring: the message dispatcher skips connects, both drains run, the webhook
// reads accepted events, the suite is registered
// ---------------------------------------------------------------------------
{
  const outbound = readFileSync("src/lib/dispatch-outbound.ts", "utf8");
  ok(
    "first-touch dispatcher never selects a connection request",
    /\.neq\("type", "connection_request"\)/.test(outbound) && outbound.indexOf('.neq("type", "connection_request")') < outbound.indexOf('.lte("scheduled_at"'),
  );
  const cron = readFileSync("src/app/api/cron/dispatch-outbound/route.ts", "utf8");
  ok("cron drains connection requests after the reply loop", cron.indexOf("drainLinkedInLoop(supabase") < cron.indexOf("drainLinkedInCampaign(supabase"));
  const webhook = readFileSync("src/app/api/webhooks/linkedin/route.ts", "utf8");
  ok(
    "webhook stores accepted events and drains connects, after the secret check",
    webhook.indexOf("verifyLoopWebhookSecret") < webhook.indexOf("parseLinkedInConnectionAccepted(payload)") &&
      /ingestLinkedInConnectionAcceptedEvent\(supabase, accepted\)/.test(webhook) &&
      /drainLinkedInCampaign\(supabase, 5\)/.test(webhook),
  );
  const server = readFileSync("src/lib/linkedin-loop-server.ts", "utf8");
  ok("server wiring binds the connect store to the service client", /supabaseLinkedInConnectStore\(svc\)/.test(server) && /dispatchLinkedInCampaignDue\(/.test(server));
  const dispatch = readFileSync("src/lib/linkedin-connect-dispatch.ts", "utf8");
  ok(
    "dispatcher blocks the unconfigured endpoint and the sender state before the claim",
    dispatch.indexOf('"linkedin-connect-unconfigured"') < dispatch.indexOf("deps.store.claimConnect(row.id)") &&
      dispatch.indexOf('"linkedin-sender-not-connected"') < dispatch.indexOf("deps.store.claimConnect(row.id)") &&
      /adapter\.connectConfigured\(\)/.test(dispatch),
  );
  ok("dispatcher never calls deliver for a connect", !/adapter\.deliver\(/.test(dispatch));
  const store = readFileSync("src/lib/linkedin-connect-store.ts", "utf8");
  ok(
    "store drains only queued connection requests without a loop grant, claims through the 0059 RPC",
    /\.eq\("type", "connection_request"\)/.test(store) && /\.is\("linkedin_reply_grant_id", null\)/.test(store) &&
      /rpc\("claim_linkedin_connect"/.test(store) && /rpc\("record_linkedin_connect_outcome"/.test(store),
  );
  ok(
    "store queues the first message only from composed and only with a launch approval bound to the grant",
    /\.eq\("status", "composed"\)/.test(store) && /approvalRow\.linkedin_reply_grant_id !== input\.grantId/.test(store) && !/\.insert\(\{[^}]*type: "candidate_reply"/.test(store),
  );
  const manifest = testManifest as { commands: { id: string; argv: string[] }[]; groups: Record<string, string[]> };
  ok("the suite is registered in the application group", manifest.commands.some((c) => c.id === "linkedin-connect" && c.argv.at(-1) === "tests/linkedin-connect.mts") && manifest.groups.application.includes("linkedin-connect"));
}

// ---------------------------------------------------------------------------
// Copy: original Aria, no vendor names, no em dashes, never AI
// ---------------------------------------------------------------------------
{
  const reasons = [WAITING_FOR_LIMIT_REASON, LAUNCH_COPY.waitingForLimit];
  const text = reasons.join("\n");
  ok("waiting copy exists for the campaign view", LAUNCH_COPY.waitingForLimit === "Waiting for tomorrow's limit");
  ok("connect copy has no em dash", !text.includes("—"));
  ok("connect copy never names a vendor", !/heyreach|unipile|phantombuster|dux-?soup/i.test(text));
  ok("connect copy never says AI, bot or automation", !/\b(AI|assistant|automation|bot|model)\b/.test(text));
  const channel = readFileSync("src/lib/linkedin-channel.ts", "utf8");
  ok("adapter details have no em dash", !channel.includes("—"));
  const dispatch = readFileSync("src/lib/linkedin-connect-dispatch.ts", "utf8");
  const inbound = readFileSync("src/lib/linkedin-connect-inbound.ts", "utf8");
  ok("dispatcher and ingest have no em dash and never name a vendor", !(dispatch + inbound).includes("—") && !/heyreach|unipile|phantombuster|dux-?soup/i.test(dispatch + inbound));
}

// Restore what the adapter proofs touched.
for (const key of ENV_KEYS) {
  const value = savedEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
globalThis.fetch = savedFetch;

console.log(`RESULT linkedin-connect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
