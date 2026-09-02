/**
 * LinkedIn workspace caps: fail-closed proofs (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S1).
 *
 *   - 25 messages sent today: one more reply is held, no row written
 *   - 24 sent: one more is scheduled; the 26th in the same second is held
 *   - missing controls row means hold, never send
 *   - cap day rolls in the workspace timezone, not UTC
 *   - SQL contract: both claim RPCs lock the controls row and check the
 *     workspace cap; the grant sub-cap still applies
 *   - the UI cannot submit a cap above 25 (schema max 25, server rejects 26)
 */
import { readFileSync } from "node:fs";
import {
  LINKEDIN_DAILY_CONNECT_CAP,
  LINKEDIN_DAILY_MESSAGE_CAP,
  decideLoopReply,
  effectiveConnectCap,
  effectiveMessageCap,
  loopDayStart,
  type LoopControls,
} from "../src/lib/linkedin-loop";
import { LinkedInCapsSchema, sendingControlsFromRow } from "../src/lib/linkedin-caps";
import { ingestLinkedInInbound, type LinkedInIngestDeps } from "../src/lib/linkedin-inbound";
import { supabaseLinkedInLoopStore, type LinkedInLoopStore, type LoopGrantRow, type LoopReplyInsert } from "../src/lib/linkedin-loop-store";

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

const CONTROLS_ON: LoopControls = { killSwitch: false, loopEnabled: true, messageCap: 25, connectCap: 25, timezone: TZ };

