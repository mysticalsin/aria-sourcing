import { createHash } from "node:crypto";

export const GITHUB_DETERMINISTIC_QUERY_POLICY_VERSION = "github-deterministic-v2";
// A bounded operational default for one autonomous sourcing pass. It is not a
// capacity or quality claim: controls and provider quotas still gate each
// batch independently.
export const SOURCING_CANDIDATE_TARGET = 9;
export const SOURCING_MAX_BATCH_ORDINAL = 4;

const OPTIONAL_ROLE_FIELDS = Object.freeze([
  "employmentType",
  "locationType",
  "region",
  "seniority",
  "timezone",
]);
const ALLOWED_ROLE_FIELDS = new Set(["title", "skills", ...OPTIONAL_ROLE_FIELDS]);
const MAX_SKILLS = 64;
const MAX_SKILL_LENGTH = 100;
const UNSAFE_ROLE_VALUE = /(?:[\u0000-\u001f\u007f]|@|https?:\/\/|www\.)/i;

const LANGUAGE_ALIASES = new Map([
  ["c#", "c#"],
  ["c sharp", "c#"],
  ["csharp", "c#"],
  ["c++", "c++"],
  ["c plus plus", "c++"],
  ["cplusplus", "c++"],
  ["clojure", "clojure"],
  ["dart", "dart"],
  ["elixir", "elixir"],
  ["erlang", "erlang"],
  ["go", "go"],
  ["golang", "go"],
  ["haskell", "haskell"],
  ["java", "java"],
  ["javascript", "javascript"],
  ["kotlin", "kotlin"],
  ["node js", "javascript"],
  ["node.js", "javascript"],
  ["nodejs", "javascript"],
  ["objective c", "objective-c"],
  ["objective-c", "objective-c"],
  ["perl", "perl"],
  ["php", "php"],
  ["python", "python"],
  ["r", "r"],
  ["ruby", "ruby"],
  ["rust", "rust"],
  ["scala", "scala"],
  ["shell", "shell"],
  ["swift", "swift"],
  ["typescript", "typescript"],
]);
const CANONICAL_QUERY_VALUES = new Set(
  [...new Set(LANGUAGE_ALIASES.values())].map((language) => `language:${language} type:user`),
);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function boundedBatchOrdinal(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SOURCING_MAX_BATCH_ORDINAL
  ) {
    throw new TypeError("batch ordinal is invalid");
  }
  return value;
}

function canonicalQuerySha256(value, page) {
  return sha256(`${GITHUB_DETERMINISTIC_QUERY_POLICY_VERSION}\n${value}\npage:${page}`);
}

function isCanonicalText(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    value === value.trim().toLowerCase() &&
    !UNSAFE_ROLE_VALUE.test(value)
  );
}

/**
 * The database returns canonical role evidence. Rechecking that exact shape at
 * the process boundary prevents a forged RPC response from becoming provider
 * input. Query text itself is never accepted from a job payload.
 */
export function validateDeterministicRoleBasis(value) {
  if (!isRecord(value)) return { ok: false, code: "invalid_role_basis" };
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_ROLE_FIELDS.has(key))) {
    return { ok: false, code: "invalid_role_basis" };
  }
  if (!isCanonicalText(value.title, 2, 200)) {
    return { ok: false, code: "invalid_role_basis" };
  }
  if (!Array.isArray(value.skills) || value.skills.length < 1 || value.skills.length > MAX_SKILLS) {
    return { ok: false, code: "invalid_role_basis" };
  }
  const skills = [];
  for (const skill of value.skills) {
    if (!isCanonicalText(skill, 1, MAX_SKILL_LENGTH)) {
      return { ok: false, code: "invalid_role_basis" };
    }
    skills.push(skill);
  }
  const canonicalSkills = [...new Set(skills)].sort();
  if (canonicalSkills.length !== skills.length || canonicalSkills.some((skill, index) => skill !== skills[index])) {
    return { ok: false, code: "invalid_role_basis" };
  }
  for (const field of OPTIONAL_ROLE_FIELDS) {
    if (Object.hasOwn(value, field) && !isCanonicalText(value[field], 1, 200)) {
      return { ok: false, code: "invalid_role_basis" };
    }
  }
  return { ok: true };
}

/**
 * Derive exactly one finite, server-owned GitHub query. Unsupported role text
 * produces no egress rather than being forwarded as arbitrary search syntax.
 */
export function deriveDeterministicGithubQuery(roleBasis, batchOrdinal) {
  const validation = validateDeterministicRoleBasis(roleBasis);
  if (!validation.ok) throw new TypeError("role basis is not canonical");
  const ordinal = boundedBatchOrdinal(batchOrdinal);

  const languages = [...new Set(roleBasis.skills.map((skill) => LANGUAGE_ALIASES.get(skill)).filter(Boolean))]
    .sort();
  if (languages.length === 0) return { ok: false, code: "no_supported_query_terms" };

  // Cover every supported language before advancing to its next provider
  // page. Both choices are derived only from immutable role evidence and the
  // bounded durable batch ordinal.
  const language = languages[ordinal % languages.length];
  const page = Math.floor(ordinal / languages.length) + 1;
  const value = `language:${language} type:user`;
  return {
    ok: true,
    query: {
      policyVersion: GITHUB_DETERMINISTIC_QUERY_POLICY_VERSION,
      value,
      page,
      sha256: canonicalQuerySha256(value, page),
    },
  };
}

export function validateCanonicalGithubQuery(value) {
  if (!isRecord(value)) return { ok: false, code: "invalid_canonical_query" };
  if (
    Object.keys(value).length !== 4 ||
    !["page", "policyVersion", "sha256", "value"].every((key) => Object.hasOwn(value, key)) ||
    value.policyVersion !== GITHUB_DETERMINISTIC_QUERY_POLICY_VERSION ||
    typeof value.value !== "string" ||
    !CANONICAL_QUERY_VALUES.has(value.value) ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    value.page > SOURCING_MAX_BATCH_ORDINAL + 1 ||
    typeof value.sha256 !== "string" ||
    value.sha256 !== canonicalQuerySha256(value.value, value.page)
  ) {
    return { ok: false, code: "invalid_canonical_query" };
  }
  return { ok: true };
}

export function validateCanonicalGithubQueryForRoleBasis(value, roleBasis, batchOrdinal) {
  const canonical = validateCanonicalGithubQuery(value);
  if (!canonical.ok) return canonical;
  let defaultQuery;
  try {
    defaultQuery = deriveDeterministicGithubQuery(roleBasis, batchOrdinal);
  } catch {
    return { ok: false, code: "query_not_approved_for_role_basis" };
  }
  if (!defaultQuery.ok) return { ok: false, code: "query_not_approved_for_role_basis" };

  // Match the database authority exactly: learning may reorder only the
  // finite variants already produced for this role on the default provider
  // page. It cannot add a language, qualifier, page, or policy version.
  for (let ordinal = 0; ordinal <= SOURCING_MAX_BATCH_ORDINAL; ordinal += 1) {
    const candidate = deriveDeterministicGithubQuery(roleBasis, ordinal);
    if (
      candidate.ok &&
      candidate.query.page === defaultQuery.query.page &&
      value.policyVersion === candidate.query.policyVersion &&
      value.value === candidate.query.value &&
      value.page === candidate.query.page &&
      value.sha256 === candidate.query.sha256
    ) {
      return { ok: true };
    }
  }
  return { ok: false, code: "query_not_approved_for_role_basis" };
}
