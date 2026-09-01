// Server-only runners for the unified enrichment orchestrator
// (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md). One runner
// per registry provider (src/lib/enrichment/registry.ts); the orchestrator
// (enrichment/orchestrator.ts) resolves which runner to call from
// `provider.id` and folds the result into the candidate via
// `mergeEnrichment`/`recordEnrichmentAttempt` (enrichment/merge.ts).
//
// CORE DESIGN PRINCIPLE ("works with all my tools"): a candidate discovered by
// ANY provider can still be enriched by every OTHER configured provider. Each
// runner resolves ITS OWN identity from the candidate's universal fields
// (name, company, linkedinUrl, externalIds) via that provider's free
// search/lookup step, then enriches. This is the cross-provider identity
// resolution the design calls out as the heart of the feature.
//
// Every runner is defensive: it never throws (adapter errors are caught and
// turned into a `status: "error"` result), never logs a key, and never
// returns one — only the adapters' `resolveStored*Key()` touch the decrypted
// secret, and it stays local to this module's call stack.

import type { getServerSupabase } from "@/lib/supabase/server";
import { enrichProfilesByUrl, resolveStoredApifyKey, scrapeGithubTechStack } from "@/lib/sourcing/apify";
import { matchApolloPerson, resolveStoredApolloKey, searchApolloPeople, type ApolloPerson } from "@/lib/sourcing/apollo";
import {
  pollSeamlessResearch,
  resolveStoredSeamlessKey,
  searchSeamlessContacts,
  startSeamlessResearch,
  type SeamlessContact,
} from "@/lib/sourcing/seamless";
import {
  findMappingId,
  getCompanyMapping,
  getMappingStage,
  resolveStoredSillageKey,
  startAccountMapping,
  type SillageProfile,
} from "@/lib/sourcing/sillage";
import type { EnrichedFields } from "@/lib/enrichment/merge";
import { clearIdentityResolution } from "@/lib/sourcing/provider-egress";
import type { Candidate, EnrichmentAttempt } from "@/lib/types";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

/** One provider run against one candidate. `fields` folds into the candidate
 *  via `mergeEnrichment`; `costUnits` is the REAL spend this call incurred
 *  (not the registry's relative ordering weight); `externalId`, when present,
 *  is this provider's resolved identifier for the candidate (e.g. an Apollo
 *  person id) — the orchestrator records it onto `candidate.externalIds` so a
 *  later re-enrichment skips the free search/resolve step entirely. */
export interface RunnerResult {
  fields: EnrichedFields;
  costUnits: number;
  status: EnrichmentAttempt["status"];
  detail?: string;
  externalId?: string;
}

export type EnrichmentRunner = (session: Session, candidate: Candidate) => Promise<RunnerResult>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded poll budget shared by the async providers (Seamless research,
 *  Sillage account mapping) — never block a request indefinitely on a
 *  provider that's still working; the caller can re-run to pick up later.
 *  Exported so the orchestrator (enrichment/orchestrator.ts) can tell, ahead
 *  of invoking a slow/async runner, whether the wall-clock deadline leaves
 *  enough runway for it to even finish a poll cycle — kept low enough (with
 *  ORCH_DEADLINE_MS = 45s) that at most one slow provider can complete within
 *  a single request, well under the platform's 60s route cap. */
const POLL_INTERVAL_MS = 2_000;
export const POLL_BUDGET_MS = 30_000;

/** Lowercased, whitespace-collapsed name for loose cross-provider matching. */
function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when any whitespace-separated token of `candidateName` appears in
 *  `resultName` — a deliberately loose fallback match (exact name/linkedinUrl
 *  is tried first) used only because the upstream free search was already
 *  constrained by this candidate's own name+company. */
function nameTokensOverlap(candidateName: string, resultName: string): boolean {
  const resultTokens = new Set(normalizeName(resultName).split(" ").filter(Boolean));
  return normalizeName(candidateName)
    .split(" ")
    .filter(Boolean)
    .some((token) => resultTokens.has(token));
}

/* ---- dev_fusion (Apify) ----------------------------------------------------
 * Keyed purely on linkedinUrl — the one identifier every source platform can
 * supply. No free "resolve an id" step needed: the URL itself is the identity. */

