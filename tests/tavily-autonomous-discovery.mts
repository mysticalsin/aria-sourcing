import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  deriveDeterministicTavilyQuery,
  discoverTavilyCandidates,
} from "../scripts/sourcing-loop-handlers/tavily-discovery.mjs";

const SECRET = "tvly-production-secret-marker-123456789";
const ROLE_BASIS = Object.freeze({
  title: "principal backend engineer",
  skills: Object.freeze(["distributed systems", "go"]),
  region: "toronto",
});

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(
  value: unknown,
  url = "https://api.tavily.com/search",
  status = 200,
  headers: Record<string, string> = {},
) {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function payload(
  query: string,
  results: Array<Record<string, unknown>> = [
    {
      title: "Ada Lovelace - Principal Backend Engineer | LinkedIn",
      url: "https://linkedin.com/in/Ada-Lovelace/?trk=public_profile#about",
      content: "Principal backend engineer working on Go distributed systems.",
      score: 0.93,
      raw_content: null,
    },
  ],
) {
  return {
    query,
    follow_up_questions: null,
    answer: null,
    images: [],
    results,
    response_time: 0.21,
    usage: { credits: 1 },
    request_id: "123e4567-e89b-12d3-a456-426614174111",
  };
}

function options(fetcher: typeof fetch, overrides: Record<string, unknown> = {}) {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  return {
    approvedRoleBasis: ROLE_BASIS,
    query,
    credential: {
      kind: "workspace",
      authorizationHeader: () => `Bearer ${SECRET}`,
    },
    resultLimit: 3,
    timeoutMs: 1_000,
    fetcher,
    ...overrides,
  };
}

test("derives one canonical LinkedIn query and emits only observed, hash-bound candidates", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const responseValue = payload(query.value);
  const rawResponse = JSON.stringify(responseValue);
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse(responseValue);
  };

  const first = await discoverTavilyCandidates(options(fetcher));
  const second = await discoverTavilyCandidates(options(fetcher));

  assert.equal(query.policyVersion, "tavily-linkedin-deterministic-v1");
  assert.equal(
    query.value,
    'site:linkedin.com/in "principal backend engineer" "distributed systems" "go" "toronto"',
  );
  assert.equal(
    query.sha256,
    sha256(`tavily-linkedin-deterministic-v1\n${query.value}`),
  );
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) return;
  const candidates = first.candidates ?? [];
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.linkedinUrl, "https://www.linkedin.com/in/ada-lovelace");
  assert.equal(
    candidate.externalId,
    sha256("aria.tavily-linkedin-profile.v1\nhttps://www.linkedin.com/in/ada-lovelace"),
  );
  assert.equal(candidate.displayName, "Ada Lovelace - Principal Backend Engineer | LinkedIn");
  assert.equal(candidate.observedTitle, candidate.displayName);
  assert.equal(candidate.company, "");
  assert.equal(candidate.location, "");
  assert.deepEqual(candidate.matchedRoleEvidence, [
    "principal backend engineer",
    "distributed systems",
    "go",
  ]);
  assert.equal(candidate.rawResponseSha256, sha256(rawResponse));
  const { normalizedPayloadSha256, ...candidatePayload } = candidate;
  assert.equal(normalizedPayloadSha256, sha256(canonicalJson(candidatePayload)));
  assert.equal(first.receipts.length, 1);
  const { normalizedReceiptSha256, ...receiptPayload } = first.receipts[0];
  assert.equal(normalizedReceiptSha256, sha256(canonicalJson(receiptPayload)));
  assert.equal(receiptPayload.responseSha256, sha256(rawResponse));
  assert.equal(JSON.stringify(first).includes(SECRET), false);

  assert.equal(requests.length, 2);
  const request = requests[0];
  assert.equal(request.url, "https://api.tavily.com/search");
  assert.equal(request.init?.method, "POST");
  assert.equal(request.init?.redirect, "manual");
  assert.equal((request.init?.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
  assert.ok(request.init?.signal instanceof AbortSignal);
  const requestBody = JSON.parse(String(request.init?.body)) as Record<string, unknown>;
  assert.deepEqual(requestBody, {
    query: query.value,
    topic: "general",
    search_depth: "basic",
    max_results: 3,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_favicon: false,
    include_domains: ["linkedin.com"],
  });
  assert.equal(JSON.stringify(requestBody).includes(SECRET), false);
});

test("rejects redirects and any response URL other than the exact Tavily endpoint", async () => {
  const redirect = await discoverTavilyCandidates(options(async () => {
    return jsonResponse({}, "https://api.tavily.com/search", 302, { location: "https://evil.example" });
  }));
  assert.equal(redirect.ok, false);
  if (!redirect.ok) assert.equal(redirect.code, "search_redirect_rejected");

  const wrongUrl = await discoverTavilyCandidates(options(async () => {
    const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
    return jsonResponse(payload(query.value), "https://evil.example/search");
  }));
  assert.equal(wrongUrl.ok, false);
  if (!wrongUrl.ok) assert.equal(wrongUrl.code, "search_response_url_mismatch");
  assert.equal(JSON.stringify([redirect, wrongUrl]).includes("evil.example"), false);
});

