import { createHash } from "node:crypto";

import { validateCanonicalGithubQueryForRoleBasis } from "./sourcing-query-policy.mjs";

const GITHUB_ORIGIN = "https://api.github.com";
const SEARCH_RESPONSE_BYTES = 128_000;
const PROFILE_RESPONSE_BYTES = 128_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 15_000;
const MAX_DEADLINE_MS = 45_000;
const MAX_RESULT_LIMIT = 3;
const USERNAME_RE = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function strictHeaderInteger(headers, name, maximum) {
  const raw = headers.get(name);
  if (raw === null || !/^\d{1,12}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function rateMetadata(headers) {
  const limit = strictHeaderInteger(headers, "x-ratelimit-limit", 1_000_000);
  const remaining = strictHeaderInteger(headers, "x-ratelimit-remaining", 1_000_000);
  const resetEpochSeconds = strictHeaderInteger(headers, "x-ratelimit-reset", 9_999_999_999);
  const resource = headers.get("x-ratelimit-resource");
  if (limit === null && remaining === null && resetEpochSeconds === null && resource === null) return undefined;
  return {
    ...(limit === null ? {} : { limit }),
    ...(remaining === null ? {} : { remaining }),
    ...(resetEpochSeconds === null ? {} : { resetEpochSeconds }),
    ...(resource && /^[a-z]{1,32}$/.test(resource) ? { resource } : {}),
  };
}

function retryAfterSeconds(headers, fallback = null) {
  const value = strictHeaderInteger(headers, "retry-after", 86_400);
  return value ?? fallback ?? undefined;
}

function requestIdHash(headers) {
  const value = headers.get("x-github-request-id");
  if (!value || value.length > 200 || CONTROL_RE.test(value)) return undefined;
  return sha256Text(value);
}

async function readBoundedBody(response, maximumBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared) || Number(declared) > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: "response_too_large" };
    }
  }
  if (!response.body) {
    const empty = new Uint8Array();
    return { ok: true, bytes: empty, sha256: sha256Bytes(empty), text: "" };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "response_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: "response_read_unknown" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "response_encoding_invalid" };
  }
  return { ok: true, bytes, sha256: sha256Bytes(bytes), text };
}

function responseFailureCode(stage, status) {
  if (status === 401) return { code: `${stage}_unauthorized`, retryable: false };
  if (status === 403 || status === 429) return { code: `${stage}_rate_limited`, retryable: true };
  if (status === 404) return { code: `${stage}_not_found`, retryable: false };
  if (status === 408 || status === 425 || status >= 500) {
    return { code: `${stage}_provider_error`, retryable: true };
  }
  return { code: `${stage}_request_rejected`, retryable: false };
}

