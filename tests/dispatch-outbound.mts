import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as dispatchModule from "../src/lib/dispatch-outbound";
import type { AgentSeat } from "../src/lib/types";

const { dispatchDue } = dispatchModule;

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFakeDb(seed: {
  outbound: Row[];
  approvals: Row[];
  seats: Row[];
  controls?: Row[];
  ledgers?: Row[];
  whatsappContacts?: Row[];
  whatsappTemplates?: Row[];
  cacheError?: { message: string } | null;
  claim: { allowed?: boolean; reason?: string; ledger_id?: string; delivery_attempt_id?: string; profile_url?: string } | null;
  claimError?: { message: string } | null;
  acceptance?: { allowed?: boolean; reason?: string } | null;
  acceptanceError?: { message: string } | null;
  atomicClaim?: boolean;
}) {
  const updates: { table: string; patch: Row; id: unknown }[] = [];
  const rpcCalls: { fn: string; args: Row }[] = [];
  const cacheWrites: Row[] = [];

  function table(name: string): Row[] {
    if (name === "messages_outbound") return seed.outbound;
    if (name === "outreach_approvals") return seed.approvals;
    if (name === "agent_seats") return seed.seats;
    if (name === "sourcing_loop_controls") {
      return seed.controls ?? [{ workspace_id: "ws-1", kill_switch: false, sequences_enabled: true }];
    }
    if (name === "outreach_ledger") return seed.ledgers ?? [];
    if (name === "whatsapp_contacts") return seed.whatsappContacts ?? [];
    if (name === "whatsapp_templates") return seed.whatsappTemplates ?? [];
    return [];
  }

  function query(name: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let pendingPatch: Row | null = null;
    const executeUpdate = () => {
      const row = table(name).filter((r) => filters.every((f) => f(r)))[0] ?? null;
      if (row && pendingPatch) {
        updates.push({ table: name, patch: pendingPatch, id: row.id });
        Object.assign(row, pendingPatch);
      }
      return { data: row ? { id: row.id } : null, error: null };
    };
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
        if (pendingPatch) return Promise.resolve(executeUpdate());
        const data = table(name).filter((r) => filters.every((f) => f(r)))[0] ?? null;
        return Promise.resolve({ data, error: null });
      },
      update: (patch: Row) => { pendingPatch = patch; return q; },
      upsert: (row: Row) => {
        if (name === "outbound_content_cache") cacheWrites.push(row);
        return Promise.resolve({ error: seed.cacheError ?? null });
      },
      then: <TResult1 = { data: { id: unknown } | null; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: { id: unknown } | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(executeUpdate()).then(onfulfilled, onrejected),
    };
    return q;
  }

  const client = {
    from: (name: string) => query(name),
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      if (fn === "record_whatsapp_provider_acceptance") {
        const acceptance = seed.acceptance ?? { allowed: true, reason: "recorded" };
        if (acceptance.allowed === true && !seed.acceptanceError) {
          const row = seed.outbound.find((item) => item.id === args.p_message_id);
          if (row && row.delivery_attempt_id === args.p_delivery_attempt_id) row.status = "sent";
          const ledger = (seed.ledgers ?? []).find((item) => item.outbound_message_id === args.p_message_id && item.status === "claimed");
          if (ledger) ledger.status = "sent";
        }
        return Promise.resolve({ data: acceptance, error: seed.acceptanceError ?? null });
      }
      if (fn === "finalize_whatsapp_provider_failure") {
        const row = seed.outbound.find((item) => item.id === args.p_message_id);
        const ledger = (seed.ledgers ?? []).find(
          (item) => item.outbound_message_id === args.p_message_id && item.status === "claimed",
        );
        if (!row || row.status !== "dispatching") {
          return Promise.resolve({ data: { allowed: false, reason: "not-dispatching" }, error: null });
        }
        if (row.delivery_attempt_id !== args.p_delivery_attempt_id) {
          return Promise.resolve({ data: { allowed: false, reason: "attempt-mismatch" }, error: null });
        }
        if (!ledger) return Promise.resolve({ data: { allowed: false, reason: "ledger-not-claimed" }, error: null });
        row.status = "failed";
        ledger.status = "skipped";
        ledger.reason = args.p_reason;
        return Promise.resolve({ data: { allowed: true, reason: "recorded" }, error: null });
      }
      if (fn === "record_linkedin_delivery_outcome") {
        const row = seed.outbound.find((item) => item.id === args.p_message_id);
        const ledger = (seed.ledgers ?? []).find(
          (item) => item.outbound_message_id === args.p_message_id && item.send_attempt_id === args.p_delivery_attempt_id && item.status === "claimed",
        );
        if (!row || row.status !== "dispatching") {
          return Promise.resolve({ data: { allowed: false, reason: "not-dispatching" }, error: null });
        }
        if (row.delivery_attempt_id !== args.p_delivery_attempt_id) {
          return Promise.resolve({ data: { allowed: false, reason: "attempt-mismatch" }, error: null });
        }
        if (!ledger) return Promise.resolve({ data: { allowed: false, reason: "ledger-not-claimed" }, error: null });
        row.status = args.p_outcome === "sent" ? "sent" : "failed";
        ledger.status = args.p_outcome;
        ledger.reason = args.p_reason;
        return Promise.resolve({ data: { allowed: true, reason: "recorded" }, error: null });
      }
      if (fn === "claim_linkedin_outbound_queued" && seed.claim?.allowed === true) {
        const row = seed.outbound.find((item) => item.id === args.p_message_id);
        if (row) {
          row.status = "dispatching";
          row.delivery_attempt_id = seed.claim.delivery_attempt_id ?? null;
        }
      }
      if (fn === "claim_whatsapp_outbound" && seed.atomicClaim) {
        const row = seed.outbound.find((item) => item.id === args.p_message_id);
        if (!row) return Promise.resolve({ data: { allowed: false, reason: "message-not-found" }, error: null });
        if (row.status !== "queued") return Promise.resolve({ data: { allowed: false, reason: "not-queued" }, error: null });
        row.status = "dispatching";
        row.delivery_attempt_id = seed.claim?.delivery_attempt_id ?? "44444444-4444-4444-8444-444444444444";
        return Promise.resolve({ data: seed.claim, error: seed.claimError ?? null });
      }
      if (fn === "claim_whatsapp_outbound" && seed.claim?.allowed === true) {
        const row = seed.outbound.find((item) => item.id === args.p_message_id);
        if (row) {
          row.status = "dispatching";
          row.delivery_attempt_id = seed.claim.delivery_attempt_id ?? null;
        }
      }
      return Promise.resolve({ data: seed.claim, error: seed.claimError ?? null });
    },
  } as unknown as SupabaseClient;

  return { client, updates, rpcCalls, cacheWrites, ledgers: seed.ledgers ?? [] };
}