export const devFusionRunner: EnrichmentRunner = async (session, candidate) => {
  const linkedinUrl = candidate.linkedinUrl?.trim();
  if (!linkedinUrl) {
    return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No linkedinUrl on this candidate." };
  }
  const token = await resolveStoredApifyKey(session);
  if (!token) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No Apify key configured." };

  const clearance = clearIdentityResolution("Apify", { linkedinUrl });
  if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };

  const res = await enrichProfilesByUrl(clearance.clearance, token, [linkedinUrl]);
  if (!res.ok) {
    if (res.title === "not_approved") {
      return {
        fields: {},
        costUnits: 0,
        status: "not_configured",
        detail: "Apify dev_fusion actor needs owner approval in the Apify console.",
      };
    }
    return { fields: {}, costUnits: 0, status: "error", detail: res.detail || res.title };
  }

  const profile = res.data[0];
  if (!profile) return { fields: {}, costUnits: 1, status: "no_data", detail: "dev_fusion found no profile for this URL." };

  const fields: EnrichedFields = {};
  if (profile.email) fields.email = { value: profile.email, confidence: 0.9 };
  if (profile.phone) fields.phone = { value: profile.phone, confidence: 0.7 };
  if (profile.headline) fields.headline = { value: profile.headline };
  if (profile.location?.text) fields.location = { value: profile.location.text };
  const skills = [...profile.topSkills, ...profile.skills];
  if (skills.length) fields.skills = { value: skills };
  const experience = [...profile.currentPosition, ...profile.experience]
    .map((p) => [p.title, p.companyName].filter(Boolean).join(" @ ") + (p.dateRange ? ` (${p.dateRange})` : ""))
    .filter((s) => s.trim().length > 0);
  if (experience.length) fields.experience = { value: experience };
  const education = profile.education
    .map((e) => [e.degree, e.schoolName].filter(Boolean).join(" @ ") + (e.dateRange ? ` (${e.dateRange})` : ""))
    .filter((s) => s.trim().length > 0);
  if (education.length) fields.education = { value: education };
  if (profile.languages.length) fields.languages = { value: profile.languages };

  return { fields, costUnits: 1, status: "ok" };
};

/* ---- GitHub tech-stack -----------------------------------------------------
 * Merge languages/skills onto an existing person. Never mints a leftover. */

export const githubTechStackRunner: EnrichmentRunner = async (session, candidate) => {
  const githubUrl = candidate.githubUrl?.trim();
  if (!githubUrl) {
    return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No githubUrl on this candidate." };
  }
  const token = await resolveStoredApifyKey(session);
  if (!token) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No harvest key configured." };

  const clearance = clearIdentityResolution("Apify", { githubUrl });
  if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };

  const res = await scrapeGithubTechStack(clearance.clearance, token, githubUrl);
  if (!res.ok) return { fields: {}, costUnits: 0, status: "error", detail: res.detail || res.title };
  if (res.data.length === 0) {
    return { fields: {}, costUnits: 1, status: "no_data", detail: "GitHub scraper returned no tech stack." };
  }
  return { fields: { skills: { value: res.data } }, costUnits: 1, status: "ok" };
};

/* ---- Apollo ----------------------------------------------------------------
 * Free mixed_people/search resolves an apolloId from name+company when the
 * candidate wasn't sourced via Apollo directly; people/match then reveals
 * email/phone for exactly 1 credit (0 if no match). */

function pickBestApolloMatch(people: ApolloPerson[], candidate: Candidate): ApolloPerson | null {
  const wantUrl = candidate.linkedinUrl?.trim().toLowerCase();
  if (wantUrl) {
    const byUrl = people.find((p) => p.linkedinUrl.trim().toLowerCase() === wantUrl);
    if (byUrl) return byUrl;
  }
  const exact = people.find((p) => normalizeName(p.name) === normalizeName(candidate.name));
  if (exact) return exact;
  return people.find((p) => nameTokensOverlap(candidate.name, p.name)) ?? null;
}

export const apolloRunner: EnrichmentRunner = async (session, candidate) => {
  const apiKey = await resolveStoredApolloKey(session);
  if (!apiKey) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No Apollo key configured." };

  let apolloId = candidate.externalIds?.Apollo?.trim() || "";
  if (!apolloId) {
    const name = candidate.name?.trim();
    const company = candidate.currentCompany?.trim();
    if (!name || !company) {
      return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No name+company to resolve an Apollo id." };
    }
    let people: ApolloPerson[];
    try {
      const clearance = clearIdentityResolution("Apollo", { name, company });
      if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };
      people = await searchApolloPeople(clearance.clearance, { keywords: `${name} ${company}` }, 10, apiKey);
    } catch (err) {
      return { fields: {}, costUnits: 0, status: "error", detail: err instanceof Error ? err.message : "Apollo search failed." };
    }
    const best = pickBestApolloMatch(people, candidate);
    if (!best) {
      return { fields: {}, costUnits: 0, status: "no_data", detail: "No Apollo match for name+company (free search, 0 credits)." };
    }
    apolloId = best.id;
  }

  try {
    const clearance = clearIdentityResolution("Apollo", { apolloId });
    if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error, externalId: apolloId };
    const match = await matchApolloPerson(clearance.clearance, apolloId, apiKey, { revealPhone: true });
    if (!match) {
      return {
        fields: {},
        costUnits: 0,
        status: "no_data",
        detail: "Apollo found no email/phone for this person (0 credits charged).",
        externalId: apolloId,
      };
    }
    const fields: EnrichedFields = {};
    if (match.email) fields.email = { value: match.email, confidence: 0.85 };
    if (match.phone) fields.phone = { value: match.phone, confidence: 0.7 };
    return { fields, costUnits: 1, status: "ok", externalId: apolloId };
  } catch (err) {
    return {
      fields: {},
      costUnits: 0,
      status: "error",
      detail: err instanceof Error ? err.message : "Apollo enrichment failed.",
      externalId: apolloId,
    };
  }
};

