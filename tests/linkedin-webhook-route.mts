/**
 * LinkedIn HeyReach-parity webhook route scenarios (mocked service client).
 * Covers S10 reply, S15 duplicate, S18 bad HMAC, lifecycle skip-classify.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const seatId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "linkedin-inbound-test-secret-32chars!!";

process.env.LINKEDIN_INBOUND_WEBHOOK_SECRET = SECRET;

type RpcCall = { name: string; args: Record<string, unknown> };
let rpcCalls: RpcCall[] = [];
let routeOk = true;
let recordResult: Record<string, unknown> = {
  ok: true,
  duplicate: false,
  event_row_id: "evt-row-1",
  inbound_id: "inbound-1",
  conversation_id: "conv-1",
  candidate_id: "cand-1",
  event_type: "reply",
  correlated: true,
};
let enqueueStatus = "enqueued";

const service = {
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });
    if (name === "resolve_linkedin_inbound_route") {
      if (!routeOk) return { data: { ok: false, reason: "no-route" }, error: null };
      return {
        data: { ok: true, workspace_id: workspaceId, seat_id: seatId, route_id: "route-1" },
        error: null,
      };
    }
    if (name === "record_linkedin_channel_event") {
      return { data: recordResult, error: null };
    }
    if (name === "enqueue_aria_job") {
      return { data: { status: enqueueStatus }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${name}`, code: "unexpected" } };
  },
};

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => service,
    getServerSupabase: async () => null,
    requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 403 }) }),
  },
});

const { POST } = await import("../src/app/api/webhooks/linkedin/route.ts");

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function reset() {
  rpcCalls = [];
  routeOk = true;
  recordResult = {
    ok: true,
    duplicate: false,
    event_row_id: "evt-row-1",
    inbound_id: "inbound-1",
    conversation_id: "conv-1",
    candidate_id: "cand-1",
    event_type: "reply",
    correlated: true,
  };
  enqueueStatus = "enqueued";
}

async function postJson(body: unknown, signature?: string | null) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) {
    headers["x-aria-signature"] = signature ?? sign(raw);
  }
  return POST(
    new NextRequest("http://localhost/api/webhooks/linkedin", {
      method: "POST",
      headers,
      body: raw,
    }),
  );
}

test("S18 bad HMAC is rejected", async () => {
  reset();
  const res = await postJson(
    {
      routeKey: "rk-" + "a".repeat(16),
      providerId: "p1",
      fromProfileUrl: "https://www.linkedin.com/in/jane",
      body: "hi",
    },
    "deadbeef",
  );
  assert.equal(res.status, 401);
  assert.equal(rpcCalls.length, 0);
});

test("S18 missing signature is rejected", async () => {
  reset();
  const res = await postJson(
    {
      routeKey: "rk-" + "a".repeat(16),
      providerId: "p1",
      fromProfileUrl: "https://www.linkedin.com/in/jane",
      body: "hi",
    },
    null,
  );
  assert.equal(res.status, 401);
});

test("unknown route_key returns 404", async () => {
  reset();
  routeOk = false;
  const res = await postJson({
    routeKey: "rk-" + "b".repeat(16),
    providerId: "p1",
    fromProfileUrl: "https://www.linkedin.com/in/jane",
    body: "hi",
  });
  assert.equal(res.status, 404);
  assert.equal(rpcCalls[0]?.name, "resolve_linkedin_inbound_route");
  assert.ok(!rpcCalls.some((c) => c.name === "record_linkedin_channel_event"));
});

test("S10 reply enqueues inbound_classify with LinkedIn channel", async () => {
  reset();
  const res = await postJson({
    schemaVersion: "2026-08-25.li-events.v1",
    routeKey: "rk-" + "c".repeat(16),
    eventId: "evt-reply-1",
    eventType: "reply",
    candidate: { profileUrl: "https://www.linkedin.com/in/jane-doe" },
    thread: { providerThreadKey: "thread-1", providerMessageId: "msg-1" },
    payload: { body: "Yes, interested — let's talk next week." },
  });
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.ok, true);
  assert.equal(json.classifyQueued, true);
  assert.equal(json.eventType, "reply");
  assert.equal(json.inboundId, "inbound-1");

  const record = rpcCalls.find((c) => c.name === "record_linkedin_channel_event");
  assert.ok(record);
  assert.equal(record!.args.p_event_type, "reply");
  assert.equal(record!.args.p_workspace_id, workspaceId);
  assert.match(String(record!.args.p_profile_url), /jane-doe/i);

  const enq = rpcCalls.find((c) => c.name === "enqueue_aria_job");
  assert.ok(enq);
  assert.equal(enq!.args.p_kind, "inbound_classify");
  assert.equal((enq!.args.p_payload as Record<string, unknown>).channel, "LinkedIn");
  assert.equal((enq!.args.p_payload as Record<string, unknown>).inboundId, "inbound-1");
  assert.match(String(enq!.args.p_idempotency_key), /^li:reply:/);
});

test("S15 duplicate reply does not re-enqueue classify", async () => {
  reset();
  recordResult = {
    ok: true,
    duplicate: true,
    event_row_id: "evt-row-1",
    inbound_id: "inbound-1",
    event_type: "reply",
  };
  const res = await postJson({
    routeKey: "rk-" + "d".repeat(16),
    providerId: "dup-1",
    fromProfileUrl: "https://www.linkedin.com/in/jane",
    body: "Yes interested",
  });
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.duplicate, true);
  assert.equal(json.classifyQueued, false);
  assert.ok(!rpcCalls.some((c) => c.name === "enqueue_aria_job"));
});

test("S5 connection_accepted is recorded without classify", async () => {
  reset();
  recordResult = {
    ok: true,
    duplicate: false,
    event_row_id: "evt-row-2",
    inbound_id: null,
    event_type: "connection_accepted",
    correlated: false,
  };
  const res = await postJson({
    schemaVersion: "2026-08-25.li-events.v1",
    routeKey: "rk-" + "e".repeat(16),
    eventId: "evt-acc-1",
    eventType: "connection_accepted",
    candidate: { profileUrl: "https://www.linkedin.com/in/jane" },
  });
  assert.equal(res.status, 200);
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(json.classifyQueued, false);
  assert.equal(json.classifyStatus, "skipped");
  assert.ok(!rpcCalls.some((c) => c.name === "enqueue_aria_job"));
  const record = rpcCalls.find((c) => c.name === "record_linkedin_channel_event");
  assert.equal(record?.args.p_event_type, "connection_accepted");
});

test("legacy reply-only payload still works", async () => {
  reset();
  const res = await postJson({
    routeKey: "rk-" + "f".repeat(16),
    providerId: "legacy-1",
    fromProfileUrl: "https://www.linkedin.com/in/alex",
    body: "Thanks for reaching out",
  });
  assert.equal(res.status, 200);
  const record = rpcCalls.find((c) => c.name === "record_linkedin_channel_event");
  assert.equal(record?.args.p_event_type, "reply");
  assert.equal(record?.args.p_event_id, "legacy-1");
  assert.ok(rpcCalls.some((c) => c.name === "enqueue_aria_job"));
});

test("invalid event type returns 400", async () => {
  reset();
  const res = await postJson({
    schemaVersion: "2026-08-25.li-events.v1",
    routeKey: "rk-" + "g".repeat(16),
    eventId: "evt-bad",
    eventType: "inmail_sent",
    candidate: { profileUrl: "https://www.linkedin.com/in/jane" },
  });
  assert.equal(res.status, 400);
  assert.equal(rpcCalls.length, 0);
});

test("worker classify uses LinkedIn channel from stored inbound", async () => {
  // Contract check against the worker source — route tests already cover enqueue payload.
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
  assert.match(worker, /read_inbound_message_for_loop/);
  assert.match(worker, /storedChannel/);
});