function requestSignal(timeoutMs, externalSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

async function requestJson({
  url,
  endpointTemplate,
  stage,
  ordinal,
  providerPage,
  querySha256,
  maximumBytes,
  timeoutMs,
  fetcher,
  externalSignal,
  providerMode,
  authorizationHeader,
}) {
  const receiptBase = {
    provider: "github",
    providerMode,
    providerPage,
    ordinal,
    endpointTemplate,
    canonicalQuerySha256: querySha256,
  };
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "aria-sourcing-loop",
        ...(authorizationHeader === null ? {} : { authorization: authorizationHeader }),
      },
      signal: requestSignal(timeoutMs, externalSignal),
    });
  } catch {
    return {
      ok: false,
      code: `${stage}_transport_unknown`,
      retryable: true,
      receipt: {
        ...receiptBase,
        outcome: "transport_unknown",
        statusCode: null,
        responseBytes: 0,
        responseSha256: null,
      },
    };
  }

  const commonReceipt = {
    ...receiptBase,
    statusCode: response.status,
    ...(requestIdHash(response.headers) ? { requestIdSha256: requestIdHash(response.headers) } : {}),
    ...(rateMetadata(response.headers) ? { rateLimit: rateMetadata(response.headers) } : {}),
  };
  if (response.url !== url.href) {
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      code: `${stage}_response_url_mismatch`,
      retryable: false,
      receipt: {
        ...commonReceipt,
        outcome: "response_url_mismatch",
        responseBytes: 0,
        responseSha256: null,
      },
    };
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      code: `${stage}_redirect_rejected`,
      retryable: false,
      receipt: {
        ...commonReceipt,
        outcome: "redirect_rejected",
        responseBytes: 0,
        responseSha256: null,
      },
    };
  }

  const body = await readBoundedBody(response, maximumBytes);
  if (!body.ok) {
    return {
      ok: false,
      code: `${stage}_${body.code}`,
      retryable: body.code === "response_read_unknown",
      receipt: {
        ...commonReceipt,
        outcome: body.code,
        responseBytes: 0,
        responseSha256: null,
      },
    };
  }

  const receipt = {
    ...commonReceipt,
    outcome: response.ok ? "success" : `http_${response.status}`,
    responseBytes: body.bytes.byteLength,
    responseSha256: body.sha256,
    ...(response.status === 403 || response.status === 429
      ? { retryAfterSeconds: retryAfterSeconds(response.headers, 60) }
      : retryAfterSeconds(response.headers) === undefined
        ? {}
        : { retryAfterSeconds: retryAfterSeconds(response.headers) }),
  };
  if (!response.ok) {
    const failure = responseFailureCode(stage, response.status);
    return { ok: false, ...failure, receipt };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return { ok: false, code: `${stage}_content_type_invalid`, retryable: false, receipt };
  }
  try {
    return { ok: true, data: JSON.parse(body.text), rawSha256: body.sha256, receipt };
  } catch {
    return { ok: false, code: `${stage}_malformed_json`, retryable: false, receipt };
  }
}

function parseSearchPayload(value, resultLimit) {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    typeof value.incomplete_results !== "boolean" ||
    !Array.isArray(value.items) ||
    value.items.length > resultLimit ||
    value.items.length > value.total_count
  ) {
    return { ok: false };
  }
  if (value.incomplete_results) return { ok: false, incomplete: true };
  const seenIds = new Set();
  const seenLogins = new Set();
  const items = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0 ||
      typeof item.login !== "string" ||
      !USERNAME_RE.test(item.login) ||
      item.type !== "User" ||
      seenIds.has(item.id) ||
      seenLogins.has(item.login.toLowerCase())
    ) {
      return { ok: false };
    }
    seenIds.add(item.id);
    seenLogins.add(item.login.toLowerCase());
    items.push({ id: item.id, login: item.login });
  }
  return { ok: true, items };
}

function nullableObservedString(value, property, maximum) {
  if (!Object.hasOwn(value, property)) return { ok: false };
  const candidate = value[property];
  if (candidate === null) return { ok: true, value: null };
  if (typeof candidate !== "string" || candidate.length > maximum || CONTROL_RE.test(candidate)) {
    return { ok: false };
  }
  return { ok: true, value: candidate };
}

function canonicalGithubDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const canonical = new Date(timestamp).toISOString();
  return canonical === value.replace(/Z$/, ".000Z") ? canonical : null;
}