function grant(over: Partial<LoopGrantRow> = {}): LoopGrantRow {
  return {
    id: "grant-1",
    workspaceId: "ws-1",
    channel: "LinkedIn",
    campaignId: "camp-1",
    vendorCampaignId: "vc-77",
    seatId: "seat-vendor",
    calendarSeatId: null,
    interviewerEmail: "",
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
// Constants and effective caps
// ---------------------------------------------------------------------------
ok("message cap constant is 25", LINKEDIN_DAILY_MESSAGE_CAP === 25);
ok("connect cap constant is 25", LINKEDIN_DAILY_CONNECT_CAP === 25);
ok("effective cap: missing controls row is 0", effectiveMessageCap(null) === 0 && effectiveConnectCap(null) === 0);
ok(
  "effective cap: a row above the ceiling is clamped to 25",
  effectiveMessageCap({ ...CONTROLS_ON, messageCap: 99 }) === 25 && effectiveConnectCap({ ...CONTROLS_ON, connectCap: 99 }) === 25,
);
ok("effective cap: negative reads as 0", effectiveMessageCap({ ...CONTROLS_ON, messageCap: -3 }) === 0);

// ---------------------------------------------------------------------------
// decideLoopReply: the workspace ceiling
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
  const at25 = decideLoopReply({ ...base, messagesToday: 25 });
  ok("25 messages today → hold workspace-message-cap-reached", at25.action === "hold" && at25.reason === "workspace-message-cap-reached");
  const at24 = decideLoopReply({ ...base, messagesToday: 24 });
  ok("24 messages today → one more is scheduled", at24.action === "schedule");
  const at26 = decideLoopReply({ ...base, messagesToday: 25, now: NOW });
  ok("the 26th in the same second → held", at26.action === "hold" && at26.reason === "workspace-message-cap-reached");
  const lowered = decideLoopReply({ ...base, controls: { ...CONTROLS_ON, messageCap: 3 }, messagesToday: 3 });
  ok("a lowered workspace cap holds at its own value", lowered.action === "hold" && lowered.reason === "workspace-message-cap-reached");
  const zero = decideLoopReply({ ...base, controls: { ...CONTROLS_ON, messageCap: 0 } });
  ok("cap 0 → nothing sends", zero.action === "hold" && zero.reason === "workspace-message-cap-reached");
  const noRow = decideLoopReply({ ...base, controls: null });
  ok("missing controls row → hold, never send", noRow.action === "hold");
  const subCap = decideLoopReply({ ...base, messagesToday: 10, sentToday: 20 });
  ok("grant sub-cap still applies under the ceiling", subCap.action === "hold" && subCap.reason === "daily-cap-reached");
  const ceilingFirst = decideLoopReply({ ...base, messagesToday: 25, sentToday: 20 });
  ok("ceiling is checked before the grant sub-cap", ceilingFirst.action === "hold" && ceilingFirst.reason === "workspace-message-cap-reached");
}

// ---------------------------------------------------------------------------
// Ingest: a held reply writes no outbound row
// ---------------------------------------------------------------------------
function fakeStore(seed: { messagesToday?: number | null; controls?: LoopControls | null }) {
  const replies: LoopReplyInsert[] = [];
  const marks: { id: string; reason: string | null | undefined }[] = [];
  const store: LinkedInLoopStore = {
    async findGrantForInbound() {
      return grant();
    },
    async getGrant() {
      return grant();
    },
    async readControls() {
      return seed.controls === undefined ? CONTROLS_ON : seed.controls;
    },
    async insertInbound() {
      return { ok: true, id: "in-1" };
    },
    async markInbound(id, patch) {
      marks.push({ id, reason: patch.reason });
      return true;
    },
    async resolveThread() {
      return {
        conversationId: "convo-1",
        candidateId: "cand-1",
        candidateName: "Marco Rossi",
        seatId: "seat-vendor",
        specId: null,
        ownerId: null,
        lastOutboundBody: "Hi Marco, quick note about a BA role.",
        roleBrief: { title: "Business Analyst" },
      };
    },
    async isSuppressed() {
      return false;
    },
    async recordOptOut() {
      return true;
    },
    async cancelQueuedReplies() {
      return true;
    },
    async countAttemptsToday() {
      return 0;
    },
    async countWorkspaceMessagesToday() {
      return seed.messagesToday === undefined ? 0 : seed.messagesToday;
    },
    async insertReply(row) {
      replies.push(row);
      return { ok: true, id: `out-${replies.length}` };
    },
    async listDueReplies() {
      return [];
    },
    async readSeat() {
      return { provider: "LinkedIn Vendor API", status: "active", mode: "live" };
    },
    async readRoleBrief() {
      return null;
    },
    async updateReply() {
      return true;
    },
    async claimReply() {
      return { allowed: true, deliveryAttemptId: "attempt-1", profileUrl: PROFILE };
    },
    async recordOutcome() {
      return true;
    },
  };
  return { store, replies, marks };
}

const event = {
  profileUrl: PROFILE,
  text: "Sure, tell me more about the team?",
  providerId: "msg-1",
  vendorCampaignId: "vc-77",
  receivedAt: NOW.getTime() - 1_000,
  firstName: "Marco",
};

function deps(store: LinkedInLoopStore): LinkedInIngestDeps {
  return { store, compose: async () => "Happy to share more. What matters most to you?", now: () => NOW };
}

await (async () => {
  const full = fakeStore({ messagesToday: 25 });
  const held = await ingestLinkedInInbound(deps(full.store), event);
  ok("ingest at 25 → held with the workspace reason", held.outcome === "held" && held.reason === "workspace-message-cap-reached");
  ok("ingest at 25 → no outbound row written", full.replies.length === 0);
  ok("ingest at 25 → inbound marked with the reason", full.marks.some((m) => m.reason === "workspace-message-cap-reached"));

  const room = fakeStore({ messagesToday: 24 });
  const scheduled = await ingestLinkedInInbound(deps(room.store), event);
  ok("ingest at 24 → reply queued", scheduled.outcome === "scheduled" && room.replies.length === 1 && room.replies[0]?.status === "queued");

  const noRow = fakeStore({ controls: null });
  const closed = await ingestLinkedInInbound(deps(noRow.store), event);
  ok("ingest without a controls row → held, no row", closed.outcome === "held" && noRow.replies.length === 0);

  const unknown = fakeStore({ messagesToday: null });
  const retry = await ingestLinkedInInbound(deps(unknown.store), event);
  ok("ingest when the count is unavailable → retry, never send", retry.outcome === "retry" && unknown.replies.length === 0);
})();

// ---------------------------------------------------------------------------
// The cap day rolls in the workspace timezone, not UTC
// ---------------------------------------------------------------------------
{
  const lateUtc = new Date("2026-09-02T23:30:00.000Z"); // 01:30 on 3 Sept in Paris
  ok(
    "day start in Paris is 22:00 UTC the evening before, not 00:00 UTC",
    loopDayStart(lateUtc, TZ).toISOString() === "2026-09-02T22:00:00.000Z" &&
      loopDayStart(lateUtc, "UTC").toISOString() === "2026-09-02T00:00:00.000Z",
  );

  // The Supabase store filters the counts from the workspace day, not the UTC day.
  const filters: { table: string; gte: string }[] = [];
  const fakeClient = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: (_col: string, value: string) => {
          filters.push({ table, gte: value });
          return Promise.resolve({ count: table === "outreach_ledger" ? 3 : 4, error: null });
        },
      };
      return chain;
    },
  };
  const store = supabaseLinkedInLoopStore(fakeClient as never);
  const total = await store.countWorkspaceMessagesToday("ws-1", TZ, lateUtc);
  ok("store counts first touches plus loop replies", total === 7);
  ok(
    "store counts from the workspace day start (Paris), not UTC midnight",
    filters.length === 2 && filters.every((f) => f.gte === "2026-09-02T22:00:00.000Z"),
  );
  ok(
    "store queries both ledgers",
    filters.some((f) => f.table === "outreach_ledger") && filters.some((f) => f.table === "linkedin_reply_attempts"),
  );
}