const bodyHash = (body: string, subject = "") => createHash("sha256").update(`${subject}\n${body}`).digest("hex");
const GOOD_BODY = "Hi Marco, thanks for the reply! The team works in Go and Postgres. Want a quick call Thursday?";
const ATTEMPT_ONE = "11111111-1111-4111-8111-111111111111";


function baseMsg(over: Row = {}): Row {
  return {
    id: "m-1",
    workspace_id: "ws-1",
    spec_id: "spec-1",
    candidate_id: "cand-1",
    seat_id: "seat-1",
    channel: "LinkedIn",
    to_address: "https://www.linkedin.com/in/marco-rossi",
    body: GOOD_BODY,
    status: "queued",
    scheduled_at: "2000-01-01T00:00:00Z",
    ...over,
  };
}

function baseLinkedInMsg(over: Row = {}): Row {
  return baseMsg({
    subject: "Quick note",
    approval_message_id: "m-1",
    ...over,
  });
}

const LIVE_LINKEDIN_MANUAL_SEAT = {
  id: "seat-1",
  workspace_id: "ws-1",
  provider: "LinkedIn Assisted Manual",
  status: "active",
  mode: "live",
} satisfies Pick<AgentSeat, "id" | "provider" | "status" | "mode"> & { workspace_id: string };
const LIVE_SEAT = LIVE_LINKEDIN_MANUAL_SEAT;
const LIVE_LINKEDIN_VENDOR_SEAT = {
  ...LIVE_LINKEDIN_MANUAL_SEAT,
  provider: "LinkedIn Vendor API",
};

