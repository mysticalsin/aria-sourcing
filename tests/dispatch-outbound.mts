import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchDue } from "../src/lib/dispatch-outbound";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

/* ---------------------------------------------------------------------------
   Fake Supabase — just enough of the query-builder surface dispatchDue uses:
   from().select().eq().lte().order().limit()  → { data, error }
   from().select().eq().eq().maybeSingle()     → { data }
   from().update().eq()                        → { error }
   rpc(name, args)                             → { data, error }
--------------------------------------------------------------------------- */
interface Row { [k: string]: unknown }

function makeFakeDb(seed: {
  outbound: Row[];
  approvals: Row[];
  seats: Row[];
  claim: { allowed?: boolean; reason?: string; ledger_id?: string } | null;
  claimError?: { message: string } | null;
}) {
  const updates: { table: string; patch: Row; id: unknown }[] = [];
  const rpcCalls: { fn: string; args: Row }[] = [];

  function table(name: string): Row[] {
    if (name === "messages_outbound") return seed.outbound;
    if (name === "outreach_approvals") return seed.approvals;
    if (name === "agent_seats") return seed.seats;
    return [];
  }

  function query(name: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return q; },
      lte: (col: string, val: string) => { filters.push((r) => String(r[col] ?? "") <= val); return q; },
      order: () => q,
      limit: (n: number) => {
        const data = table(name).filter((r) => filters.every((f) => f(r))).slice(0, n);
        return Promise.resolve({ data, error: null });
      },
      maybeSingle: () => {
        const data = table(name).filter((r) => filters.every((f) => f(r)))[0] ?? null;
        return Promise.resolve({ data, error: null });
      },
      update: (patch: Row) => ({
        eq: (_col: string, id: unknown) => {
          updates.push({ table: name, patch, id });
          const row = table(name).find((r) => r.id === id);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return q;
  }

  const client = {
    from: (name: string) => query(name),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: seed.claim, error: seed.claimError ?? null });
    },
  } as unknown as SupabaseClient;

  return { client, updates, rpcCalls };
}

const bodyHash = (body: string) => createHash("sha256").update(`\n${body}`).digest("hex");
const GOOD_BODY = "Hi Marco, thanks for the reply! The team works in Go and Postgres. Want a quick call Thursday?";

function baseMsg(over: Row = {}): Row {
  return {
    id: "m-1",
    workspace_id: "ws-1",
    spec_id: "spec-1",
    candidate_id: "cand-1",
    seat_id: "seat-1",
    channel: "WhatsApp",
    to_address: "33612345678",
    body: GOOD_BODY,
    status: "queued",
    scheduled_at: "2000-01-01T00:00:00Z",
    ...over,
  };
}
const LIVE_SEAT: Row = { id: "seat-1", provider: "WhatsApp Cloud", status: "active", mode: "live" };

// ---------------------------------------------------------------------------
// 1. No approval row → blocked, RPC never called
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({ outbound: [baseMsg()], approvals: [], seats: [LIVE_SEAT], claim: { allowed: true } });
  const stats = await dispatchDue(db.client, 10);
  ok("no-approval: blocked", stats.blocked === 1 && stats.sent === 0);
  ok("no-approval: claim never ran", db.rpcCalls.length === 0);
  ok("no-approval: reason recorded", JSON.stringify(db.updates.at(-1)?.patch).includes("no-approval"));
}

// ---------------------------------------------------------------------------
// 2. Approval hash mismatch (text changed after approval) → blocked
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash("different text") }],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("hash-mismatch: blocked", stats.blocked === 1);
  ok("hash-mismatch: claim never ran", db.rpcCalls.length === 0);
}

// ---------------------------------------------------------------------------
// 3. AI-tell body sneaks into queue → gate blocks at the wire
// ---------------------------------------------------------------------------
{
  const evil = "As an AI assistant, processing your request now.";
  const db = makeFakeDb({
    outbound: [baseMsg({ body: evil })],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(evil) }],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("gate: AI-tell blocked at wire even when approved", stats.blocked === 1);
  ok("gate: claim never ran", db.rpcCalls.length === 0);
}

// ---------------------------------------------------------------------------
// 4. Seat not live / wrong provider → blocked before claim
// ---------------------------------------------------------------------------
{
  const approvals = [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY) }];
  for (const seat of [
    { ...LIVE_SEAT, mode: "sandbox" },
    { ...LIVE_SEAT, status: "paused" },
    { ...LIVE_SEAT, provider: "Twilio SMS" },
  ]) {
    const db = makeFakeDb({ outbound: [baseMsg()], approvals: [...approvals.map((a) => ({ ...a }))], seats: [seat], claim: { allowed: true } });
    const stats = await dispatchDue(db.client, 10);
    ok(`seat-guard (${seat.mode}/${seat.status}/${seat.provider}): blocked`, stats.blocked === 1);
    ok(`seat-guard (${seat.mode}/${seat.status}/${seat.provider}): no claim`, db.rpcCalls.length === 0);
  }
}

// ---------------------------------------------------------------------------
// 5. Guardrail claim denies (suppression/cap/re-contact) → blocked with reason
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY) }],
    seats: [LIVE_SEAT],
    claim: { allowed: false, reason: "suppressed" },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("claim-deny: blocked", stats.blocked === 1);
  ok("claim-deny: reason surfaced", JSON.stringify(db.updates.at(-1)?.patch).includes("guardrail:suppressed"));
}

// ---------------------------------------------------------------------------
// 6. All guards pass, no WhatsApp creds in env → adapter dry-runs → failed
//    (never a silent fake-sent)
// ---------------------------------------------------------------------------
{
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY) }],
    seats: [LIVE_SEAT],
    claim: { allowed: true, ledger_id: "led-1" },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("dry-run creds: marked failed, not sent", stats.failed === 1 && stats.sent === 0);
  ok("dry-run creds: claim ran once", db.rpcCalls.length === 1);
  ok("dry-run creds: claim scoped to spec", db.rpcCalls[0]?.args.p_campaign_id === "spec-1");
}

// ---------------------------------------------------------------------------
// 7. Not-yet-due and non-queued messages are untouched
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [
      baseMsg({ id: "m-future", scheduled_at: "2999-01-01T00:00:00Z" }),
      baseMsg({ id: "m-sent", status: "sent" }),
      baseMsg({ id: "m-blocked", status: "blocked" }),
    ],
    approvals: [],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("due-filter: nothing processed", stats.processed === 0);
  ok("due-filter: no updates written", db.updates.length === 0);
}

// ---------------------------------------------------------------------------
// 8. Limit respected
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg({ id: "m-1" }), baseMsg({ id: "m-2" }), baseMsg({ id: "m-3" })],
    approvals: [],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 2);
  ok("limit: only 2 processed", stats.processed === 2);
}

console.log(`RESULT dispatch-outbound: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