function parseProfilePayload(value, expected, rawSha256, relevance) {
  if (!isRecord(value)) return { ok: false };
  const name = nullableObservedString(value, "name", 255);
  const company = nullableObservedString(value, "company", 255);
  const location = nullableObservedString(value, "location", 255);
  const bio = nullableObservedString(value, "bio", 2_000);
  const accountCreatedAt = canonicalGithubDate(value.created_at);
  if (
    !name.ok ||
    !company.ok ||
    !location.ok ||
    !bio.ok ||
    !Number.isSafeInteger(value.id) ||
    value.id !== expected.id ||
    value.login !== expected.login ||
    value.html_url !== `https://github.com/${expected.login}` ||
    !Number.isSafeInteger(value.public_repos) ||
    value.public_repos < 0 ||
    value.public_repos > 10_000_000 ||
    !Number.isSafeInteger(value.followers) ||
    value.followers < 0 ||
    value.followers > 1_000_000_000 ||
    accountCreatedAt === null ||
    !SHA256_RE.test(rawSha256)
  ) {
    return { ok: false };
  }
  const observed = {
    externalId: String(value.id),
    login: value.login,
    displayName: name.value && name.value.trim() !== "" ? name.value : value.login,
    company: company.value,
    location: location.value,
    bio: bio.value,
    githubUrl: value.html_url,
    publicRepoCount: value.public_repos,
    followerCount: value.followers,
    accountCreatedAt,
    matchedLanguage: relevance.matchedLanguage,
    searchResultOrdinal: relevance.searchResultOrdinal,
    searchResponseSha256: relevance.searchResponseSha256,
  };
  return {
    ok: true,
    candidate: {
      ...observed,
      rawResponseSha256: rawSha256,
      normalizedPayloadSha256: sha256Text(JSON.stringify(observed)),
    },
  };
}

function remainingDeadline(startedAt, overallDeadlineMs, now) {
  return overallDeadlineMs - Math.max(0, now() - startedAt);
}

function notStartedReceipt(ordinal, endpointTemplate, providerPage, querySha256, providerMode, outcome) {
  return {
    provider: "github",
    providerMode,
    providerPage,
    ordinal,
    endpointTemplate,
    canonicalQuerySha256: querySha256,
    outcome,
    statusCode: null,
    responseBytes: 0,
    responseSha256: null,
  };
}

/**
 * Execute one deterministic, read-only GitHub search. There are no automatic
 * HTTP retries: the durable job lease is the retry boundary.
 */
