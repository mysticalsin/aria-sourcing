import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import * as dispatchModule from "../src/lib/dispatch-outbound";
import type { AgentSeat } from "../src/lib/types";
import {
  APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
  buildApprovedWhatsAppTemplateAudit,
} from "../src/lib/whatsapp-template-queue";

// send route now imports live LLM critics (server-only).
mock.module("server-only", { namedExports: {} });

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

const TEMPLATE_ID = "24a4b85a-8c82-48e6-b52d-4ba86a4c94e8";
const TEMPLATE_SENDER_ID = "9a58303a-0e78-4f80-ac55-ec40d43f2e65";
const ATTEMPT_ONE = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_TEMPLATE = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_RACE = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_META = {
  id: TEMPLATE_ID,
  senderId: TEMPLATE_SENDER_ID,
  metaName: "role_intro",
  language: "en_US",
  version: 1,
};
const EMPTY_TEMPLATE_AUDIT = buildApprovedWhatsAppTemplateAudit({
  template: TEMPLATE_META,
  parameterSchema: [],
  parameters: [],
});
if (!EMPTY_TEMPLATE_AUDIT) throw new Error("Template fixture must produce an audit payload");

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

function baseLinkedInMsg(over: Row = {}): Row {
  return baseMsg({
    channel: "LinkedIn",
    to_address: "https://www.linkedin.com/in/marco-rossi",
    subject: "Quick note",
    approval_message_id: "m-1",
    ...over,
  });
}

