// Real candidate sourcing via the Seamless.AI API. Search (search/contacts) returns
// named profiles with a `searchResultId` but never email/phone. Revealing contact
// details is a separate, explicitly confirmed async step: research/contacts kicks
// off enrichment for one searchResultId (returns a requestId), and
// contacts/research/poll is polled until a terminal status. Auth header is `Token`
// (docs.seamless.ai/authentication — the API-key auth page, not the generic Bearer
// template shown on individual endpoint reference pages).
//
// Field names below (search request/response, research request/response, poll
// response) were confirmed live against docs.seamless.ai/searchcontacts,
// docs.seamless.ai/researchcontacts and docs.seamless.ai/pollcontactsresearchresults
// this session — not guessed. Not live-tested against a real key (none available) —
// callers must read the actual HTTP status/error body Seamless returns and surface
// it honestly rather than assume a guessed envelope.

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";

const SEAMLESS_API = "https://api.seamless.ai/api/client/v1";

export type SeamlessResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; title: string; detail: string };

export interface SeamlessSearchFilters {
  jobTitles?: string[];
  seniorities?: string[];
  departments?: string[];
  industries?: string[];
  countries?: string[];
  states?: string[];
  companyNames?: string[];
  companyDomains?: string[];
}

export interface SeamlessContact {
  /** Seamless's search-result id — required for a later research (reveal) call. */
  searchResultId: string;
  name: string;
  title: string;
  company: string;
  department: string;
  seniority: string;
  domain: string;
  city: string;
  state: string;
  country: string;
  liUrl: string;
}

/** The one enriched-contact shape store.ts needs from a completed research poll —
 *  a trimmed view of Seamless's much larger contact object (job history, funding
 *  signals, etc. aren't needed for a contact-detail reveal). */
export interface SeamlessResearchContact {
  email: string;
  phone: string;
  fullName: string;
}

export interface SeamlessResearchStatus {
  requestId: string;
  /** Raw Seamless status: queued | researching | done | error | missing | duplicate |
   *  "not found" | "contact-already-researched" | "No license or credits available". */
  status: string;
  message: string;
  contact: SeamlessResearchContact | null;
}

