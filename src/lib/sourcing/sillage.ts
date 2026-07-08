// Real candidate sourcing via Sillage's Account Mapping API (getsillage.com).
// SERVER ONLY: called from /api/source/sillage/{start,status} with a workspace's
// stored, decrypted Sillage key — the key never reaches the browser.
//
// Account Mapping resolves a company (by domain / linkedin_url / linkedin_handle)
// into real enriched employee profiles: a genuine sibling to GitHub Users Search
// and web-search sourcing, not a signals feed. Enrichment is asynchronous — POST
// enrich-company-mapping returns 202 + a request_id, which the caller polls via
// getMappingStage() until a terminal stage (completed / account_mapping_failed),
// then resolves the mapping id via listCompanyMappings() and fetches the full
// profile list via getCompanyMapping(). A real result is authoritative even at
// zero hits — this module never fabricates a profile.
//
// The candidate-mapping (Candidate shape + scoring + dedupe) step lives in
// store.ts, not here — this module returns raw Sillage data only, mirroring how
// sourcing/github.ts stays a thin API client and mock-ai.ts owns the mapping.

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";

const SILLAGE_API = "https://api.getsillage.com";

export type SillageResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; title: string; detail: string };

export interface SillageCompany {
  id: string;
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
}

export interface SillageStage {
  id: string;
  type: string;
  stage: string;
  createdAt: string;
  updatedAt: string;
  company: SillageCompany;
}

export interface SillageProfile {
  id: string;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  about: string | null;
  position: string | null;
  positionStartDate: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  location: { city: string | null; region: string | null; country: string | null } | null;
}

export interface SillageMapping {
  id: string;
  company: SillageCompany;
  profiles: SillageProfile[];
}

interface RawCompany {
  id?: string;
  name?: string;
  domain?: string | null;
  linkedin_url?: string | null;
}

function mapCompany(c?: RawCompany): SillageCompany {
  return { id: String(c?.id ?? ""), name: c?.name ?? "", domain: c?.domain ?? null, linkedinUrl: c?.linkedin_url ?? null };
}

/**
 * Low-level request wrapper. Sillage documents RFC9457 problem+json error bodies
 * ({type,title,status,detail,instance}), but this endpoint's docs show that shape
 * isn't always exact — read whatever the body actually contains rather than assume
 * a field is present, and surface it honestly to the caller.
 */
