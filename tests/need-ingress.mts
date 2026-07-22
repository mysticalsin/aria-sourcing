import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  checkNeedIngressPreAuthThrottle,
  handleNeedIngressRequest,
  needIngressSharedThrottleConfigured,
  needIngressSigningPayload,
  type NeedIngressRpcClient,
} from "../src/lib/needs/ingress";

const CREDENTIAL_KEY = `aria_need_v1_${"A".repeat(43)}`;
const OTHER_CREDENTIAL_KEY = `aria_need_v1_${"B".repeat(43)}`;
const KEY_SHA256 = createHash("sha256").update(CREDENTIAL_KEY, "utf8").digest("hex");
const NOW_MS = 1_800_000_000_000;
const TIMESTAMP = String(Math.floor(NOW_MS / 1_000));
const IDEMPOTENCY_KEY = "need:workday:20270115:000001";
const WORKSPACE_ID = "51111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "52222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "81111111-1111-4111-8111-111111111111";
const REQUISITION_ID = "61111111-1111-4111-8111-111111111111";
const JOB_ID = "71111111-1111-4111-8111-111111111111";

const payload = {
  need: {
    contentType: "text/plain",
    content:
      "We need a Senior Data Engineer, full-time and remote in Canada. Must have Python, SQL, and Airflow.",
  },
};

function signature(
  rawBody: string,
  timestamp = TIMESTAMP,
  idempotencyKey = IDEMPOTENCY_KEY,
  key = CREDENTIAL_KEY,
) {
  return `sha256=${createHmac("sha256", key)
    .update(needIngressSigningPayload(timestamp, idempotencyKey, rawBody), "utf8")
    .digest("hex")}`;
}

function signedRequest(
  rawBody = JSON.stringify(payload),
  overrides: Record<string, string | undefined> = {},
) {
  const timestamp = overrides.timestamp ?? TIMESTAMP;
  const idempotencyKey = overrides.idempotencyKey ?? IDEMPOTENCY_KEY;
  const credentialKey = overrides.credentialKey ?? CREDENTIAL_KEY;
  const headers = new Headers({
    "content-type": "application/json",
    "x-aria-need-key": credentialKey,
    "x-aria-need-timestamp": timestamp,
    "x-aria-need-signature":
      overrides.signature ?? signature(rawBody, timestamp, idempotencyKey, credentialKey),
    "idempotency-key": idempotencyKey,
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (["timestamp", "idempotencyKey", "credentialKey", "signature"].includes(name)) continue;
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return new NextRequest("http://localhost/api/webhooks/needs", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function dependencies(rpc: NeedIngressRpcClient["rpc"]) {
  return {
    now: () => NOW_MS,
    sharedThrottleConfigured: true,
    checkPreAuthThrottle: () => ({ ok: true, retryAfterSec: 0, remaining: 19 }),
    getServiceClient: () => ({ rpc }),
  };
}

function activeCredentialRpc(
  ingestData: unknown,
  ingestError: { message?: string; code?: string } | null = null,
  calls?: Array<{ name: string; params: Record<string, unknown> }>,
): NeedIngressRpcClient["rpc"] {
  return async (name, params) => {
    calls?.push({ name, params });
    if (name === "resolve_need_ingress_credential") {
      return {
        data: {
          status: "active",
          credential_id: CREDENTIAL_ID,
          workspace_id: WORKSPACE_ID,
        },
        error: null,
      };
    }
    assert.equal(name, "ingest_requisition_with_credential");
    return { data: ingestData, error: ingestError };
  };
}

test("a fresh signed need resolves its tenant and uses the credential-bound atomic RPC", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const response = await handleNeedIngressRequest(
    signedRequest(),
    dependencies(activeCredentialRpc({
      status: "accepted",
      requisition_id: REQUISITION_ID,
      job_id: JOB_ID,
      replay: false,
    }, null, calls)),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    requisitionId: REQUISITION_ID,
    jobId: JOB_ID,
    replay: false,
  });
  assert.deepEqual(calls, [
    {
      name: "resolve_need_ingress_credential",
      params: { p_key_sha256: KEY_SHA256 },
    },
    {
      name: "ingest_requisition_with_credential",
      params: {
        p_credential_id: CREDENTIAL_ID,
        p_key_sha256: KEY_SHA256,
        p_source_ref: IDEMPOTENCY_KEY,
        p_need_content: payload.need.content,
        p_content_type: payload.need.contentType,
      },
    },
  ]);
  assert.equal("p_workspace_id" in calls[1].params, false);
});

test("the pre-auth throttle blocks attacker-invented keys before service-client or database access", async () => {
  let serviceClientCalls = 0;
  const response = await handleNeedIngressRequest(
    signedRequest(undefined, { credentialKey: OTHER_CREDENTIAL_KEY }),
    {
      now: () => NOW_MS,
      sharedThrottleConfigured: true,
      checkPreAuthThrottle: () => ({ ok: false, retryAfterSec: 17, remaining: 0 }),
      getServiceClient: () => {
        serviceClientCalls += 1;
        throw new Error("service client must not be created for a throttled request");
      },
    },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "17");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "rate_limited" });
  assert.equal(serviceClientCalls, 0);
});