function seamlessHeaders(apiKey: string): Record<string, string> {
  return {
    Token: apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Extract a JSON-safe string field from an unknown record, else "". */
function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function toSeamlessContact(raw: Record<string, unknown>): SeamlessContact {
  const first = str(raw, "firstName");
  const last = str(raw, "lastName");
  const name = str(raw, "name").trim() || [first, last].filter(Boolean).join(" ").trim() || "Unknown";
  return {
    searchResultId: str(raw, "searchResultId"),
    name,
    title: str(raw, "title"),
    company: str(raw, "company"),
    department: str(raw, "department"),
    seniority: str(raw, "seniority"),
    domain: str(raw, "domain"),
    city: str(raw, "city"),
    state: str(raw, "state"),
    country: str(raw, "country"),
    liUrl: str(raw, "liUrl"),
  };
}

/**
 * Search Seamless for real people matching the given filters
 * (POST /search/contacts). `count` maps to Seamless's `limit` (no documented
 * max — capped at 100 defensively, same convention as Apollo's per-page cap).
 */
export async function searchSeamlessContacts(
  filters: SeamlessSearchFilters,
  count: number,
  apiKey: string,
): Promise<SeamlessContact[]> {
  const limit = Math.min(Math.max(Math.trunc(count) || 1, 1), 100);
  const body: Record<string, unknown> = { limit };
  if (filters.jobTitles?.length) body.jobTitle = filters.jobTitles;
  if (filters.seniorities?.length) body.seniority = filters.seniorities;
  if (filters.departments?.length) body.department = filters.departments;
  if (filters.industries?.length) body.industry = filters.industries;
  if (filters.countries?.length) body.contactCountry = filters.countries;
  if (filters.states?.length) body.contactState = filters.states;
  if (filters.companyNames?.length) body.companyName = filters.companyNames;
  if (filters.companyDomains?.length) body.companyDomain = filters.companyDomains;

  const res = await fetch(`${SEAMLESS_API}/search/contacts`, {
    method: "POST",
    headers: seamlessHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Seamless search API ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: unknown[] };
  const contacts = Array.isArray(json.data) ? json.data : [];
  return contacts
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map(toSeamlessContact);
}

/**
 * Low-level request wrapper for the research/poll flow — Seamless's error bodies
 * aren't a fixed RFC9457 shape (docs show plain 401/422/500 with a `message` or
 * `error` field), so read whatever the body actually contains rather than assume a
 * field is present.
 */
async function seamlessRequest<T>(
  path: string,
  apiKey: string,
  opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<SeamlessResult<T>> {
  try {
    const res = await fetch(`${SEAMLESS_API}${path}`, {
      method: opts.method ?? "GET",
      headers: seamlessHeaders(apiKey),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const title = typeof json.error === "string" ? json.error : `Seamless API error (${res.status})`;
      const detail =
        typeof json.message === "string" ? json.message : typeof json.detail === "string" ? json.detail : "";
      return { ok: false, status: res.status, title, detail };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Seamless unreachable.";
    return { ok: false, status: 0, title: "Network error", detail: message };
  }
}

/**
 * Kick off async research (contact-detail reveal) for one search result
 * (POST /contacts/research, confirmed live: request body `{ searchResultIds: [] }`,
 * 202 response `{ success, requestIds: [] }`). One searchResultId in, one requestId
 * out — the batch shape (up to 100 ids) exists in the docs but this app's UI is a
 * deliberate single-candidate action, never a batch reveal.
 */
export async function startSeamlessResearch(
  apiKey: string,
  searchResultId: string,
): Promise<SeamlessResult<{ requestId: string }>> {
  const res = await seamlessRequest<{ success?: boolean; requestIds?: string[] }>("/contacts/research", apiKey, {
    method: "POST",
    body: { searchResultIds: [searchResultId] },
    timeoutMs: 15_000,
  });
  if (!res.ok) return res;
  const requestId = res.data.requestIds?.[0];
  if (!requestId) {
    return { ok: false, status: res.status, title: "Seamless research error", detail: "No requestId returned." };
  }
  return { ok: true, status: res.status, data: { requestId } };
}

/**
 * Poll one research request (GET /contacts/research/poll?requestIds=..., confirmed
 * live). Terminal states: "done" (success — contact populated), "error" / "missing" /
 * "duplicate" / "not found" / "contact-already-researched" / "No license or credits
 * available" (failure — no contact). "queued" / "researching" are in-progress.
 */
export async function pollSeamlessResearch(
  apiKey: string,
  requestId: string,
): Promise<SeamlessResult<SeamlessResearchStatus>> {
  const res = await seamlessRequest<{
    success?: boolean;
    data?: { requestId?: string; searchResultId?: string; status?: string; message?: string; contact?: Record<string, unknown> }[];
  }>(`/contacts/research/poll?requestIds=${encodeURIComponent(requestId)}`, apiKey);
  if (!res.ok) return res;
  const result = res.data.data?.[0];
  if (!result) {
    return { ok: false, status: res.status, title: "Seamless poll error", detail: "No result returned for this requestId." };
  }
  const raw = result.contact;
  const contact: SeamlessResearchContact | null = raw
    ? {
        email: str(raw, "email") || str(raw, "personalEmail") || str(raw, "email1"),
        phone: str(raw, "contactPhone1") || str(raw, "contactPhone2"),
        fullName: str(raw, "fullName") || [str(raw, "firstName"), str(raw, "lastName")].filter(Boolean).join(" "),
      }
    : null;
  return {
    ok: true,
    status: res.status,
    data: {
      requestId: result.requestId ?? requestId,
      status: result.status ?? "",
      message: result.message ?? "",
      contact,
    },
  };
}

/**
 * Live "am I authenticated" check via GET /contacts (org-data read) — Seamless
 * documents this as a free endpoint (no research credits used), unlike
 * search/contacts whose credit cost isn't clearly stated. `startDate`/`endDate` are
 * required by the endpoint; a wide range + limit:1 keeps this a cheap connectivity
 * probe. 401 → invalid; 200 → valid; any other response is surfaced honestly.
 * Throws on network/timeout error so the caller can fall back to a format-only check.
 */
export async function checkSeamlessAuth(apiKey: string): Promise<{ valid: boolean; detail: string }> {
  const params = new URLSearchParams({ limit: "1", startDate: "1970-01-01T00:00:00Z", endDate: new Date().toISOString() });
  const res = await fetch(`${SEAMLESS_API}/contacts?${params.toString()}`, {
    method: "GET",
    headers: seamlessHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) {
    return { valid: false, detail: "Seamless rejected the key (401)." };
  }
  if (res.ok) return { valid: true, detail: "Seamless key is valid (live check, no credits used)." };
  return { valid: false, detail: `Seamless returned an unexpected HTTP ${res.status}.` };
}

/**
 * Resolve this workspace's stored, decrypted Seamless key (service-role read —
 * `secret` is withheld from `authenticated` by column grant, same pattern
 * /api/email/sync, Sillage and Apollo use). Returns null when nothing is stored —
 * never accepts a raw key from the caller.
 */
export async function resolveStoredSeamlessKey(
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
    .eq("provider", "Seamless")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.secret || typeof row.secret !== "string") return null;
  return decryptSecret(row.secret);
}
