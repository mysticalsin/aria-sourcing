import { createHash } from "node:crypto";

export const TAVILY_LINKEDIN_QUERY_POLICY_VERSION = "tavily-linkedin-deterministic-v1";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_SEARCH_RESPONSE_BYTES = 256_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 15_000;
const MAX_RESULT_LIMIT = 5;
const MAX_QUERY_LENGTH = 500;
const MAX_ROLE_SKILLS = 16;
const MAX_ROLE_TERM_LENGTH = 100;
const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 4_000;
const MAX_URL_LENGTH = 2_048;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const LINKEDIN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,99}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const UNSAFE_CONTENT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const UNSAFE_ROLE_TEXT_RE = /(?:[\u0000-\u001f\u007f]|@|https?:\/\/|www\.|["\\])/i;
const ROLE_FIELDS = new Set([
  "employmentType",
  "locationType",
  "region",
  "seniority",
  "skills",
  "timezone",
  "title",
]);
const ROOT_RESPONSE_FIELDS = new Set([
  "answer",
  "auto_parameters",
  "follow_up_questions",
  "images",
  "query",
  "request_id",
  "response_time",
  "results",
  "usage",
]);
const RESULT_FIELDS = new Set([
  "content",
  "favicon",
  "images",
  "raw_content",
  "score",
  "title",
  "url",
]);
const AUTHORIZED_REQUEST_FIELDS = new Set([
  "include_answer",
  "include_domains",
  "include_images",
  "max_results",
  "query",
  "search_depth",
]);
const AUTHORITY_FIELDS = new Set([
  "canonicalQuerySha256",
  "provider",
  "queryPolicyVersion",
  "request",
  "requestSha256",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// PostgreSQL jsonb orders object keys by UTF-8 byte length, then by byte value,
// and emits a space after separators. 0060 hashes `request::text`, so the
// runtime mirrors that exact, deliberately narrow representation before it
// accepts database-returned provider authority.
function postgresJsonbText(value) {
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort((left, right) => {
      const leftBytes = Buffer.from(left, "utf8");
      const rightBytes = Buffer.from(right, "utf8");
      return leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes);
    });
    return `{${keys
      .map((key) => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}

function withNormalizedHash(value, property) {
  return {
    ...value,
    [property]: sha256Text(canonicalJson(value)),
  };
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function isCanonicalRoleText(value, minimum, maximum) {
  return Boolean(
    typeof value === "string" &&
      value.length >= minimum &&
      value.length <= maximum &&
      value === value.trim().toLowerCase() &&
      !UNSAFE_ROLE_TEXT_RE.test(value),
  );
}

function validateRoleBasis(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !ROLE_FIELDS.has(key))) {
    return false;
  }
  if (!isCanonicalRoleText(value.title, 2, 200)) return false;
  if (
    !Array.isArray(value.skills) ||
    value.skills.length < 1 ||
    value.skills.length > MAX_ROLE_SKILLS
  ) {
    return false;
  }
  const skills = [];
  for (const skill of value.skills) {
    if (!isCanonicalRoleText(skill, 1, MAX_ROLE_TERM_LENGTH)) return false;
    skills.push(skill);
  }
  const canonicalSkills = [...new Set(skills)].sort();
  if (
    canonicalSkills.length !== skills.length ||
    canonicalSkills.some((skill, index) => skill !== skills[index])
  ) {
    return false;
  }
  for (const field of ["employmentType", "locationType", "region", "seniority", "timezone"]) {
    if (Object.hasOwn(value, field) && !isCanonicalRoleText(value[field], 1, 200)) return false;
  }
  return true;
}

function uniqueInOrder(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/**
 * Build one finite provider query from server-owned canonical role evidence.
 * No caller-supplied search syntax enters the request.
 */
export function deriveDeterministicTavilyQuery(roleBasis) {
  if (!validateRoleBasis(roleBasis)) throw new TypeError("role basis is not canonical");
  const queryTerms = uniqueInOrder([
    roleBasis.title,
    ...roleBasis.skills.slice(0, 6),
    ...(Object.hasOwn(roleBasis, "region") ? [roleBasis.region] : []),
  ]);
  const value = `site:linkedin.com/in ${queryTerms.map((term) => `"${term}"`).join(" ")}`;
  if (value.length > MAX_QUERY_LENGTH) throw new TypeError("derived Tavily query is too long");
  return Object.freeze({
    policyVersion: TAVILY_LINKEDIN_QUERY_POLICY_VERSION,
    value,
    roleEvidence: Object.freeze(uniqueInOrder([roleBasis.title, ...roleBasis.skills])),
    sha256: sha256Text(`${TAVILY_LINKEDIN_QUERY_POLICY_VERSION}\n${value}`),
  });
}

function validateCanonicalQuery(query, roleBasis) {
  if (!isRecord(query) || Object.keys(query).length !== 4) return false;
  let expected;
  try {
    expected = deriveDeterministicTavilyQuery(roleBasis);
  } catch {
    return false;
  }
  return (
    query.policyVersion === expected.policyVersion &&
    query.value === expected.value &&
    query.sha256 === expected.sha256 &&
    Array.isArray(query.roleEvidence) &&
    query.roleEvidence.length === expected.roleEvidence.length &&
    query.roleEvidence.every((term, index) => term === expected.roleEvidence[index])
  );
}

function receipt(value) {
  const { normalizedReceiptSha256: _priorHash, ...payload } = value;
  return withNormalizedHash(payload, "normalizedReceiptSha256");
}

function receiptBase(querySha256) {
  return {
    provider: "tavily",
    providerMode: "workspace",
    ordinal: 0,
    endpointTemplate: "/search",
    canonicalQuerySha256: querySha256,
  };
}

function requestSignal(timeoutMs, externalSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
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
    const bytes = new Uint8Array();
    return { ok: true, bytes, text: "", sha256: sha256Bytes(bytes) };
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
  try {
    return {
      ok: true,
      bytes,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      sha256: sha256Bytes(bytes),
    };
  } catch {
    return { ok: false, code: "response_encoding_invalid" };
  }
}

function responseFailure(status) {
  if (status === 401 || status === 403) return { code: "search_unauthorized", retryable: false };
  if (status === 429) return { code: "search_rate_limited", retryable: true };
  if (status === 408 || status === 425 || status >= 500) {
    return { code: "search_provider_error", retryable: true };
  }
  return { code: "search_request_rejected", retryable: false };
}

function containsCredentialEcho(text, credential) {
  const encoded = encodeURIComponent(credential);
  const formEncoded = encoded.replace(/%20/gi, "+");
  const twiceEncoded = encodeURIComponent(encoded);
  return [credential, encoded, formEncoded, twiceEncoded]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .some((value) => text.includes(value));
}

async function requestSearch({
  query,
  resultLimit,
  timeoutMs,
  fetcher,
  signal,
  authorizationHeader,
  authorizedRequest,
}) {
  const base = receiptBase(query.sha256);
  const bodyValue = authorizedRequest ?? {
    query: query.value,
    topic: "general",
    search_depth: "basic",
    max_results: resultLimit,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_favicon: false,
    include_domains: ["linkedin.com"],
  };
  let response;
  try {
    response = await fetcher(TAVILY_SEARCH_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: authorizationHeader,
        "content-type": "application/json",
        "user-agent": "aria-sourcing-loop",
      },
      body: JSON.stringify(bodyValue),
      signal: requestSignal(timeoutMs, signal),
    });
  } catch {
    return {
      ok: false,
      code: "search_transport_unknown",
      retryable: true,
      receipt: receipt({
        ...base,
        outcome: "transport_unknown",
        statusCode: null,
        responseBytes: 0,
        responseSha256: null,
      }),
    };
  }

  const common = {
    ...base,
    statusCode: Number.isSafeInteger(response?.status) ? response.status : null,
  };
  if (response?.url !== TAVILY_SEARCH_URL) {
    await response?.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      code: "search_response_url_mismatch",
      retryable: false,
      receipt: receipt({
        ...common,
        outcome: "response_url_mismatch",
        responseBytes: 0,
        responseSha256: null,
      }),
    };
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      code: "search_redirect_rejected",
      retryable: false,
      receipt: receipt({
        ...common,
        outcome: "redirect_rejected",
        responseBytes: 0,
        responseSha256: null,
      }),
    };
  }

  const body = await readBoundedBody(response, TAVILY_SEARCH_RESPONSE_BYTES);
  if (!body.ok) {
    return {
      ok: false,
      code: `search_${body.code}`,
      retryable: body.code === "response_read_unknown",
      receipt: receipt({
        ...common,
        outcome: body.code,
        responseBytes: 0,
        responseSha256: null,
      }),
    };
  }

  const responseReceipt = {
    ...common,
    outcome: response.ok ? "success" : `http_${response.status}`,
    responseBytes: body.bytes.byteLength,
    responseSha256: body.sha256,
  };
  if (!response.ok) {
    return {
      ok: false,
      ...responseFailure(response.status),
      receipt: receipt(responseReceipt),
    };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return {
      ok: false,
      code: "search_content_type_invalid",
      retryable: false,
      receipt: receipt(responseReceipt),
    };
  }

  const credential = authorizationHeader.slice("Bearer ".length);
  if (containsCredentialEcho(body.text, credential)) {
    return {
      ok: false,
      code: "search_credential_echo",
      retryable: false,
      receipt: receipt({ ...responseReceipt, outcome: "credential_echo" }),
    };
  }
  try {
    return {
      ok: true,
      data: JSON.parse(body.text),
      rawResponseSha256: body.sha256,
      receipt: receipt(responseReceipt),
    };
  } catch {
    return {
      ok: false,
      code: "search_malformed_json",
      retryable: false,
      receipt: receipt({ ...responseReceipt, outcome: "malformed_json" }),
    };
  }
}

function exactKnownFields(value, allowed, required) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key));
}

function validResponseTime(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 3_600;
  return (
    typeof value === "string" &&
    /^\d{1,4}(?:\.\d{1,6})?$/.test(value) &&
    Number(value) <= 3_600
  );
}

function normalizeObservedText(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeEvidenceText(value) {
  return normalizeObservedText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function matchedRoleEvidence(title, content, roleEvidence) {
  const observed = ` ${normalizeEvidenceText(`${title} ${content}`)} `;
  return roleEvidence.filter((term) => {
    const normalized = normalizeEvidenceText(term);
    return normalized.length > 0 && observed.includes(` ${normalized} `);
  });
}

function canonicalLinkedInProfileUrl(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_URL_LENGTH ||
    CONTROL_RE.test(value) ||
    /\s/.test(value)
  ) {
    return null;
  }
  const rawMatch = value.match(/^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/);
  if (!rawMatch) return null;
  const authority = rawMatch[1];
  const rawPath = rawMatch[2] ?? "/";
  const normalizedAuthority = authority.toLowerCase();
  if (
    authority.includes("@") ||
    authority.includes(":") ||
    (normalizedAuthority !== "linkedin.com" && normalizedAuthority !== "www.linkedin.com")
  ) {
    return null;
  }
  if (rawPath.includes("%") || !/^\/in\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}\/?$/.test(rawPath)) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    (parsed.hostname !== "linkedin.com" && parsed.hostname !== "www.linkedin.com")
  ) {
    return null;
  }
  const pathMatch = rawPath.match(/^\/in\/([^/]+)\/?$/);
  const slug = pathMatch?.[1] ?? "";
  if (!LINKEDIN_SLUG_RE.test(slug)) return null;
  return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
}

function parseSearchPayload(value, query, resultLimit) {
  if (
    !exactKnownFields(
      value,
      ROOT_RESPONSE_FIELDS,
      ["images", "query", "request_id", "response_time", "results"],
    ) ||
    value.query !== query.value ||
    !Array.isArray(value.images) ||
    value.images.length !== 0 ||
    !Array.isArray(value.results) ||
    value.results.length > resultLimit ||
    !validResponseTime(value.response_time) ||
    typeof value.request_id !== "string" ||
    !SAFE_REQUEST_ID_RE.test(value.request_id) ||
    (Object.hasOwn(value, "answer") && value.answer !== null) ||
    (Object.hasOwn(value, "follow_up_questions") &&
      value.follow_up_questions !== null &&
      (!Array.isArray(value.follow_up_questions) || value.follow_up_questions.length !== 0)) ||
    Object.hasOwn(value, "auto_parameters") ||
    (Object.hasOwn(value, "usage") &&
      (!exactKnownFields(value.usage, new Set(["credits"]), ["credits"]) ||
        !Number.isSafeInteger(value.usage.credits) ||
        value.usage.credits < 0 ||
        value.usage.credits > 100))
  ) {
    return { ok: false };
  }

  const results = [];
  for (const entry of value.results) {
    if (
      !exactKnownFields(entry, RESULT_FIELDS, ["content", "score", "title", "url"]) ||
      typeof entry.title !== "string" ||
      entry.title.length > MAX_TITLE_LENGTH ||
      CONTROL_RE.test(entry.title) ||
      normalizeObservedText(entry.title).length === 0 ||
      typeof entry.content !== "string" ||
      entry.content.length > MAX_CONTENT_LENGTH ||
      UNSAFE_CONTENT_CONTROL_RE.test(entry.content) ||
      normalizeObservedText(entry.content).length === 0 ||
      typeof entry.url !== "string" ||
      entry.url.length < 1 ||
      entry.url.length > MAX_URL_LENGTH ||
      CONTROL_RE.test(entry.url) ||
      typeof entry.score !== "number" ||
      !Number.isFinite(entry.score) ||
      entry.score < 0 ||
      entry.score > 1 ||
      (Object.hasOwn(entry, "raw_content") && entry.raw_content !== null) ||
      (Object.hasOwn(entry, "favicon") && entry.favicon !== null) ||
      (Object.hasOwn(entry, "images") && (!Array.isArray(entry.images) || entry.images.length !== 0))
    ) {
      return { ok: false };
    }
    results.push({
      title: normalizeObservedText(entry.title),
      content: normalizeObservedText(entry.content),
      url: entry.url,
      score: entry.score,
    });
  }
  return { ok: true, requestId: value.request_id, results };
}

function normalizedCandidate(entry, canonicalUrl, query, rawResponseSha256, ordinal) {
  const matched = matchedRoleEvidence(entry.title, entry.content, query.roleEvidence);
  const observed = ` ${normalizeEvidenceText(`${entry.title} ${entry.content}`)} `;
  const exactRoleTitle = normalizeEvidenceText(query.roleEvidence[0] ?? "");
  const hasExactRoleTitle = exactRoleTitle.length > 0 && observed.includes(` ${exactRoleTitle} `);
  // One short skill can occur incidentally in a search snippet. Admit a
  // profile only when the exact role title is observed or two independently
  // derived role terms agree.
  if (!hasExactRoleTitle && matched.length < 2) return null;
  const value = {
    externalId: sha256Text(`aria.tavily-linkedin-profile.v1\n${canonicalUrl}`),
    displayName: entry.title,
    observedTitle: entry.title,
    observedContent: entry.content,
    company: "",
    location: "",
    linkedinUrl: canonicalUrl,
    providerScore: entry.score,
    searchResultOrdinal: ordinal,
    matchedRoleEvidence: matched,
    rawResponseSha256,
  };
  return withNormalizedHash(value, "normalizedPayloadSha256");
}

/**
 * Execute one authenticated Tavily search. The durable job is the retry
 * boundary, so this function makes exactly one provider request.
 */
export async function discoverTavilyCandidates(options) {
  if (!isRecord(options) || !isRecord(options.credential) || options.credential.kind !== "workspace") {
    throw new TypeError("explicit workspace Tavily credential is required");
  }
  if (typeof options.credential.authorizationHeader !== "function") {
    throw new TypeError("Tavily credential is invalid");
  }
  let authorizationHeader;
  try {
    authorizationHeader = options.credential.authorizationHeader();
  } catch {
    throw new TypeError("Tavily credential is invalid");
  }
  if (
    typeof authorizationHeader !== "string" ||
    !/^Bearer [^\s\u0000-\u001f\u007f]{20,512}$/.test(authorizationHeader)
  ) {
    throw new TypeError("Tavily credential is invalid");
  }
  if (!validateCanonicalQuery(options.query, options.approvedRoleBasis)) {
    throw new TypeError("canonical Tavily query is not approved for the role basis");
  }
  if (options.query.value.includes(authorizationHeader.slice("Bearer ".length))) {
    throw new TypeError("canonical Tavily query contains credential material");
  }
  const resultLimit = boundedInteger(options.resultLimit, 1, MAX_RESULT_LIMIT, "resultLimit");
  const timeoutMs = boundedInteger(options.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs");
  if (typeof options.fetcher !== "function") throw new TypeError("fetcher is required");

  const search = await requestSearch({
    query: options.query,
    resultLimit,
    timeoutMs,
    fetcher: options.fetcher,
    signal: options.signal,
    authorizationHeader,
  });
  if (!search.ok) {
    return {
      ok: false,
      code: search.code,
      retryable: search.retryable,
      receipts: [search.receipt],
    };
  }

  const parsed = parseSearchPayload(search.data, options.query, resultLimit);
  if (!parsed.ok || !SHA256_RE.test(search.rawResponseSha256)) {
    return {
      ok: false,
      code: "search_malformed_payload",
      retryable: false,
      receipts: [receipt({ ...search.receipt, outcome: "malformed_payload" })],
    };
  }

  const candidates = [];
  const seen = new Set();
  let filteredResultCount = 0;
  for (const [ordinal, entry] of parsed.results.entries()) {
    const canonicalUrl = canonicalLinkedInProfileUrl(entry.url);
    if (canonicalUrl === null || seen.has(canonicalUrl)) {
      filteredResultCount += 1;
      continue;
    }
    seen.add(canonicalUrl);
    const candidate = normalizedCandidate(
      entry,
      canonicalUrl,
      options.query,
      search.rawResponseSha256,
      ordinal,
    );
    if (candidate === null) {
      filteredResultCount += 1;
      continue;
    }
    candidates.push(candidate);
  }

  const finalizedReceipt = receipt({
    ...search.receipt,
    outcome: "success",
    providerRequestIdSha256: sha256Text(parsed.requestId),
    candidateCount: candidates.length,
    filteredResultCount,
  });
  return {
    ok: true,
    candidates,
    receipts: [finalizedReceipt],
    filteredResultCount,
  };
}

function exactFields(value, fields) {
  return isRecord(value)
    && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}

function approvedDatabaseAuthority(authority) {
  if (!exactFields(authority, AUTHORITY_FIELDS) || !exactFields(authority.request, AUTHORIZED_REQUEST_FIELDS)) {
    return false;
  }
  const request = authority.request;
  if (
    authority.provider !== "tavily"
    || authority.queryPolicyVersion !== TAVILY_LINKEDIN_QUERY_POLICY_VERSION
    || typeof request.query !== "string"
    || request.query.length < 1
    || request.query.length > MAX_QUERY_LENGTH
    || CONTROL_RE.test(request.query)
    || request.search_depth !== "basic"
    || request.max_results !== MAX_RESULT_LIMIT
    || !Array.isArray(request.include_domains)
    || request.include_domains.length !== 1
    || request.include_domains[0] !== "linkedin.com"
    || request.include_answer !== false
    || request.include_images !== false
    || !SHA256_RE.test(authority.canonicalQuerySha256)
    || !SHA256_RE.test(authority.requestSha256)
  ) {
    return false;
  }
  const querySha256 = sha256Text(
    `${TAVILY_LINKEDIN_QUERY_POLICY_VERSION}\n${request.query}`
      + "\nmax_results:5\ninclude_domains:linkedin.com\nsearch_depth:basic",
  );
  const requestSha256 = sha256Text(
    `aria.autonomous-web-request.v1\n${postgresJsonbText(request)}`,
  );
  return querySha256 === authority.canonicalQuerySha256
    && requestSha256 === authority.requestSha256;
}

function workspaceAuthorizationHeader(credential) {
  if (!isRecord(credential) || credential.kind !== "workspace") {
    throw new TypeError("explicit workspace Tavily credential is required");
  }
  if (typeof credential.authorizationHeader !== "function") {
    throw new TypeError("Tavily credential is invalid");
  }
  let authorizationHeader;
  try {
    authorizationHeader = credential.authorizationHeader();
  } catch {
    throw new TypeError("Tavily credential is invalid");
  }
  if (
    typeof authorizationHeader !== "string"
    || !/^Bearer [^\s\u0000-\u001f\u007f]{20,512}$/.test(authorizationHeader)
  ) {
    throw new TypeError("Tavily credential is invalid");
  }
  return authorizationHeader;
}

/**
 * Execute the exact provider request minted by 0060 after its final egress
 * fence. Unlike the standalone query-policy adapter above, this function does
 * not derive or accept role/query authority from the caller. It verifies the
 * database-returned hashes, issues one fixed Tavily request, and returns only
 * bounded provider evidence that 0060 can validate and commit atomically.
 */
export async function executeAuthorizedTavilySearch(options) {
  if (!isRecord(options) || !approvedDatabaseAuthority(options.authority)) {
    throw new TypeError("authorized Tavily request is invalid");
  }
  const authorizationHeader = workspaceAuthorizationHeader(options.credential);
  if (options.authority.request.query.includes(authorizationHeader.slice("Bearer ".length))) {
    throw new TypeError("authorized Tavily request is invalid");
  }
  const timeoutMs = boundedInteger(options.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "timeoutMs");
  if (typeof options.fetcher !== "function") throw new TypeError("fetcher is required");
  const query = {
    value: options.authority.request.query,
    sha256: options.authority.canonicalQuerySha256,
  };
  const search = await requestSearch({
    query,
    resultLimit: MAX_RESULT_LIMIT,
    timeoutMs,
    fetcher: options.fetcher,
    signal: options.signal,
    authorizationHeader,
    authorizedRequest: options.authority.request,
  });
  if (!search.ok) {
    const ambiguous = search.code === "search_transport_unknown";
    return {
      ok: false,
      code: search.code,
      retryable: ambiguous ? false : search.retryable,
      ambiguous,
    };
  }
  const parsed = parseSearchPayload(search.data, query, MAX_RESULT_LIMIT);
  if (!parsed.ok || !SHA256_RE.test(search.rawResponseSha256)) {
    return {
      ok: false,
      code: "search_malformed_payload",
      retryable: false,
      ambiguous: false,
    };
  }

  const normalizedResults = [];
  const seen = new Set();
  for (const entry of parsed.results) {
    const canonicalUrl = canonicalLinkedInProfileUrl(entry.url);
    if (canonicalUrl === null || seen.has(canonicalUrl)) {
      return {
        ok: false,
        code: "search_malformed_payload",
        retryable: false,
        ambiguous: false,
      };
    }
    seen.add(canonicalUrl);
    normalizedResults.push({
      url: canonicalUrl,
      title: entry.title,
      content: entry.content,
      score: entry.score,
    });
  }
  const rawResponseBytes = search.receipt.responseBytes;
  const rawResponseSha256 = search.rawResponseSha256;
  return {
    ok: true,
    normalizedResults,
    rawResponseSha256,
    rawResponseBytes,
    providerReceipt: {
      provider: "tavily",
      providerRequestId: parsed.requestId,
      responseTimeMs: Math.round(Number(search.data.response_time) * 1_000),
      resultCount: normalizedResults.length,
      querySha256: options.authority.canonicalQuerySha256,
      requestSha256: options.authority.requestSha256,
      rawResponseSha256,
      rawResponseBytes,
    },
  };
}