const LOOP_SENDS_ENABLED: Row = {
  workspace_id: "ws-1",
  kill_switch: false,
  sequences_enabled: true,
};

// ---------------------------------------------------------------------------
// 1. No approval row → blocked, RPC never called
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({ outbound: [baseMsg()], approvals: [], seats: [LIVE_SEAT], controls: [LOOP_SENDS_ENABLED], claim: { allowed: true } });
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
    controls: [LOOP_SENDS_ENABLED],
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
    controls: [LOOP_SENDS_ENABLED],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("gate: AI-tell blocked at wire even when approved", stats.blocked === 1);
  ok("gate: claim never ran", db.rpcCalls.length === 0);
}

// ---------------------------------------------------------------------------
// Legacy WhatsApp / SMS rows are refused before approval, claim, or provider.
// ---------------------------------------------------------------------------
for (const channel of ["WhatsApp", "SMS"]) {
  const db = makeFakeDb({
    outbound: [baseMsg({ channel, to_address: "33612345678" })],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    controls: [LOOP_SENDS_ENABLED],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok(`${channel} legacy row: blocked`, stats.blocked === 1 && stats.sent === 0);
  ok(`${channel} legacy row: no RPC claim`, db.rpcCalls.length === 0);
  ok(`${channel} legacy row: reason recorded`, JSON.stringify(db.updates.at(-1)?.patch).includes("channel-not-dispatchable"));
}

// ---------------------------------------------------------------------------
// 9. Legacy or system-generated approval cannot release an external message.
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "legacy_unverified" }],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("legacy approval: blocked", stats.blocked === 1 && stats.sent === 0);
  ok("legacy approval: claim never ran", db.rpcCalls.length === 0);
  ok("legacy approval: reason recorded", JSON.stringify(db.updates.at(-1)?.patch).includes("approval-not-human"));
}