test("the local pre-auth throttle groups changing credential keys by trusted network identity", () => {
  const outcomes = Array.from({ length: 21 }, (_, index) => {
    const credentialKey = index % 2 === 0 ? CREDENTIAL_KEY : OTHER_CREDENTIAL_KEY;
    return checkNeedIngressPreAuthThrottle(new Request("http://localhost/api/webhooks/needs", {
      headers: {
        "fly-client-ip": "192.0.2.240",
        "x-real-ip": `198.51.100.${index + 1}`,
        "x-aria-need-key": credentialKey,
      },
    }), { FLY_APP_NAME: "aria-mantu-app" });
  });

  assert.equal(outcomes.slice(0, 20).every((outcome) => outcome.ok), true);
  assert.equal(outcomes[20]?.ok, false);
  assert.ok((outcomes[20]?.retryAfterSec ?? 0) >= 1);
});

test("production need ingress requires an exact shared-throttle attestation", () => {
  const evidenceSha256 = "a".repeat(64);
  assert.equal(needIngressSharedThrottleConfigured({ NODE_ENV: "development" }), true);
  assert.equal(needIngressSharedThrottleConfigured({ NODE_ENV: "production" }), false);
  assert.equal(needIngressSharedThrottleConfigured({
    NODE_ENV: "production",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "false",
  }), false);
  assert.equal(needIngressSharedThrottleConfigured({
    NODE_ENV: "production",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "true",
  }), false);
  assert.equal(needIngressSharedThrottleConfigured({
    NODE_ENV: "production",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "true",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: "not-a-digest",
  }), false);
  assert.equal(needIngressSharedThrottleConfigured({
    NODE_ENV: "production",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "true",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: evidenceSha256,
  }), true);
  assert.equal(needIngressSharedThrottleConfigured({
    NODE_ENV: "production",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "false",
    ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: evidenceSha256,
  }), false);
});

test("missing production shared-throttle authority blocks before service-client access", async () => {
  let serviceClientCalls = 0;
  const response = await handleNeedIngressRequest(signedRequest(), {
    now: () => NOW_MS,
    sharedThrottleConfigured: false,
    checkPreAuthThrottle: () => ({ ok: true, retryAfterSec: 0, remaining: 19 }),
    getServiceClient: () => {
      serviceClientCalls += 1;
      throw new Error("service client must not be created without shared throttle authority");
    },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, reason: "Need ingress is unavailable." });
  assert.equal(serviceClientCalls, 0);
});

test("an exact durable replay returns the original authority", async () => {
  const response = await handleNeedIngressRequest(
    signedRequest(),
    dependencies(activeCredentialRpc({
      status: "accepted",
      requisition_id: REQUISITION_ID,
      job_id: JOB_ID,
      replay: true,
    })),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    requisitionId: REQUISITION_ID,
    jobId: JOB_ID,
    replay: true,
  });
});

test("missing, malformed, stale, future, or tampered authentication never reaches the database", async () => {
  let calls = 0;
  const deps = dependencies(async () => {
    calls += 1;
    throw new Error("database must not be called");
  });
  const cases = [
    signedRequest(undefined, { "x-aria-need-key": undefined }),
    signedRequest(undefined, { credentialKey: "too-short" }),
    signedRequest(undefined, { "x-aria-need-signature": undefined }),
    signedRequest(undefined, { signature: "sha256=not-hex" }),
    signedRequest(undefined, { timestamp: String(Number(TIMESTAMP) - 301) }),
    signedRequest(undefined, { timestamp: String(Number(TIMESTAMP) + 31) }),
    signedRequest(undefined, { idempotencyKey: "short" }),
    signedRequest(JSON.stringify({ need: { ...payload.need, content: `${payload.need.content} changed` } }), {
      signature: signature(JSON.stringify(payload)),
    }),
    signedRequest(undefined, {
      idempotencyKey: "need:workday:20270115:changed",
      signature: signature(JSON.stringify(payload)),
    }),
    signedRequest(undefined, {
      credentialKey: OTHER_CREDENTIAL_KEY,
      signature: signature(JSON.stringify(payload)),
    }),
  ];

  for (const request of cases) {
    const response = await handleNeedIngressRequest(request, deps);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, reason: "Authentication failed." });
  }
  assert.equal(calls, 0);
});