export async function discoverGithubCandidates(options) {
  if (!isRecord(options) || !isRecord(options.credential)) {
    throw new TypeError("explicit GitHub credential mode is required");
  }
  const providerMode = options.credential.kind;
  let authorizationHeader = null;
  if (providerMode === "authenticated") {
    if (typeof options.credential.authorizationHeader !== "function") {
      throw new TypeError("authenticated GitHub credential is invalid");
    }
    authorizationHeader = options.credential.authorizationHeader();
    if (
      typeof authorizationHeader !== "string" ||
      !/^Bearer [^\s\u0000-\u001f\u007f]{20,512}$/.test(authorizationHeader)
    ) {
      throw new TypeError("authenticated GitHub credential is invalid");
    }
  } else if (providerMode !== "anonymous") {
    throw new TypeError("GitHub credential mode is invalid");
  }
  const resultLimit = boundedInteger(options.resultLimit, 1, MAX_RESULT_LIMIT, "resultLimit");
  const perCallTimeoutMs = boundedInteger(
    options.perCallTimeoutMs,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    "perCallTimeoutMs",
  );
  const overallDeadlineMs = boundedInteger(
    options.overallDeadlineMs,
    perCallTimeoutMs,
    MAX_DEADLINE_MS,
    "overallDeadlineMs",
  );
  if (typeof options.fetcher !== "function") throw new TypeError("fetcher is required");
  if (!validateCanonicalGithubQueryForRoleBasis(
    options.query,
    options.approvedRoleBasis,
    options.batchOrdinal,
  ).ok) {
    throw new TypeError("canonical query is not approved for the role basis");
  }

  const now = typeof options.now === "function" ? options.now : Date.now;
  const startedAt = now();
  const receipts = [];
  const searchUrl = new URL("/search/users", GITHUB_ORIGIN);
  searchUrl.searchParams.set("q", options.query.value);
  searchUrl.searchParams.set("per_page", String(resultLimit));
  searchUrl.searchParams.set("page", String(options.query.page));
  let remaining = remainingDeadline(startedAt, overallDeadlineMs, now);
  if (remaining <= 0) {
    receipts.push(notStartedReceipt(
      0,
      "/search/users",
      options.query.page,
      options.query.sha256,
      providerMode,
      "deadline_exceeded",
    ));
    return { ok: false, code: "overall_deadline_exceeded", retryable: true, receipts };
  }

  const search = await requestJson({
    url: searchUrl,
    endpointTemplate: "/search/users",
    stage: "search",
    ordinal: 0,
    providerPage: options.query.page,
    querySha256: options.query.sha256,
    maximumBytes: SEARCH_RESPONSE_BYTES,
    timeoutMs: Math.min(perCallTimeoutMs, remaining),
    fetcher: options.fetcher,
    externalSignal: options.signal,
    providerMode,
    authorizationHeader,
  });
  receipts.push(search.receipt);
  if (!search.ok) return { ok: false, code: search.code, retryable: search.retryable, receipts };

  const parsedSearch = parseSearchPayload(search.data, resultLimit);
  if (!parsedSearch.ok) {
    return {
      ok: false,
      code: parsedSearch.incomplete ? "search_incomplete" : "search_malformed_payload",
      retryable: true,
      receipts,
    };
  }
  if (parsedSearch.items.length === 0) {
    return { ok: true, candidates: [], receipts, profileFailures: 0 };
  }

  const matchedLanguage = options.query.value.match(/^language:([^ ]+) type:user$/)?.[1];
  if (!matchedLanguage || !SHA256_RE.test(search.rawSha256)) {
    return { ok: false, code: "search_relevance_evidence_invalid", retryable: false, receipts };
  }

  const candidates = [];
  let profileFailures = 0;
  for (const [profileIndex, item] of parsedSearch.items.entries()) {
    remaining = remainingDeadline(startedAt, overallDeadlineMs, now);
    if (remaining <= 0 || options.signal?.aborted) {
      receipts.push(notStartedReceipt(
        receipts.length,
        "/users/{login}",
        options.query.page,
        options.query.sha256,
        providerMode,
        "deadline_exceeded",
      ));
      return {
        ok: false,
        code: candidates.length === 0 ? "profile_interrupted_after_search" : "overall_deadline_exceeded",
        retryable: true,
        receipts,
      };
    }
    const profileUrl = new URL(`/users/${encodeURIComponent(item.login)}`, GITHUB_ORIGIN);
    const profile = await requestJson({
      url: profileUrl,
      endpointTemplate: "/users/{login}",
      stage: "profile",
      ordinal: receipts.length,
      providerPage: options.query.page,
      querySha256: options.query.sha256,
      maximumBytes: PROFILE_RESPONSE_BYTES,
      timeoutMs: Math.min(perCallTimeoutMs, remaining),
      fetcher: options.fetcher,
      externalSignal: options.signal,
      providerMode,
      authorizationHeader,
    });
    receipts.push(profile.receipt);
    const rate = profile.receipt.rateLimit;
    const coreBucketExhausted =
      rate?.resource === "core" &&
      rate.remaining === 0 &&
      profileIndex < parsedSearch.items.length - 1;
    if (!profile.ok) {
      if (profile.code === "profile_not_found" || profile.code === "profile_malformed_json") {
        profileFailures += 1;
        if (coreBucketExhausted) {
          return { ok: false, code: "profile_rate_limited", retryable: true, receipts };
        }
        continue;
      }
      return { ok: false, code: profile.code, retryable: profile.retryable, receipts };
    }
    const parsedProfile = parseProfilePayload(profile.data, item, profile.rawSha256, {
      matchedLanguage,
      searchResultOrdinal: profileIndex,
      searchResponseSha256: search.rawSha256,
    });
    if (!parsedProfile.ok) {
      profileFailures += 1;
    } else {
      candidates.push(parsedProfile.candidate);
    }
    if (coreBucketExhausted) {
      return { ok: false, code: "profile_rate_limited", retryable: true, receipts };
    }
  }

  if (candidates.length === 0 && parsedSearch.items.length > 0) {
    return { ok: false, code: "all_profiles_failed", retryable: true, receipts };
  }
  return { ok: true, candidates, receipts, profileFailures };
}