/* ---- Seamless.AI -----------------------------------------------------------
 * Free search/contacts resolves a searchResultId from name+company when not
 * already sourced via Seamless; the async research/poll flow then reveals
 * email/phone. Poll is bounded — still-processing at the cap reports back as
 * "ok"/"pending" with no fields so the client can re-run later. */

function pickBestSeamlessMatch(contacts: SeamlessContact[], candidate: Candidate): SeamlessContact | null {
  const wantUrl = candidate.linkedinUrl?.trim().toLowerCase();
  if (wantUrl) {
    const byUrl = contacts.find((c) => c.liUrl.trim().toLowerCase() === wantUrl);
    if (byUrl) return byUrl;
  }
  const exact = contacts.find((c) => normalizeName(c.name) === normalizeName(candidate.name));
  if (exact) return exact;
  return contacts.find((c) => nameTokensOverlap(candidate.name, c.name)) ?? null;
}

export const seamlessRunner: EnrichmentRunner = async (session, candidate) => {
  const apiKey = await resolveStoredSeamlessKey(session);
  if (!apiKey) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No Seamless key configured." };

  let searchResultId = candidate.externalIds?.Seamless?.trim() || "";
  if (!searchResultId) {
    const name = candidate.name?.trim();
    const company = candidate.currentCompany?.trim();
    if (!name || !company) {
      return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No name+company to resolve a Seamless search result." };
    }
    let contacts: SeamlessContact[];
    try {
      const clearance = clearIdentityResolution("Seamless", { name, company });
      if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };
      contacts = await searchSeamlessContacts(clearance.clearance, { companyNames: [company] }, 25, apiKey);
    } catch (err) {
      return { fields: {}, costUnits: 0, status: "error", detail: err instanceof Error ? err.message : "Seamless search failed." };
    }
    const best = pickBestSeamlessMatch(contacts, candidate);
    if (!best) {
      return { fields: {}, costUnits: 0, status: "no_data", detail: "No Seamless match for name+company (free search, 0 credits)." };
    }
    searchResultId = best.searchResultId;
  }

  const clearance = clearIdentityResolution("Seamless", { searchResultId });
  if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error, externalId: searchResultId };

  const startRes = await startSeamlessResearch(clearance.clearance, apiKey, searchResultId);
  if (!startRes.ok) {
    return { fields: {}, costUnits: 0, status: "error", detail: startRes.detail || startRes.title, externalId: searchResultId };
  }
  const { requestId } = startRes.data;

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await pollSeamlessResearch(clearance.clearance, apiKey, requestId);
    if (!pollRes.ok) {
      return { fields: {}, costUnits: 0, status: "error", detail: pollRes.detail || pollRes.title, externalId: searchResultId };
    }
    const { status, contact, message } = pollRes.data;
    if (status === "queued" || status === "researching") continue;
    if (status === "done" && contact) {
      const fields: EnrichedFields = {};
      if (contact.email) fields.email = { value: contact.email, confidence: 0.8 };
      if (contact.phone) fields.phone = { value: contact.phone, confidence: 0.6 };
      const costUnits = fields.email || fields.phone ? 1 : 0;
      return { fields, costUnits, status: "ok", externalId: searchResultId };
    }
    // Terminal, non-"done" state: error / missing / duplicate / not found /
    // contact-already-researched / no license — no contact revealed, 0 credits.
    return { fields: {}, costUnits: 0, status: "no_data", detail: message || status, externalId: searchResultId };
  }
  // Still processing at the poll cap — report success-but-pending rather than
  // an error; the client can re-run the waterfall later to pick up the result
  // (Seamless keeps the requestId's research running server-side).
  return { fields: {}, costUnits: 0, status: "ok", detail: "pending", externalId: searchResultId };
};