test("the signed payload cannot choose or override a workspace", async () => {
  let calls = 0;
  const attemptedPayload = JSON.stringify({ workspaceId: OTHER_WORKSPACE_ID, ...payload });
  const response = await handleNeedIngressRequest(
    signedRequest(attemptedPayload),
    dependencies(async () => {
      calls += 1;
      throw new Error("database must not be called");
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, reason: "Invalid payload." });
  assert.equal(calls, 0);
});

test("oversized and invalid payloads fail before credential resolution", async () => {
  let calls = 0;
  const deps = dependencies(async () => {
    calls += 1;
    throw new Error("database must not be called");
  });

  const oversized = signedRequest("{}", { "content-length": "131073" });
  assert.equal((await handleNeedIngressRequest(oversized, deps)).status, 413);

  for (const invalid of [
    "not-json",
    JSON.stringify({ ...payload, extra: true }),
    JSON.stringify({ ...payload, need: { ...payload.need, content: "too short" } }),
    JSON.stringify({ ...payload, need: { ...payload.need, contentType: "text/html" } }),
    JSON.stringify({
      need: {
        contentType: "application/json",
        content: "this claims to be JSON but is not a JSON object",
      },
    }),
  ]) {
    const response = await handleNeedIngressRequest(signedRequest(invalid), deps);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, reason: "Invalid payload." });
  }
  assert.equal(calls, 0);
});

test("unknown, revoked, and expired keys are indistinguishable and never reach atomic ingress", async () => {
  for (const state of ["unknown", "revoked", "expired"]) {
    const calls: string[] = [];
    const response = await handleNeedIngressRequest(
      signedRequest(),
      dependencies(async (name) => {
        calls.push(name);
        assert.equal(name, "resolve_need_ingress_credential", state);
        return { data: { status: "not_found" }, error: null };
      }),
    );
    assert.equal(response.status, 401, state);
    assert.deepEqual(await response.json(), { ok: false, reason: "Authentication failed." });
    assert.deepEqual(calls, ["resolve_need_ingress_credential"]);
  }
});

test("revocation or expiry between resolution and ingest fails closed", async () => {
  const calls: string[] = [];
  const response = await handleNeedIngressRequest(
    signedRequest(),
    dependencies(async (name) => {
      calls.push(name);
      if (name === "resolve_need_ingress_credential") {
        return {
          data: { status: "active", credential_id: CREDENTIAL_ID, workspace_id: WORKSPACE_ID },
          error: null,
        };
      }
      return { data: { status: "credential_inactive" }, error: null };
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, reason: "Authentication failed." });
  assert.deepEqual(calls, [
    "resolve_need_ingress_credential",
    "ingest_requisition_with_credential",
  ]);
});

test("database controls and conflicts are typed while unknown failures remain retryable", async () => {
  const cases = [
    { data: { status: "intake_disabled" }, error: null, status: 423, reason: "Need intake is disabled." },
    { data: { status: "idempotency_conflict" }, error: null, status: 409, reason: "Idempotency key conflict." },
    { data: { status: "invalid_request" }, error: null, status: 400, reason: "Invalid request." },
    { data: { status: "inconsistent_state" }, error: null, status: 503, reason: "Need ingress could not be completed." },
    { data: null, error: { message: "private database detail", code: "XX000" }, status: 503, reason: "Need ingress could not be completed." },
    { data: { unexpected: true }, error: null, status: 503, reason: "Need ingress could not be completed." },
  ];

  for (const item of cases) {
    const response = await handleNeedIngressRequest(
      signedRequest(),
      dependencies(activeCredentialRpc(item.data, item.error)),
    );
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { ok: false, reason: item.reason });
  }
});

test("resolver failures remain retryable without leaking database details", async () => {
  for (const rpc of [
    async () => ({ data: null, error: { message: "private database detail" } }),
    async () => ({ data: { unexpected: true }, error: null }),
  ]) {
    const response = await handleNeedIngressRequest(signedRequest(), dependencies(rpc));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "Need ingress could not be completed.",
    });
  }
});

test("a missing service client is a retryable failure and never downgrades to demo mode", async () => {
  const response = await handleNeedIngressRequest(signedRequest(), {
    now: () => NOW_MS,
    sharedThrottleConfigured: true,
    checkPreAuthThrottle: () => ({ ok: true, retryAfterSec: 0, remaining: 19 }),
    getServiceClient: () => null,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: "Need ingress is unavailable." });
});

test("service-client configuration errors fail closed with the same retryable contract", async () => {
  const response = await handleNeedIngressRequest(signedRequest(), {
    now: () => NOW_MS,
    sharedThrottleConfigured: true,
    checkPreAuthThrottle: () => ({ ok: true, retryAfterSec: 0, remaining: 19 }),
    getServiceClient: () => {
      throw new Error("configuration detail must not escape");
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: "Need ingress is unavailable." });
});
