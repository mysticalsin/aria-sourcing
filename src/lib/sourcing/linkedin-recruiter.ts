// Official LinkedIn Recruiter System Connect. This is a partner API call with
// a bearer token the operator configures. It never logs into linkedin.com,
// never sends cookies, and never calls Voyager or a browser extension.
//
// When the official endpoint is absent, callers keep public LinkedIn search.
// Odoo and SMART are not required for either path.

import { linkedInSourcingRunsWithoutErp } from "@/lib/hire-connector";
import { extractLead, type SearchHit, type WebLead } from "@/lib/sourcing/web-leads";

export const LINKEDIN_RSC_SOURCE = "recruiter-system-connect";

type RecruiterFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface RecruiterProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  location?: string;
  publicProfileUrl?: string;
  summary?: string;
}

export interface RecruiterSourceResult {
  configured: boolean;
  leads: WebLead[];
  error?: string;
}

export function recruiterSystemConnectConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LINKEDIN_RSC_URL && env.LINKEDIN_RSC_TOKEN);
}

function officialEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "linkedin.com" || host === "www.linkedin.com") return false;
    return true;
  } catch {
    return false;
  }
}

function leadFromProfile(profile: RecruiterProfile): WebLead | null {
  const url = (profile.publicProfileUrl ?? "").trim();
  if (!url.startsWith("https://")) return null;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || "Unknown";
  const lead: WebLead = {
    name,
    title: (profile.headline ?? "").trim(),
    company: (profile.company ?? "").trim(),
    url,
    snippet: (profile.summary ?? "").trim().slice(0, 300),
  };
  const location = (profile.location ?? "").trim();
  if (location) lead.location = location.slice(0, 120);
  return lead;
}

/**
 * Search the official Recruiter System Connect endpoint. Returns no leads and
 * does not call the network when the partner URL or token is missing, or when
 * LinkedIn sourcing itself is gated off.
 */
export async function sourceRecruiterSystemConnect(
  input: { query: string; count: number },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: RecruiterFetch = fetch,
): Promise<RecruiterSourceResult> {
  if (!linkedInSourcingRunsWithoutErp(env)) {
    return { configured: recruiterSystemConnectConfigured(env), leads: [] };
  }
  if (!recruiterSystemConnectConfigured(env)) {
    return { configured: false, leads: [] };
  }
  const endpoint = env.LINKEDIN_RSC_URL ?? "";
  const token = env.LINKEDIN_RSC_TOKEN ?? "";
  if (!officialEndpoint(endpoint)) {
    return { configured: true, leads: [], error: "Recruiter System Connect URL must be an official HTTPS API, not a linkedin.com page." };
  }
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), 20);
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source: LINKEDIN_RSC_SOURCE,
      query: input.query,
      count,
    }),
  });
  if (!res.ok) {
    return { configured: true, leads: [], error: `Recruiter System Connect http ${res.status}` };
  }
  const body = (await res.json()) as { elements?: RecruiterProfile[] };
  const leads = (body.elements ?? [])
    .map(leadFromProfile)
    .filter((lead): lead is WebLead => lead !== null);
  return { configured: true, leads };
}

/** Public LinkedIn results plus official RSC when it is configured. */
export async function linkedInLeadsForSearch(
  input: { query: string; count: number; publicHits: SearchHit[] },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: RecruiterFetch = fetch,
): Promise<{ leads: WebLead[]; recruiter: "recruiter-system-connect" | "not-configured"; error?: string }> {
  const publicLeads = input.publicHits.map((hit) => extractLead(hit, "LinkedIn"));
  if (!linkedInSourcingRunsWithoutErp(env)) {
    return { leads: publicLeads, recruiter: "not-configured" };
  }
  const recruiter = await sourceRecruiterSystemConnect(input, env, fetchImpl);
  if (!recruiter.configured) return { leads: publicLeads, recruiter: "not-configured" };
  return {
    leads: [...recruiter.leads, ...publicLeads],
    recruiter: "recruiter-system-connect",
    error: recruiter.error,
  };
}
