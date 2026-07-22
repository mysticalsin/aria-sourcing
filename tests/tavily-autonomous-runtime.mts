import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { executeAuthorizedTavilySearch } from "../scripts/sourcing-loop-handlers/tavily-discovery.mjs";

const SECRET = "tvly-production-secret-marker-123456789";
const QUERY = 'site:linkedin.com/in "vp finance" "sap"';
const QUERY_SHA256 = createHash("sha256")
  .update(
    `tavily-linkedin-deterministic-v1\n${QUERY}\nmax_results:5\ninclude_domains:linkedin.com\nsearch_depth:basic`,
    "utf8",
  )
  .digest("hex");
const REQUEST = Object.freeze({
  query: QUERY,
  search_depth: "basic",
  max_results: 5,
  include_domains: Object.freeze(["linkedin.com"]),
  include_answer: false,
  include_images: false,
});
const REQUEST_SHA256 = createHash("sha256")
  .update(
    "aria.autonomous-web-request.v1\n"
      + `{"query": "${QUERY.replaceAll('"', '\\"')}", "max_results": 5, "search_depth": "basic", "include_answer": false, "include_images": false, "include_domains": ["linkedin.com"]}`,
    "utf8",
  )
  .digest("hex");

function providerPayload() {
  return {
    query: QUERY,
    follow_up_questions: null,
    answer: null,
    images: [],
    results: [
      {
        title: "Ada Lovelace - VP Finance | LinkedIn",
        url: "https://linkedin.com/in/Ada-Lovelace/?trk=public_profile",
        content: "VP Finance leading SAP transformation.",
        score: 0.93,
        raw_content: null,
      },
    ],
    response_time: 0.21,
    usage: { credits: 1 },
    request_id: "123e4567-e89b-12d3-a456-426614174111",
  };
}

function response(value: unknown) {
  const raw = JSON.stringify(value);
  const result = new Response(raw, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(result, "url", { value: "https://api.tavily.com/search" });
  return { raw, result };
}

function options(fetcher: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    authority: {
      provider: "tavily",
      queryPolicyVersion: "tavily-linkedin-deterministic-v1",
      canonicalQuerySha256: QUERY_SHA256,
      requestSha256: REQUEST_SHA256,
      request: REQUEST,
    },
    credential: {
      kind: "workspace",
      authorizationHeader: () => `Bearer ${SECRET}`,
    },
    timeoutMs: 1_000,
    fetcher,
    ...overrides,
  };
}

test("executes exactly the database-authorized Tavily request and returns recordable evidence", async () => {
  const payload = providerPayload();
  const { raw, result: providerResponse } = response(payload);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await executeAuthorizedTavilySearch(options(async (input, init) => {
    requests.push({ url: String(input), init });
    return providerResponse;
  }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.tavily.com/search");
  assert.equal(requests[0].init?.redirect, "manual");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), REQUEST);
  assert.equal(
    new Headers(requests[0].init?.headers).get("authorization"),
    `Bearer ${SECRET}`,
  );
  assert.deepEqual(result.normalizedResults, [
    {
      url: "https://www.linkedin.com/in/ada-lovelace",
      title: "Ada Lovelace - VP Finance | LinkedIn",
      content: "VP Finance leading SAP transformation.",
      score: 0.93,
    },
  ]);
  assert.equal(
    result.rawResponseSha256,
    createHash("sha256").update(raw, "utf8").digest("hex"),
  );
  assert.equal(result.rawResponseBytes, Buffer.byteLength(raw, "utf8"));
  assert.deepEqual(result.providerReceipt, {
    provider: "tavily",
    providerRequestId: "123e4567-e89b-12d3-a456-426614174111",
    responseTimeMs: 210,
    resultCount: 1,
    querySha256: QUERY_SHA256,
    requestSha256: REQUEST_SHA256,
    rawResponseSha256: result.rawResponseSha256,
    rawResponseBytes: result.rawResponseBytes,
  });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("rejects any database authority hash or request drift before provider egress", async () => {
  for (const authority of [
    { ...options(async () => { throw new Error("must not fetch"); }).authority, requestSha256: "0".repeat(64) },
    { ...options(async () => { throw new Error("must not fetch"); }).authority, canonicalQuerySha256: "0".repeat(64) },
    { ...options(async () => { throw new Error("must not fetch"); }).authority, request: { ...REQUEST, max_results: 4 } },
    { ...options(async () => { throw new Error("must not fetch"); }).authority, request: { ...REQUEST, unexpected: true } },
  ]) {
    let calls = 0;
    await assert.rejects(
      executeAuthorizedTavilySearch(options(async () => {
        calls += 1;
        throw new Error("must not fetch");
      }, { authority })),
      /authorized Tavily request is invalid/,
    );
    assert.equal(calls, 0);
  }
});

test("marks transport uncertainty ambiguous without returning credential or provider body", async () => {
  const result = await executeAuthorizedTavilySearch(options(async () => {
    throw new Error(`unknown after send ${SECRET}`);
  }));
  assert.deepEqual(result, {
    ok: false,
    code: "search_transport_unknown",
    retryable: false,
    ambiguous: true,
  });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("rejects malformed results instead of inventing or silently truncating candidate facts", async () => {
  for (const resultValue of [
    {
      title: "Ada Lovelace - VP Finance | LinkedIn",
      url: "https://www.linkedin.com/in/ada_lovelace",
      content: "VP Finance leading SAP transformation.",
      score: 0.93,
      raw_content: null,
    },
    {
      title: "Ada Lovelace - VP Finance | LinkedIn",
      url: "https://www.linkedin.com/in/ada-lovelace",
      content: "x".repeat(4_001),
      score: 0.93,
      raw_content: null,
    },
    {
      title: "Ada Lovelace - VP Finance | LinkedIn",
      url: "https://www.linkedin.com/in/ada-lovelace",
      content: " \n\t ",
      score: 0.93,
      raw_content: null,
    },
  ]) {
    const payload = { ...providerPayload(), results: [resultValue] };
    const result = await executeAuthorizedTavilySearch(options(async () => response(payload).result));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "search_malformed_payload");
      assert.equal(result.ambiguous, false);
    }
  }
});