// ---------------------------------------------------------------------------
// 10. LinkedIn without a recorded approval refuses before claim or transport.
// ---------------------------------------------------------------------------
{
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.LINKEDIN_VENDOR_API_URL;
  const originalKey = process.env.LINKEDIN_VENDOR_API_KEY;
  process.env.LINKEDIN_VENDOR_API_URL = "https://vendor.example.test/linkedin/send";
  process.env.LINKEDIN_VENDOR_API_KEY = "vendor-key";
  let transportCalls = 0;
  globalThis.fetch = (async () => {
    transportCalls++;
    return jsonResponse(200, { id: "li-must-not-send" });
  }) as typeof fetch;
  try {
    const db = makeFakeDb({
      outbound: [baseLinkedInMsg()],
      approvals: [],
      seats: [LIVE_LINKEDIN_VENDOR_SEAT],
      controls: [LOOP_SENDS_ENABLED],
      claim: {
        allowed: true,
        ledger_id: "li-ledger-must-not-exist",
        delivery_attempt_id: ATTEMPT_ONE,
        profile_url: "https://www.linkedin.com/in/marco-rossi",
      },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("LinkedIn no approval: blocked", stats.blocked === 1 && stats.sent === 0 && stats.failed === 0);
    ok("LinkedIn no approval: claim never runs", !db.rpcCalls.some((call) => call.fn === "claim_linkedin_outbound_queued"));
    ok("LinkedIn no approval: transport mock never invoked", transportCalls === 0);
    ok("LinkedIn no approval: no ledger row is written by the dispatcher", db.ledgers.length === 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.LINKEDIN_VENDOR_API_URL;
    else process.env.LINKEDIN_VENDOR_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.LINKEDIN_VENDOR_API_KEY;
    else process.env.LINKEDIN_VENDOR_API_KEY = originalKey;
  }
}

// ---------------------------------------------------------------------------
// 11. LinkedIn assisted-manual works through the adapter and records the
// outcome in the same durable ledger.
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseLinkedInMsg()],
    approvals: [
      {
        workspace_id: "ws-1",
        message_id: "m-1",
        body_hash: bodyHash(GOOD_BODY, "Quick note"),
        approval_source: "human",
      },
    ],
    seats: [LIVE_LINKEDIN_MANUAL_SEAT],
    controls: [LOOP_SENDS_ENABLED],
    ledgers: [{ id: "li-ledger-1", outbound_message_id: "m-1", send_attempt_id: ATTEMPT_ONE, status: "claimed" }],
    claim: {
      allowed: true,
      ledger_id: "li-ledger-1",
      delivery_attempt_id: ATTEMPT_ONE,
      profile_url: "https://www.linkedin.com/in/marco-rossi",
    },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("LinkedIn assisted-manual: sent is recorded", stats.sent === 1 && stats.failed === 0 && stats.blocked === 0);
  ok("LinkedIn assisted-manual: claim and outcome RPCs both run", db.rpcCalls.map((call) => call.fn).join("|") === "claim_linkedin_outbound_queued|record_linkedin_delivery_outcome");
  ok("LinkedIn assisted-manual: shared ledger reaches sent", db.ledgers[0]?.status === "sent");
}

// ---------------------------------------------------------------------------
// 12. LinkedIn vendor API is wired but dark without credentials. It fails
// closed before claim or transport, never falling back to assisted-manual.
// ---------------------------------------------------------------------------
{
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.LINKEDIN_VENDOR_API_URL;
  const originalKey = process.env.LINKEDIN_VENDOR_API_KEY;
  delete process.env.LINKEDIN_VENDOR_API_URL;
  delete process.env.LINKEDIN_VENDOR_API_KEY;
  let transportCalls = 0;
  globalThis.fetch = (async () => {
    transportCalls++;
    return jsonResponse(200, { id: "li-must-not-send" });
  }) as typeof fetch;
  try {
    const db = makeFakeDb({
      outbound: [baseLinkedInMsg()],
      approvals: [
        {
          workspace_id: "ws-1",
          message_id: "m-1",
          body_hash: bodyHash(GOOD_BODY, "Quick note"),
          approval_source: "human",
        },
      ],
      seats: [LIVE_LINKEDIN_VENDOR_SEAT],
      controls: [LOOP_SENDS_ENABLED],
      claim: {
        allowed: true,
        ledger_id: "li-ledger-vendor",
        delivery_attempt_id: ATTEMPT_ONE,
        profile_url: "https://www.linkedin.com/in/marco-rossi",
      },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("LinkedIn vendor dark: counted as unconfigured failure", stats.unconfigured === 1 && stats.sent === 0);
    ok("LinkedIn vendor dark: claim never runs", !db.rpcCalls.some((call) => call.fn === "claim_linkedin_outbound_queued"));
    ok("LinkedIn vendor dark: transport never invoked", transportCalls === 0);
    ok("LinkedIn vendor dark: reason proves no assisted-manual fallback", JSON.stringify(db.updates.at(-1)?.patch).includes("linkedin-provider-unconfigured"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.LINKEDIN_VENDOR_API_URL;
    else process.env.LINKEDIN_VENDOR_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.LINKEDIN_VENDOR_API_KEY;
    else process.env.LINKEDIN_VENDOR_API_KEY = originalKey;
  }
}

// ---------------------------------------------------------------------------
// A revoked approval is never eligible for a service-only dispatch, even when
// its old content hash and human provenance still match.
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human", revoked_at: "2026-07-09T00:00:00.000Z" }],
    seats: [LIVE_SEAT],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("revoked approval: blocks before claim", stats.blocked === 1 && db.rpcCalls.length === 0);
  ok("revoked approval: records a specific reason", JSON.stringify(db.updates.at(-1)?.patch).includes("approval-revoked"));
}

// ---------------------------------------------------------------------------
// 12. Not-yet-due and non-queued messages are untouched
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
// 12. Limit respected
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