/* ---- Sillage ----------------------------------------------------------------
 * Company-keyed account mapping. Only runs when `currentCompany` looks like a
 * real domain — Sillage's account-mapping endpoint takes domain/linkedinUrl/
 * linkedinHandle, not a free-text company name, and this app's Candidate
 * model doesn't carry a dedicated company-domain field yet. */

/** True when `s` looks like a bare domain (e.g. "acme.com"), not a display
 *  name ("Acme, Inc.") — the only shape startAccountMapping's `domain` param
 *  accepts. */
function deriveDomain(company: string): string | null {
  const trimmed = company.trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(trimmed) ? trimmed : null;
}

function pickBestSillageProfile(profiles: SillageProfile[], candidate: Candidate): SillageProfile | null {
  const fullName = (p: SillageProfile) => [p.firstName, p.lastName].filter(Boolean).join(" ");
  const wantUrl = candidate.linkedinUrl?.trim().toLowerCase();
  if (wantUrl) {
    const byUrl = profiles.find((p) => p.linkedinUrl?.trim().toLowerCase() === wantUrl);
    if (byUrl) return byUrl;
  }
  const exact = profiles.find((p) => normalizeName(fullName(p)) === normalizeName(candidate.name));
  if (exact) return exact;
  return profiles.find((p) => nameTokensOverlap(candidate.name, fullName(p))) ?? null;
}

export const sillageRunner: EnrichmentRunner = async (session, candidate) => {
  const apiKey = await resolveStoredSillageKey(session);
  if (!apiKey) return { fields: {}, costUnits: 0, status: "not_configured", detail: "No Sillage key configured." };

  const company = candidate.currentCompany?.trim();
  const domain = company ? deriveDomain(company) : null;
  if (!domain) {
    return { fields: {}, costUnits: 0, status: "no_key_field", detail: "No company domain to map via Sillage." };
  }

  const clearance = clearIdentityResolution("Sillage", { domain });
  if (!clearance.ok) return { fields: {}, costUnits: 0, status: "error", detail: clearance.error };

  const startRes = await startAccountMapping(clearance.clearance, apiKey, { domain });
  if (!startRes.ok) return { fields: {}, costUnits: 0, status: "error", detail: startRes.detail || startRes.title };
  const { requestId } = startRes.data;

  const deadline = Date.now() + POLL_BUDGET_MS;
  let mappedCompany: { id: string; domain: string | null } | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const stageRes = await getMappingStage(clearance.clearance, apiKey, requestId);
    if (!stageRes.ok) return { fields: {}, costUnits: 0, status: "error", detail: stageRes.detail || stageRes.title };
    if (stageRes.data.stage === "completed") {
      mappedCompany = { id: stageRes.data.company.id, domain: stageRes.data.company.domain };
      break;
    }
    if (stageRes.data.stage === "account_mapping_failed") {
      return { fields: {}, costUnits: 0, status: "no_data", detail: "Sillage account mapping failed for this company." };
    }
  }
  if (!mappedCompany) {
    // Still mapping at the poll cap — same "ok"/"pending" shape as Seamless.
    return { fields: {}, costUnits: 0, status: "ok", detail: "pending" };
  }

  const idRes = await findMappingId(clearance.clearance, apiKey, mappedCompany);
  if (!idRes.ok) return { fields: {}, costUnits: 0, status: "error", detail: idRes.detail || idRes.title };
  if (!idRes.data) return { fields: {}, costUnits: 0, status: "no_data", detail: "Mapping completed but no mapping id was found." };

  const mappingRes = await getCompanyMapping(clearance.clearance, apiKey, idRes.data);
  if (!mappingRes.ok) return { fields: {}, costUnits: 0, status: "error", detail: mappingRes.detail || mappingRes.title };

  const match = pickBestSillageProfile(mappingRes.data.profiles, candidate);
  if (!match) {
    return { fields: {}, costUnits: 0, status: "no_data", detail: "No matching person in this company's Sillage mapping." };
  }

  const fields: EnrichedFields = {};
  if (match.email) fields.email = { value: match.email, confidence: 0.75 };
  if (match.phone) fields.phone = { value: match.phone, confidence: 0.6 };
  if (match.headline) fields.headline = { value: match.headline };
  if (match.location) {
    const location = [match.location.city, match.location.region, match.location.country].filter(Boolean).join(", ");
    if (location) fields.location = { value: location };
  }
  const costUnits = Object.keys(fields).length > 0 ? 1 : 0;
  return { fields, costUnits, status: "ok" };
};