test("rejects malformed JSON, unknown response fields, and oversized bodies", async () => {
  const malformed = await discoverTavilyCandidates(options(async () => {
    const response = new Response("{", { headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: "https://api.tavily.com/search" });
    return response;
  }));
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "search_malformed_json");
  assert.match(String(malformed.receipts[0]?.responseSha256), /^[0-9a-f]{64}$/);

  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const unknownField = await discoverTavilyCandidates(options(async () => {
    return jsonResponse({ ...payload(query.value), unexpected: true });
  }));
  assert.equal(unknownField.ok, false);
  if (!unknownField.ok) assert.equal(unknownField.code, "search_malformed_payload");

  const oversized = await discoverTavilyCandidates(options(async () => {
    return jsonResponse(payload(query.value), "https://api.tavily.com/search", 200, {
      "content-length": "300000",
    });
  }));
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.code, "search_response_too_large");
});

test("admits only canonical linkedin.com/in profile URLs and normalizes safe variants", async () => {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const rejectedUrls = [
    "http://www.linkedin.com/in/ada-lovelace",
    "https://evil.example/in/ada-lovelace",
    "https://linkedin.com.evil.example/in/ada-lovelace",
    "https://people.linkedin.com/in/ada-lovelace",
    "https://%77ww.linkedin.com/in/ada-lovelace",
    "https://user:pass@linkedin.com/in/ada-lovelace",
    "https://linkedin.com:444/in/ada-lovelace",
    "https://linkedin.com/in/ada-lovelace/extra",
    "https://linkedin.com/in/ada-lovelace%2Fevil",
    "https://linkedin.com/in/../company/evil",
  ];

  for (const url of rejectedUrls) {
    const result = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, [{
      title: "Ada Lovelace - Principal Backend Engineer | LinkedIn",
      url,
      content: "Principal backend engineer working on Go distributed systems.",
      score: 0.9,
      raw_content: null,
    }]))));
    assert.equal(result.ok, true, url);
    if (result.ok) assert.deepEqual(result.candidates, [], url);
    assert.equal(JSON.stringify(result).includes(url), false, url);
  }
});

test("never invents identity from a LinkedIn slug and rejects missing observed identity", async () => {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const result = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, [{
    title: "   ",
    url: "https://www.linkedin.com/in/definitely-not-a-name",
    content: "Principal backend engineer working on Go distributed systems.",
    score: 0.9,
    raw_content: null,
  }]))));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "search_malformed_payload");
  assert.equal(JSON.stringify(result).includes("definitely-not-a-name"), false);
});

test("filters observed profiles whose title and content do not contain bounded role evidence", async () => {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const result = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, [{
    title: "Grace Hopper - Chief Financial Officer | LinkedIn",
    url: "https://www.linkedin.com/in/grace-hopper",
    content: "Finance executive focused on treasury and accounting.",
    score: 0.95,
    raw_content: null,
  }]))));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.candidates, []);
  assert.equal(result.filteredResultCount, 1);

  const weakSingleTerm = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, [{
    title: "Grace Hopper - Engineering Leader | LinkedIn",
    url: "https://www.linkedin.com/in/grace-hopper",
    content: "I go where customer demand is strongest.",
    score: 0.95,
    raw_content: null,
  }]))));
  assert.equal(weakSingleTerm.ok, true);
  if (weakSingleTerm.ok) {
    assert.deepEqual(weakSingleTerm.candidates, []);
    assert.equal(weakSingleTerm.filteredResultCount, 1);
  }
});

test("returns an exact zero-candidate success when Tavily observes no results", async () => {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const result = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, []))));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.candidates, []);
  assert.equal(result.filteredResultCount, 0);
  assert.equal(result.receipts.length, 1);
});

test("uses an aborting timeout and never serializes credential-bearing failures", async () => {
  const result = await discoverTavilyCandidates(options(async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return await new Promise<Response>((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error("timeout guard did not observe abort")), 1_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(guard);
        reject(new Error(`timeout ${SECRET}`));
      }, { once: true });
    });
  }, { timeoutMs: 100 }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "search_transport_unknown");
  assert.equal(JSON.stringify(result).includes(SECRET), false);

  await assert.rejects(
    discoverTavilyCandidates(options(async () => jsonResponse({}), {
      credential: {
        kind: "workspace",
        authorizationHeader: () => {
          throw new Error(`credential unavailable: ${SECRET}`);
        },
      },
    })),
    /Tavily credential is invalid/,
  );
});

test("rejects provider credential echoes without returning the echoed body", async () => {
  const query = deriveDeterministicTavilyQuery(ROLE_BASIS);
  const result = await discoverTavilyCandidates(options(async () => jsonResponse(payload(query.value, [{
    title: `Ada Lovelace ${SECRET}`,
    url: "https://www.linkedin.com/in/ada-lovelace",
    content: "Principal backend engineer working on Go distributed systems.",
    score: 0.9,
    raw_content: null,
  }]))));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "search_credential_echo");
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});