// ---------------------------------------------------------------------------
// SQL contract (0056)
// ---------------------------------------------------------------------------
{
  const migration = readFileSync("supabase/migrations/0056_linkedin_workspace_caps_authority.sql", "utf8");
  ok(
    "0056 adds both workspace caps with a 0..25 check and a default of 25",
    /add column if not exists linkedin_daily_message_cap int not null default 25/.test(migration) &&
      /add column if not exists linkedin_daily_connect_cap int not null default 25/.test(migration) &&
      /check \(linkedin_daily_message_cap between 0 and 25\)/.test(migration) &&
      /check \(linkedin_daily_connect_cap between 0 and 25\)/.test(migration),
  );
  ok(
    "0056 counts messages in the workspace timezone",
    /create or replace function public\.linkedin_messages_today\(p_workspace_id uuid\)/.test(migration) &&
      /\(l\.at at time zone tz\.name\)::date = \(now\(\) at time zone tz\.name\)::date/.test(migration) &&
      /\(a\.at at time zone tz\.name\)::date = \(now\(\) at time zone tz\.name\)::date/.test(migration),
  );
  ok(
    "0056 exposes a daily usage view over first touches, replies and connects",
    /create or replace view public\.linkedin_daily_usage/.test(migration) &&
      /from public\.outreach_ledger l/.test(migration) &&
      /from public\.linkedin_reply_attempts a/.test(migration) &&
      /from public\.linkedin_connect_attempts x/.test(migration),
  );

  function fn(name: string): string {
    const m = migration.match(new RegExp(`create or replace function public\\.${name}\\(p_message_id uuid\\)[\\s\\S]*?\\n\\$\\$;`));
    return m ? m[0] : "";
  }
  const outboundClaim = fn("claim_linkedin_outbound_queued");
  const loopClaim = fn("claim_linkedin_loop_reply");
  const capCheck =
    /select c\.linkedin_daily_message_cap into ws_cap[\s\S]*?for update;[\s\S]*?if not found then ws_cap := 0; end if;[\s\S]*?ws_used := public\.linkedin_messages_today\(outbound\.workspace_id\);[\s\S]*?if ws_used >= ws_cap then[\s\S]*?'workspace-message-cap-reached'/;
  ok("first-touch claim locks the controls row and checks the workspace cap", capCheck.test(outboundClaim));
  ok("loop reply claim locks the controls row and checks the workspace cap", capCheck.test(loopClaim));
  ok(
    "the cap check happens before the ledger insert (no row on hold)",
    outboundClaim.indexOf("'workspace-message-cap-reached'") < outboundClaim.indexOf("insert into public.outreach_ledger(") &&
      loopClaim.indexOf("'workspace-message-cap-reached'") < loopClaim.indexOf("insert into public.linkedin_reply_attempts("),
  );
  ok(
    "grant sub-cap still applies in the loop claim",
    /if used_today >= grant_row\.daily_cap then[\s\S]*?'loop-daily-cap-reached'/.test(loopClaim) &&
      /\(a\.at at time zone grant_row\.timezone\)::date = \(now\(\) at time zone grant_row\.timezone\)::date/.test(loopClaim),
  );
  ok(
    "seat and approval checks from 0054 survive in the first-touch claim",
    /approval\.approval_source <> 'human'/.test(outboundClaim) &&
      /'seat-daily-cap-reached'/.test(outboundClaim) &&
      /'recently-contacted'/.test(outboundClaim),
  );
  ok(
    "0056 does not touch the approval trigger",
    !/create or replace function public\.enforce_active_linkedin_approval/.test(migration) &&
      !/create trigger/.test(migration),
  );
  ok(
    "set_linkedin_sending_caps is admin-only and refuses 26",
    /create or replace function public\.set_linkedin_sending_caps\(/.test(migration) &&
      /if role_name <> 'admin' then return json_build_object\('ok', false, 'reason', 'admins-only'\)/.test(migration) &&
      /p_message_cap not between 0 and 25[\s\S]*?p_connect_cap not between 0 and 25[\s\S]*?'cap-out-of-range'/.test(migration),
  );
  ok(
    "read RPC returns caps and today's usage next to the switch",
    /'message_cap', c\.linkedin_daily_message_cap/.test(migration) &&
      /'messages_today', public\.linkedin_messages_today\(c\.workspace_id\)/.test(migration) &&
      /'connects_today', public\.linkedin_connects_today\(c\.workspace_id\)/.test(migration),
  );
  ok(
    "claim RPCs stay service-role only",
    /grant execute on function public\.claim_linkedin_outbound_queued\(uuid\) to service_role;/.test(migration) &&
      /grant execute on function public\.claim_linkedin_loop_reply\(uuid\) to service_role;/.test(migration) &&
      /revoke all on function public\.claim_linkedin_loop_reply\(uuid\) from public, anon, authenticated, service_role, authenticator;/.test(migration),
  );
}

// ---------------------------------------------------------------------------
// The UI cannot submit a cap above 25
// ---------------------------------------------------------------------------
{
  ok("schema accepts 25 and 25", LinkedInCapsSchema.safeParse({ messageCap: 25, connectCap: 25 }).success);
  ok("schema accepts 0 and 0", LinkedInCapsSchema.safeParse({ messageCap: 0, connectCap: 0 }).success);
  ok("schema rejects 26 messages", !LinkedInCapsSchema.safeParse({ messageCap: 26, connectCap: 25 }).success);
  ok("schema rejects 26 connects", !LinkedInCapsSchema.safeParse({ messageCap: 25, connectCap: 26 }).success);
  ok("schema rejects negatives and fractions", !LinkedInCapsSchema.safeParse({ messageCap: -1, connectCap: 2.5 }).success);

  const route = readFileSync("src/app/api/outreach/linkedin-loop/controls/route.ts", "utf8");
  ok(
    "controls route validates PATCH with the caps schema before the RPC",
    /export async function PATCH/.test(route) &&
      route.indexOf("validateBody(req, LinkedInCapsSchema") < route.indexOf('rpc("set_linkedin_sending_caps"') &&
      /requireAdmin\(supabase\)/.test(route),
  );

  const panel = readFileSync("src/components/settings/linkedin-loop-panel.tsx", "utf8");
  ok(
    "settings panel caps both inputs at the constant",
    /max=\{LINKEDIN_DAILY_MESSAGE_CAP\}/.test(panel) && /max=\{LINKEDIN_DAILY_CONNECT_CAP\}/.test(panel) && /clampCap\(/.test(panel),
  );
  ok(
    "settings panel shows today's usage against both limits",
    /data-testid="linkedin-usage-today"/.test(panel) &&
      /controls\.messagesToday\} of \{controls\.messageCap\} messages/.test(panel) &&
      /controls\.connectsToday\} of \{controls\.connectCap\}/.test(panel),
  );
  ok("settings panel shows the reset time", /Resets at/.test(panel));

  const fromRow = sendingControlsFromRow(
    { kill_switch: false, enabled: true, message_cap: 40, connect_cap: 12, timezone: TZ, messages_today: 7, connects_today: 2, resets_at: "2026-09-02T22:00:00+00:00" },
    true,
  );
  ok("read mapping clamps a cap above 25 to 25", fromRow.messageCap === 25 && fromRow.connectCap === 12);
  ok("read mapping carries usage and reset", fromRow.messagesToday === 7 && fromRow.connectsToday === 2 && fromRow.resetsAt !== null);
  const missing = sendingControlsFromRow(null, true);
  ok("read mapping without a row is off and capped at 0", missing.killSwitch && !missing.enabled && missing.messageCap === 0);
}

console.log(`RESULT linkedin-caps: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