async function sillageRequest<T>(
  path: string,
  apiKey: string,
  opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<SillageResult<T>> {
  try {
    const res = await fetch(`${SILLAGE_API}${path}`, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const title = typeof json.title === "string" ? json.title : `Sillage API error (${res.status})`;
      const detail =
        typeof json.detail === "string" ? json.detail : typeof json.message === "string" ? json.message : "";
      return { ok: false, status: res.status, title, detail };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sillage unreachable.";
    return { ok: false, status: 0, title: "Network error", detail: message };
  }
}

/** Kick off async account-mapping enrichment. Exactly one identifier is sent. */
export async function startAccountMapping(
  apiKey: string,
  identifier: { domain?: string; linkedinUrl?: string; linkedinHandle?: string },
): Promise<SillageResult<{ status: string; requestId: string; stage: string }>> {
  const body: Record<string, string> = {};
  if (identifier.domain) body.domain = identifier.domain;
  if (identifier.linkedinUrl) body.linkedin_url = identifier.linkedinUrl;
  if (identifier.linkedinHandle) body.linkedin_handle = identifier.linkedinHandle;
  const res = await sillageRequest<{ status?: string; request_id?: string; stage?: string }>(
    "/api/v2/enrich-company-mapping",
    apiKey,
    { method: "POST", body, timeoutMs: 15_000 },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    status: res.status,
    data: {
      status: res.data.status ?? "accepted",
      requestId: String(res.data.request_id ?? ""),
      stage: res.data.stage ?? "account_mapping_in_progress",
    },
  };
}

/** Poll the async enrichment job's stage. Terminal stages: completed / account_mapping_failed. */
export async function getMappingStage(apiKey: string, requestId: string): Promise<SillageResult<SillageStage>> {
  const res = await sillageRequest<{
    id?: string;
    type?: string;
    stage?: string;
    created_at?: string;
    updated_at?: string;
    company?: RawCompany;
  }>(`/api/v2/account-mapping/${encodeURIComponent(requestId)}/stage`, apiKey);
  if (!res.ok) return res;
  const r = res.data;
  return {
    ok: true,
    status: res.status,
    data: {
      id: String(r.id ?? requestId),
      type: r.type ?? "",
      stage: r.stage ?? "",
      createdAt: r.created_at ?? "",
      updatedAt: r.updated_at ?? "",
      company: mapCompany(r.company),
    },
  };
}

/** One page of the free, no-credit list-company-mappings endpoint. */
async function listCompanyMappingsPage(
  apiKey: string,
  page: number,
  pageSize: number,
): Promise<SillageResult<{ items: { id: string; company: SillageCompany }[]; hasMore: boolean }>> {
  const res = await sillageRequest<{ data?: { id?: string; company?: RawCompany }[] }>(
    `/api/v2/company-mappings?page=${page}&page_size=${pageSize}`,
    apiKey,
  );
  if (!res.ok) return res;
  const items = (res.data.data ?? []).map((m) => ({ id: String(m.id ?? ""), company: mapCompany(m.company) }));
  // The pagination meta's field names aren't pinned down against live docs — a
  // short page is a more reliable "no more results" signal than guessing a key.
  return { ok: true, status: res.status, data: { items, hasMore: items.length >= pageSize } };
}

/**
 * Resolve a completed mapping's top-level id by matching the enriched company
 * against list-company-mappings (free, no credits consumed). Checks a few pages
 * — most workspaces have few mappings — rather than assuming sort order.
 */
export async function findMappingId(
  apiKey: string,
  company: { id: string; domain: string | null },
  maxPages = 5,
): Promise<SillageResult<string | null>> {
  for (let page = 1; page <= maxPages; page++) {
    const res = await listCompanyMappingsPage(apiKey, page, 25);
    if (!res.ok) return res;
    const match = res.data.items.find(
      (m) => (company.id && m.company.id === company.id) || (company.domain && m.company.domain === company.domain),
    );
    if (match) return { ok: true, status: res.status, data: match.id };
    if (!res.data.hasMore) break;
  }
  return { ok: true, status: 200, data: null };
}

/** Full profile list for a resolved mapping. */
export async function getCompanyMapping(apiKey: string, mappingId: string): Promise<SillageResult<SillageMapping>> {
  const res = await sillageRequest<{
    id?: string;
    company?: RawCompany;
    profiles?: {
      id?: string;
      linkedin_url?: string | null;
      avatar_url?: string | null;
      linkedin_about?: string | null;
      position?: string | null;
      position_start_date?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone_number?: string | null;
      linkedin_headline?: string | null;
      location?: { city?: string | null; region?: string | null; country?: string | null } | null;
    }[];
  }>(`/api/v2/company-mappings/${encodeURIComponent(mappingId)}`, apiKey);
  if (!res.ok) return res;
  const r = res.data;
  const profiles: SillageProfile[] = (r.profiles ?? []).map((p) => ({
    id: String(p.id ?? ""),
    linkedinUrl: p.linkedin_url ?? null,
    avatarUrl: p.avatar_url ?? null,
    about: p.linkedin_about ?? null,
    position: p.position ?? null,
    positionStartDate: p.position_start_date ?? null,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    email: p.email ?? null,
    phone: p.phone_number ?? null,
    headline: p.linkedin_headline ?? null,
    location: p.location
      ? { city: p.location.city ?? null, region: p.location.region ?? null, country: p.location.country ?? null }
      : null,
  }));
  return { ok: true, status: res.status, data: { id: String(r.id ?? mappingId), company: mapCompany(r.company), profiles } };
}

/** Cheap, no-credit connectivity check used by the API-key "Test connection" flow. */
export async function testSillageConnection(apiKey: string): Promise<SillageResult<unknown>> {
  return sillageRequest("/api/v2/contents/query", apiKey, { method: "POST", body: { page_size: 1 }, timeoutMs: 8_000 });
}

/**
 * Resolve this workspace's stored, decrypted Sillage key (service-role read —
 * `secret` is withheld from `authenticated` by column grant, same pattern
 * /api/email/sync uses for email_connections). Returns null when nothing is
 * stored — never accepts a raw key from the caller.
 */
export async function resolveStoredSillageKey(
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
    .eq("provider", "Sillage")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  return decryptSecret(row.secret);
}
