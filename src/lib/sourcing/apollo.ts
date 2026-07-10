// Real candidate sourcing via the Apollo.io API. Search (mixed_people/search) is
// free (no Apollo credits) and requires a MASTER API key. Enrichment
// (people/match) costs exactly 1 credit per matched person (0 if not found) and
// must only ever be called on a deliberate, per-candidate, confirmed action —
// never automatically for a whole search batch. Auth header is `x-api-key`
// (docs.apollo.io/docs/authentication).
//
// Response field names below follow Apollo's documented/public API shape. This
// was not live-tested against a real key this session — callers must read the
// actual HTTP status/error body Apollo returns and surface it honestly rather
// than assume a guessed envelope.

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";

const APOLLO_API = "https://api.apollo.io/v1";

export interface ApolloSearchFilters {
  titles?: string[];
  seniorities?: string[];
  locations?: string[];
  organizationDomains?: string[];
  keywords?: string;
}

export interface ApolloPerson {
  /** Apollo's internal person id — required for a later enrichment call. */
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
  city: string;
  state: string;
  country: string;
  headline: string;
  seniority: string;
  departments: string[];
}

export interface ApolloMatch {
  email: string;
  phone: string;
}

function apolloHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Extract a JSON-safe string field from an unknown record, else "". */
function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function toApolloPerson(raw: Record<string, unknown>): ApolloPerson {
  const org = (raw.organization && typeof raw.organization === "object"
    ? (raw.organization as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const first = str(raw, "first_name");
  const last = str(raw, "last_name");
  const name = str(raw, "name").trim() || [first, last].filter(Boolean).join(" ").trim() || "Unknown";
  const departments = Array.isArray(raw.departments)
    ? raw.departments.filter((d): d is string => typeof d === "string")
    : [];
  return {
    id: str(raw, "id"),
    name,
    title: str(raw, "title"),
    company: str(org, "name"),
    linkedinUrl: str(raw, "linkedin_url"),
    city: str(raw, "city"),
    state: str(raw, "state"),
    country: str(raw, "country"),
    headline: str(raw, "headline"),
    seniority: str(raw, "seniority"),
    departments,
  };
}

/**
 * Search Apollo for real people matching the given filters. Free — does not
 * consume Apollo credits. `count` is capped at 100 (Apollo's per-page max).
 */
export async function searchApolloPeople(
  filters: ApolloSearchFilters,
  count: number,
  apiKey: string,
): Promise<ApolloPerson[]> {
  const perPage = Math.min(Math.max(Math.trunc(count) || 1, 1), 100);
  const body: Record<string, unknown> = { page: 1, per_page: perPage };
  if (filters.titles?.length) body.person_titles = filters.titles;
  if (filters.seniorities?.length) body.person_seniorities = filters.seniorities;
  if (filters.locations?.length) body.person_locations = filters.locations;
  if (filters.organizationDomains?.length) body.q_organization_domains_list = filters.organizationDomains;
  if (filters.keywords?.trim()) body.q_keywords = filters.keywords.trim();

  const res = await fetch(`${APOLLO_API}/mixed_people/search`, {
    method: "POST",
    headers: apolloHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo search API ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json().catch(() => ({}))) as { people?: unknown[] };
  const people = Array.isArray(json.people) ? json.people : [];
  return people
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map(toApolloPerson);
}

/**
 * Enrich a single Apollo person by their Apollo id — reveals personal email and
 * (optionally) phone. Costs exactly 1 Apollo credit on a match, 0 if not found.
 * Only ever call this for a deliberate, confirmed, single-candidate action.
 * Returns null when Apollo found no match (0 credits charged).
 */
export async function matchApolloPerson(
  apolloId: string,
  apiKey: string,
  opts: { revealPhone?: boolean } = {},
): Promise<ApolloMatch | null> {
  const res = await fetch(`${APOLLO_API}/people/match`, {
    method: "POST",
    headers: apolloHeaders(apiKey),
    body: JSON.stringify({
      id: apolloId,
      reveal_personal_emails: true,
      reveal_phone_number: !!opts.revealPhone,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo enrichment API ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json().catch(() => ({}))) as { person?: Record<string, unknown> };
  const person = json.person;
  if (!person) return null;

  // Apollo returns a literal "email_not_unlocked@domain.com"-style placeholder
  // (not null/empty) when an email exists but wasn't revealed — treat that as
  // no email rather than surfacing garbage to the recruiter.
  const rawEmail = str(person, "email");
  const email = rawEmail && !rawEmail.includes("not_unlocked") ? rawEmail : "";
  // Phone shape isn't confirmed against a live key this session — check the
  // couple of plausible shapes Apollo documents rather than assume one.
  let phone = "";
  const phoneNumbers = person.phone_numbers;
  if (Array.isArray(phoneNumbers) && phoneNumbers.length > 0) {
    const first = phoneNumbers[0];
    if (first && typeof first === "object") {
      const p = first as Record<string, unknown>;
      phone = str(p, "sanitized_number") || str(p, "raw_number");
    }
  }
  if (!phone) phone = str(person, "phone_number") || str(person, "sanitized_phone");

  if (!email && !phone) return null;
  return { email, phone };
}

/**
 * Live "am I authenticated" check via GET /v1/auth/health — Apollo's own
 * canonical example for confirming a key works, free of charge. 401/403 →
 * invalid; 200 → valid; any other response is surfaced honestly rather than
 * assumed. Throws on network/timeout error so the caller can fall back to a
 * format-only check.
 */
export async function checkApolloAuth(apiKey: string): Promise<{ valid: boolean; detail: string }> {
  const res = await fetch(`${APOLLO_API}/auth/health`, {
    method: "GET",
    headers: apolloHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, detail: `Apollo rejected the key (${res.status}).` };
  }
  if (res.ok) return { valid: true, detail: "Apollo key is valid (live check)." };
  return { valid: false, detail: `Apollo returned an unexpected HTTP ${res.status}.` };
}

/**
 * Resolve this workspace's stored, decrypted Apollo key (service-role read —
 * `secret` is withheld from `authenticated` by column grant, same pattern
 * /api/email/sync and Sillage use). Returns null when nothing is stored —
 * never accepts a raw key from the caller.
 */
export async function resolveStoredApolloKey(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
): Promise<string | null> {
  const svc = getServiceSupabase();
  if (!svc) return null;
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await svc
    .from("api_keys")
    .select("secret")
    .eq("workspace_id", wid)
    .eq("provider", "Apollo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  return decryptSecret(row.secret);
}