const LIVE_SEAT = {
  id: "seat-1",
  workspace_id: "ws-1",
  provider: "WhatsApp Cloud",
  status: "active",
  mode: "live",
} satisfies Pick<AgentSeat, "id" | "provider" | "status" | "mode"> & { workspace_id: string };
const LIVE_LINKEDIN_MANUAL_SEAT = {
  id: "seat-1",
  workspace_id: "ws-1",
  provider: "LinkedIn Assisted Manual",
  status: "active",
  mode: "live",
};
const LIVE_LINKEDIN_VENDOR_SEAT = {
  ...LIVE_LINKEDIN_MANUAL_SEAT,
  provider: "LinkedIn Vendor API",
};
const LIVE_WHATSAPP_CONTACT: Row = {
  workspace_id: "ws-1",
  recipient_e164: "33612345678",
  consent_status: "opted_in",
  recorded_at: "2026-01-01T00:00:00.000Z",
  last_inbound_at: new Date().toISOString(),
  expires_at: null,
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
// 4. WhatsApp requires a persisted opt-in before any seat, claim, or provider
// interaction. Missing consent is a hard block, not a review hint.
// ---------------------------------------------------------------------------
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  let transportCalls = 0;
  globalThis.fetch = (async () => {
    transportCalls++;
    return jsonResponse(200, { messages: [{ id: "wamid.must-not-send" }] });
  }) as typeof fetch;
  try {
    for (const [name, controls] of [
      ["kill switch", { workspace_id: "ws-1", kill_switch: true, sequences_enabled: true }],
      ["sequences disabled", { workspace_id: "ws-1", kill_switch: false, sequences_enabled: false }],
    ] as const) {
      transportCalls = 0;
      const db = makeFakeDb({
        outbound: [baseMsg()],
        approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
        seats: [LIVE_SEAT],
        controls: [controls],
        whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
        ledgers: [{ id: `led-${name}`, outbound_message_id: "m-1", status: "claimed" }],
        claim: { allowed: true, ledger_id: `led-${name}`, delivery_attempt_id: ATTEMPT_ONE },
      });
      const stats = await dispatchDue(db.client, 10);
      ok(`loop controls ${name}: no transport call`, transportCalls === 0);
      ok(`loop controls ${name}: no dispatch claim`, !db.rpcCalls.some((call) => call.fn === "claim_whatsapp_outbound"));
      ok(`loop controls ${name}: drains no terminal state`, stats.sent === 0 && stats.blocked === 0 && stats.failed === 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
}

{
  const db = makeFakeDb({
    outbound: [baseMsg({ type: "candidate_reply" })],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    controls: [LOOP_SENDS_ENABLED],
    whatsappContacts: [],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("WhatsApp consent: missing opt-in blocks", stats.blocked === 1);
  ok("WhatsApp consent: missing opt-in never claims", db.rpcCalls.length === 0);
  ok("WhatsApp consent: reason recorded", JSON.stringify(db.updates.at(-1)?.patch).includes("missing-opt-in"));
}

// A human-approved candidate reply can be blocked later by a transient policy
// state, such as a missing contact row during a temporary store outage. It
// must return to the existing explicit review flow, not keep an `approved`
// decision that the review RPC would refuse to revisit.
{
  const db = makeFakeDb({
    outbound: [baseMsg({ type: "candidate_reply", review_decision: "approved" })],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  const patch = db.updates.at(-1)?.patch;
  ok("transient WhatsApp block: remains blocked until a human re-reviews", stats.blocked === 1);
  ok(
    "transient WhatsApp block: clears the stale approval review decision",
    patch?.review_decision === null && patch.reviewed_at === null && patch.reviewed_by === null,
  );
}

// ---------------------------------------------------------------------------
// 5. Approved-template delivery requires an ARIA catalog record, not merely a
// syntactically plausible name supplied by a caller. The content stays queued
// until the trusted row is present and Meta has approved that exact locale.
// ---------------------------------------------------------------------------
{
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const db = makeFakeDb({
    outbound: [
      baseMsg({
        type: "approved_template",
        template_id: TEMPLATE_ID,
        template_parameters: [],
        subject: APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
        body: EMPTY_TEMPLATE_AUDIT.body,
      }),
    ],
    approvals: [
      {
        workspace_id: "ws-1",
        message_id: "m-1",
        body_hash: bodyHash(EMPTY_TEMPLATE_AUDIT.body, APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT),
        approval_source: "human",
      },
    ],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    whatsappTemplates: [
      {
        id: TEMPLATE_ID,
        workspace_id: "ws-1",
        sender_id: TEMPLATE_SENDER_ID,
        meta_name: "role_intro",
        language: "en_US",
        version: 1,
        status: "approved",
        parameter_schema: [],
        body_parameter_count: 0,
      },
    ],
    ledgers: [{ id: "led-template", outbound_message_id: "m-1", status: "claimed" }],
    claim: { allowed: true, ledger_id: "led-template", delivery_attempt_id: ATTEMPT_TEMPLATE },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("WhatsApp template: trusted catalog entry reaches the atomic claim", db.rpcCalls.some((c) => c.fn === "claim_whatsapp_outbound"));
  ok("WhatsApp template: no provider credentials is unconfigured, not failed", stats.unconfigured === 1 && stats.failed === 0 && stats.sent === 0);
}

// ---------------------------------------------------------------------------
// 6. A direct authenticated outbox insert cannot pair arbitrary free-form text
// or changed template parameters with an otherwise valid approval. The
// dispatcher rebuilds the canonical template audit before the atomic claim.
// ---------------------------------------------------------------------------
{
  const parameterTemplate = {
    id: TEMPLATE_ID,
    senderId: TEMPLATE_SENDER_ID,
    metaName: "role_intro",
    language: "en_US",
    version: 1,
  };
  const originalAudit = buildApprovedWhatsAppTemplateAudit({
    template: parameterTemplate,
    parameterSchema: [{ name: "first_name", maxLength: 80 }],
    parameters: ["Amélie"],
  });
  if (!originalAudit) throw new Error("Parameterized template fixture must produce an audit payload");
  const db = makeFakeDb({
    outbound: [
      baseMsg({
        type: "approved_template",
        template_id: TEMPLATE_ID,
        template_parameters: ["Mallory"],
        subject: APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
        body: originalAudit.body,
      }),
    ],
    approvals: [
      {
        workspace_id: "ws-1",
        message_id: "m-1",
        body_hash: bodyHash(originalAudit.body, APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT),
        approval_source: "human",
      },
    ],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    whatsappTemplates: [
      {
        id: TEMPLATE_ID,
        workspace_id: "ws-1",
        sender_id: TEMPLATE_SENDER_ID,
        meta_name: "role_intro",
        language: "en_US",
        version: 1,
        status: "approved",
        parameter_schema: [{ name: "first_name", max_length: 80 }],
        body_parameter_count: 1,
      },
    ],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("template mutation: changed parameters block before claim", stats.blocked === 1 && db.rpcCalls.length === 0);
  ok("template mutation: audit mismatch is retained", JSON.stringify(db.updates.at(-1)?.patch).includes("template-audit-mismatch"));
}

{
  const db = makeFakeDb({
    outbound: [
      baseMsg({
        type: "approved_template",
        template_id: TEMPLATE_ID,
        template_parameters: [],
        subject: APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
        body: "An arbitrary direct insert, not a canonical Meta template audit.",
      }),
    ],
    approvals: [
      {
        workspace_id: "ws-1",
        message_id: "m-1",
        body_hash: bodyHash("An arbitrary direct insert, not a canonical Meta template audit.", APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT),
        approval_source: "human",
      },
    ],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    whatsappTemplates: [
      {
        id: TEMPLATE_ID,
        workspace_id: "ws-1",
        sender_id: TEMPLATE_SENDER_ID,
        meta_name: "role_intro",
        language: "en_US",
        version: 1,
        status: "approved",
        parameter_schema: [],
        body_parameter_count: 0,
      },
    ],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("direct template insert: arbitrary body cannot reach the claim", stats.blocked === 1 && db.rpcCalls.length === 0);
}

// ---------------------------------------------------------------------------
// 7. The cache preserves the content-gate verdict for audit and repeat-block
// analysis, but a cache write failure fails closed before a ledger claim.
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: true },
    cacheError: { message: "cache unavailable" },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("WhatsApp gate cache: cache write is attempted", db.cacheWrites.length === 1);
  ok("WhatsApp gate cache: storage error blocks before claim", stats.blocked === 1 && db.rpcCalls.length === 0);
  ok("WhatsApp gate cache: failure reason is retained", JSON.stringify(db.updates.at(-1)?.patch).includes("gate-cache-write-failed"));
}

// ---------------------------------------------------------------------------
// 7. Seat not live / wrong provider → blocked before claim
// ---------------------------------------------------------------------------
{
  const approvals = [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }];
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
// 8. Guardrail claim denies (suppression/cap/re-contact) → blocked with reason
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: false, reason: "suppressed" },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("claim-deny: blocked", stats.blocked === 1);
  ok("claim-deny: reason surfaced", JSON.stringify(db.updates.at(-1)?.patch).includes("guardrail:suppressed"));
}

// A second worker can select the same queued row before the first worker's
// atomic claim changes it to dispatching. The losing `not-queued` claim must be
// a no-op; writing blocked would corrupt the winner's accepted send.
{
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: false, reason: "not-queued" },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("losing claim: does not count the winner's row as blocked", stats.blocked === 0 && stats.failed === 0);
  ok("losing claim: performs no terminal outbox update", !db.updates.some((update) => update.table === "messages_outbound"));
}

// The claim response is the worker's ownership token. Contract drift must
// fail closed before Meta is called because no later transition could prove
// which worker owns the external send.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return jsonResponse(200, { messages: [{ id: "wamid.must-not-send" }] });
  }) as typeof fetch;
  try {
    const db = makeFakeDb({
      outbound: [baseMsg()],
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      ledgers: [{ id: "led-1", outbound_message_id: "m-1", status: "claimed" }],
      claim: { allowed: true, ledger_id: "led-1" },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("missing attempt: fails the worker", stats.failed === 1 && stats.sent === 0);
    ok("missing attempt: provider is never called", providerCalls === 0);
    ok("missing attempt: does not guess a terminal state", !db.updates.some((update) => update.table === "messages_outbound"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
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
  ok("legacy approval: reason recorded", JSON.stringify(db.updates.at(-1)?.patch).includes("approval-not-authorized"));
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
// 13. All guards pass, no WhatsApp creds in env → adapter dry-runs → unconfigured
//    (never a silent fake-sent)
// ---------------------------------------------------------------------------
{
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const db = makeFakeDb({
    outbound: [baseMsg()],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    ledgers: [{ id: "led-1", outbound_message_id: "m-1", status: "claimed" }],
    claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("dry-run creds: marked unconfigured, not failed or sent", stats.unconfigured === 1 && stats.failed === 0 && stats.sent === 0);
  ok("dry-run creds: claim ran once", db.rpcCalls.filter((call) => call.fn === "claim_whatsapp_outbound").length === 1);
  ok("dry-run creds: claim is the service-only WhatsApp RPC", db.rpcCalls[0]?.fn === "claim_whatsapp_outbound");
  ok("dry-run creds: claim is scoped to the queued message", db.rpcCalls[0]?.args.p_message_id === "m-1");
  ok("dry-run creds: gate verdict recorded in cache", db.cacheWrites.length === 1 && db.cacheWrites[0]?.verdict === "pass");
}

// A provider rejection is proven not-sent and may release the ledger only
// through the attempt-keyed transaction that also finalizes the outbox.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  globalThis.fetch = (async () => jsonResponse(401, {})) as typeof fetch;
  try {
    const outbound = [baseMsg()];
    const ledgers = [{ id: "led-1", outbound_message_id: "m-1", status: "claimed" }];
    const db = makeFakeDb({
      outbound,
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      ledgers,
      claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("provider rejection: finalized as one failed attempt", stats.failed === 1 && outbound[0]?.status === "failed");
    ok("provider rejection: attempt transaction releases the claimed ledger", ledgers[0]?.status === "skipped");
    ok(
      "provider rejection: uses the attempt-keyed failure RPC",
      db.rpcCalls.some((call) => call.fn === "finalize_whatsapp_provider_failure" && call.args.p_delivery_attempt_id === ATTEMPT_ONE),
    );
    ok("provider rejection: no generic ledger update", !db.updates.some((update) => update.table === "outreach_ledger"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
}

// A network exception can happen after Meta accepted the request. Without a
// provider message id, the only safe state is dispatching + claimed until a
// delivery event or operator reconciliation resolves it.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  globalThis.fetch = (async () => { throw new Error("connection reset after upload"); }) as typeof fetch;
  try {
    const outbound = [baseMsg()];
    const ledgers = [{ id: "led-1", outbound_message_id: "m-1", status: "claimed" }];
    const db = makeFakeDb({
      outbound,
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      ledgers,
      claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("ambiguous provider result: reported for recovery", stats.failed === 1 && stats.sent === 0);
    ok("ambiguous provider result: outbox remains dispatching", outbound[0]?.status === "dispatching");
    ok("ambiguous provider result: ledger remains claimed", ledgers[0]?.status === "claimed");
    ok("ambiguous provider result: no terminal failure RPC", !db.rpcCalls.some((call) => call.fn === "finalize_whatsapp_provider_failure"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
}

// A Meta 5xx response has the same ambiguous boundary: the service may have
// processed the request before its response path failed.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  globalThis.fetch = (async () => jsonResponse(503, {})) as typeof fetch;
  try {
    const outbound = [baseMsg()];
    const ledgers = [{ id: "led-1", outbound_message_id: "m-1", status: "claimed" }];
    const db = makeFakeDb({
      outbound,
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      ledgers,
      claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("provider 5xx: reported for recovery", stats.failed === 1 && stats.sent === 0);
    ok("provider 5xx: outbox remains dispatching", outbound[0]?.status === "dispatching");
    ok("provider 5xx: ledger remains claimed", ledgers[0]?.status === "claimed");
    ok("provider 5xx: no terminal failure RPC", !db.rpcCalls.some((call) => call.fn === "finalize_whatsapp_provider_failure"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
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
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("revoked approval: blocks before claim", stats.blocked === 1 && db.rpcCalls.length === 0);
  ok("revoked approval: records a specific reason", JSON.stringify(db.updates.at(-1)?.patch).includes("approval-revoked"));
}

// ---------------------------------------------------------------------------
// 11. Meta acceptance is reconciled by the service-only RPC before a message
// is marked sent. The dispatcher must never write a generic sent state that
// loses the Meta message id or races the ledger update.
// ---------------------------------------------------------------------------
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  globalThis.fetch = (async () => jsonResponse(200, { messages: [{ id: "wamid.accepted" }] })) as typeof fetch;
  try {
    const db = makeFakeDb({
      outbound: [baseMsg()],
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
      acceptance: { allowed: true, reason: "recorded" },
    });
    const stats = await dispatchDue(db.client, 10);
    const acceptance = db.rpcCalls.find((call) => call.fn === "record_whatsapp_provider_acceptance");
    ok("provider acceptance: counts only a reconciled Meta send", stats.sent === 1 && stats.failed === 0);
    ok("provider acceptance: persists the outbox id", acceptance?.args.p_message_id === "m-1");
    ok("provider acceptance: persists the delivery attempt", acceptance?.args.p_delivery_attempt_id === ATTEMPT_ONE);
    ok("provider acceptance: persists Meta's message id", acceptance?.args.p_provider_message_id === "wamid.accepted");
    ok("provider acceptance: does not generic-update outbox to sent", !db.updates.some((u) => u.table === "messages_outbound" && u.patch.status === "sent"));
    ok("provider acceptance: does not generic-update claimed ledger", !db.updates.some((u) => u.table === "outreach_ledger" && u.patch.status === "sent"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
}

// A provider acceptance response that cannot be atomically persisted stays
// dispatching for manual reconciliation. Retrying it could double-send.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  globalThis.fetch = (async () => jsonResponse(200, { messages: [{ id: "wamid.ambiguous" }] })) as typeof fetch;
  try {
    const db = makeFakeDb({
      outbound: [baseMsg()],
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      claim: { allowed: true, ledger_id: "led-1", delivery_attempt_id: ATTEMPT_ONE },
      acceptance: { allowed: false, reason: "attempt-mismatch" },
    });
    const stats = await dispatchDue(db.client, 10);
    ok("provider acceptance failure: requires manual reconciliation", stats.failed === 1 && stats.sent === 0);
    ok("provider acceptance failure: does not change dispatching outbox to failed", !db.updates.some((u) => u.table === "messages_outbound" && u.patch.status === "failed"));
    ok("provider acceptance failure: does not free the claimed ledger", !db.updates.some((u) => u.table === "outreach_ledger"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
}

// Two cron/webhook workers can read the same queued row before either claim
// completes. The database claim is the ownership boundary: exactly one worker
// may call Meta, and the loser must leave the winner's terminal state alone.
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.WHATSAPP_TOKEN;
  const originalPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "sender-1";
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return jsonResponse(200, { messages: [{ id: "wamid.concurrent" }] });
  }) as typeof fetch;
  try {
    const outbound = [baseMsg()];
    const db = makeFakeDb({
      outbound,
      approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
      seats: [LIVE_SEAT],
      whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
      claim: { allowed: true, ledger_id: "led-race", delivery_attempt_id: ATTEMPT_RACE },
      acceptance: { allowed: true, reason: "recorded" },
      atomicClaim: true,
    });
    const [first, second] = await Promise.all([
      dispatchDue(db.client, 10),
      dispatchDue(db.client, 10),
    ]);
    ok("concurrent workers: exactly one provider call", providerCalls === 1);
    ok("concurrent workers: exactly one reconciled send", first.sent + second.sent === 1);
    ok("concurrent workers: loser does not report a block or failure", first.blocked + second.blocked + first.failed + second.failed === 0);
    ok("concurrent workers: accepted winner remains sent", outbound[0]?.status === "sent");
    ok(
      "concurrent workers: loser performs no corrupting terminal update",
      !db.updates.some((update) => update.table === "messages_outbound" && update.patch.status !== "sent"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = originalToken;
    if (originalPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhone;
  }
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

// ---------------------------------------------------------------------------
// 13. A deliberate WhatsApp send may dispatch only the outbox row it created.
// It must never drain another candidate's due message as a side effect.
// ---------------------------------------------------------------------------
{
  const db = makeFakeDb({
    outbound: [baseMsg({ id: "m-other" }), baseMsg({ id: "m-target" })],
    approvals: [
      { workspace_id: "ws-1", message_id: "m-other", body_hash: bodyHash(GOOD_BODY), approval_source: "human" },
      { workspace_id: "ws-1", message_id: "m-target", body_hash: bodyHash(GOOD_BODY), approval_source: "human" },
    ],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10, "m-target");
  ok("targeted dispatch: processes only the requested row", stats.processed === 1);
  ok("targeted dispatch: leaves other candidate untouched", !db.updates.some((u) => u.id === "m-other"));
}

// ---------------------------------------------------------------------------
// 14. The durable outbox ID is not the approval message ID. A human approval
// must follow the stored approval_message_id, otherwise every route-queued
// WhatsApp send is blocked before the service-only claim.
// ---------------------------------------------------------------------------
{
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const db = makeFakeDb({
    outbound: [baseMsg({ id: "outbox-1", approval_message_id: "approval-1" })],
    approvals: [{ workspace_id: "ws-1", message_id: "approval-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [LIVE_SEAT],
    whatsappContacts: [{ ...LIVE_WHATSAPP_CONTACT }],
    claim: { allowed: true },
  });
  const stats = await dispatchDue(db.client, 10);
  ok("outbox approval: distinct approval ID reaches the claim", db.rpcCalls.some((call) => call.fn === "claim_whatsapp_outbound"));
  ok("outbox approval: a valid distinct approval is not blocked", stats.blocked === 0);
}

// ---------------------------------------------------------------------------
// 15. SMS cannot reach a live provider until it has an equivalent consent,
// opt-out, suppression, and durable-outbox policy.
// ---------------------------------------------------------------------------
{
  const savedTwilio = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM,
  };
  const originalFetch = globalThis.fetch;
  process.env.TWILIO_ACCOUNT_SID = "AC_TEST";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_FROM = "+15005550006";
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return { ok: true, status: 201, json: async () => ({ sid: "SM-must-not-send" }) } as Response;
  }) as typeof fetch;
  const db = makeFakeDb({
    outbound: [baseMsg({ channel: "SMS", to_address: "+14155552671" })],
    approvals: [{ workspace_id: "ws-1", message_id: "m-1", body_hash: bodyHash(GOOD_BODY), approval_source: "human" }],
    seats: [{ ...LIVE_SEAT, provider: "Twilio SMS" }],
    claim: { allowed: true },
  });
  try {
    const stats = await dispatchDue(db.client, 10);
    ok("SMS policy: dispatcher blocks until the consent policy exists", stats.blocked === 1);
    ok("SMS policy: dispatcher never claims", db.rpcCalls.length === 0);
    ok("SMS policy: dispatcher never calls Twilio", providerCalls === 0);
    ok("SMS policy: reason is explicit", JSON.stringify(db.updates.at(-1)?.patch).includes("sms-disabled-pending-consent-policy"));
  } finally {
    globalThis.fetch = originalFetch;
    if (savedTwilio.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = savedTwilio.sid;
    if (savedTwilio.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = savedTwilio.token;
    if (savedTwilio.from === undefined) delete process.env.TWILIO_FROM;
    else process.env.TWILIO_FROM = savedTwilio.from;
  }
}

// The dormant SMS provider branch must use a fail-closed reconciliation rule
// before the channel can ever be enabled. Unknown acceptance holds the ledger
// slot; only a definitive rejection may release it.
type SmsOutcome = {
  status: "sent" | "dry-run" | "error";
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: string;
  detail: string;
  id?: string;
};
const resolveSmsLedgerStatus = (dispatchModule as unknown as {
  resolveSmsLedgerStatus?: (outcome: SmsOutcome) => "sent" | "skipped" | "ambiguous";
}).resolveSmsLedgerStatus;
ok("SMS reconciliation: a production resolver exists", typeof resolveSmsLedgerStatus === "function");
if (resolveSmsLedgerStatus) {
  ok(
    "SMS reconciliation: provider timeout stays non-retryable ambiguous",
    resolveSmsLedgerStatus({ status: "error", deliveryState: "unknown", provider: "Twilio SMS", detail: "timeout" }) === "ambiguous",
  );
  ok(
    "SMS reconciliation: accepted response without SID stays ambiguous",
    resolveSmsLedgerStatus({ status: "sent", deliveryState: "accepted", provider: "Twilio SMS", detail: "missing SID" }) === "ambiguous",
  );
  ok(
    "SMS reconciliation: definitive rejection alone releases the ledger",
    resolveSmsLedgerStatus({ status: "error", deliveryState: "not-sent", provider: "Twilio SMS", detail: "Twilio 400" }) === "skipped",
  );
  ok(
    "SMS reconciliation: accepted response with SID becomes sent",
    resolveSmsLedgerStatus({ status: "sent", deliveryState: "accepted", provider: "Twilio SMS", detail: "accepted", id: "SM123" }) === "sent",
  );
}

const dispatcherSource = readFileSync(new URL("../src/lib/dispatch-outbound.ts", import.meta.url), "utf8");
ok(
  "SMS reconciliation: dormant branch uses the fail-closed resolver",
  /const smsLedgerStatus = resolveSmsLedgerStatus\(outcome\)/.test(dispatcherSource),
);

// The public route rejects SMS before opening a database client or invoking any
// provider path. Exercise the response and pin the side-effect ordering.
{
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    throw new Error("SMS API guard must return before provider access");
  }) as typeof fetch;
  try {
    mock.module(
      new URL("../src/lib/outreach-quality-pipeline-live.ts", import.meta.url).href,
      {
        namedExports: {
          validateOutreachQualityLive: async (input: {
            subject: string;
            body: string;
            channel?: string;
          }) => {
            const { validateOutreachQuality } = await import("../src/lib/outreach-quality-pipeline");
            return validateOutreachQuality(input);
          },
        },
      },
    );
    const sendModule = await import("../src/app/api/outreach/send/route");
    const sendPost = ((sendModule as any).POST ?? (sendModule as any).default?.POST) as (req: NextRequest) => Promise<Response>;
    const response = await sendPost(new NextRequest("http://localhost/api/outreach/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seatId: "22222222-2222-4222-8222-222222222222",
        messageId: "message-sms-1",
        candidateId: "candidate-1",
        candidateEmail: "candidate@example.test",
        campaignId: "campaign-1",
        subject: "A role you may like",
        body: "Hello, are you open to hearing about a role?",
        channel: "SMS",
        phone: "+14155552671",
        confirmLive: true,
      }),
    }));
    const body = await response.json() as { status?: string };
    ok("SMS policy: public API returns manual-required 409", response.status === 409 && body.status === "manual-required");
    ok("SMS policy: public API performs zero provider calls", providerCalls === 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const sendRouteSource = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
const smsApiGuard = sendRouteSource.indexOf('if (channel === "SMS")');
const serverClientOpen = sendRouteSource.indexOf("const supabase = await getServerSupabase()", smsApiGuard);
const providerCall = sendRouteSource.indexOf("performEmailSend(", smsApiGuard);
ok(
  "SMS policy: API guard precedes database and provider side effects",
  smsApiGuard >= 0 && serverClientOpen > smsApiGuard && providerCall > smsApiGuard,
);

console.log(`RESULT dispatch-outbound: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
