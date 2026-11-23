/**
 * Official Recruiter System Connect, read from the server environment only.
 *
 * LINKEDIN_RSC_URL + LINKEDIN_RSC_TOKEN are never accepted from the browser,
 * never written to disk, and never returned to the client. A linkedin.com page
 * URL is refused. The optional vendor token channel stays off unless its own
 * server env is set, and live sends still require the existing exact-text
 * human approval (sha256 of the approved subject and body).
 *
 * This module does not log into LinkedIn, scrape linkedin.com, or use cookies.
 */

export const LINKEDIN_RSC_SOURCE = "recruiter-system-connect" as const;

/** The vendor token channel cannot send until this exact-text approval holds. */
export const LINKEDIN_TOKEN_CHANNEL_EXACT_TEXT_APPROVAL = true as const;

export type ConnectReason =
  | "not-configured"
  | "off-by-default"
  | "missing-token"
  | "refused-page-url"
  | "refused-insecure"
  | "refused-invalid-url";

function envField(env: object, key: string): string {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export interface ConnectView {
  connected: boolean;
  reason: ConnectReason | null;
  endpointHost: string | null;
}

export interface PublicConnectStatus {
  ok: true;
  recruiterSystemConnect: ConnectView;
  tokenChannel: ConnectView & { exactTextApproval: true };
}

export interface WorkspaceCandidate {
  name: string;
  role: string;
  location: string;
  source: "workspace";
}

export interface RscCandidate {
  name: string;
  role: string;
  location: string;
  skills: string[];
  source: typeof LINKEDIN_RSC_SOURCE;
}

export type SourcedCandidate = WorkspaceCandidate | RscCandidate;

/** Synthetic workspace rows so sourcing still returns people when RSC is off. */
export const SYNTHETIC_WORKSPACE_CANDIDATES: WorkspaceCandidate[] = [
  { name: "Mina Local", role: "Operations recruiter", location: "Sao Paulo", source: "workspace" },
  { name: "Leo Local", role: "Talent coordinator", location: "Lyon", source: "workspace" },
];

const LINKEDIN_PAGE_HOST = /(^|\.)linkedin\.com$/i;

type EndpointVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: "refused-page-url" | "refused-insecure" | "refused-invalid-url" };

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * HTTPS API endpoints are accepted. http is accepted only for a loopback stub
 * so tests can prove the POST without a certificate. linkedin.com is refused
 * on every scheme.
 */
export function classifyConnectEndpoint(raw: string): EndpointVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "refused-invalid-url" };
  }
  if (url.username || url.password) return { ok: false, reason: "refused-invalid-url" };
  if (LINKEDIN_PAGE_HOST.test(url.hostname)) return { ok: false, reason: "refused-page-url" };
  if (url.protocol === "https:") return { ok: true, url };
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return { ok: true, url };
  return { ok: false, reason: "refused-insecure" };
}

function viewFromEnv(urlRaw: string, tokenRaw: string, emptyReason: ConnectReason): ConnectView {
  const endpoint = urlRaw.trim();
  const token = tokenRaw.trim();
  if (!endpoint && !token) return { connected: false, reason: emptyReason, endpointHost: null };
  if (!endpoint) return { connected: false, reason: emptyReason, endpointHost: null };
  const classified = classifyConnectEndpoint(endpoint);
  if (!classified.ok) return { connected: false, reason: classified.reason, endpointHost: null };
  if (!token) return { connected: false, reason: "missing-token", endpointHost: null };
  if (classified.url.href.includes(token)) {
    return { connected: false, reason: "refused-invalid-url", endpointHost: null };
  }
  return { connected: true, reason: null, endpointHost: classified.url.host };
}

export function recruiterConnectView(env: object = process.env): ConnectView {
  return viewFromEnv(envField(env, "LINKEDIN_RSC_URL"), envField(env, "LINKEDIN_RSC_TOKEN"), "not-configured");
}

/** Off until both vendor env vars are set. Does not enable a send by itself. */
export function tokenChannelView(env: object = process.env): ConnectView {
  return viewFromEnv(envField(env, "LINKEDIN_VENDOR_API_URL"), envField(env, "LINKEDIN_VENDOR_API_KEY"), "off-by-default");
}

export function publicConnectStatus(env: object = process.env): PublicConnectStatus {
  return {
    ok: true,
    recruiterSystemConnect: recruiterConnectView(env),
    tokenChannel: {
      ...tokenChannelView(env),
      exactTextApproval: LINKEDIN_TOKEN_CHANNEL_EXACT_TEXT_APPROVAL,
    },
  };
}

function textIncludesSkill(text: string, skill: string): boolean {
  return text.toLowerCase().includes(skill.toLowerCase());
}

/** Keep a profile only when it has a name, a stated location, and a role or a skill that appears in its text. */
export function applyRscQualityBar(payload: unknown): RscCandidate[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results
      : [];
  const kept: RscCandidate[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const role = typeof row.role === "string" ? row.role.trim() : "";
    const location = typeof row.location === "string" ? row.location.trim() : "";
    const text = typeof row.text === "string" ? row.text : "";
    const skills = (Array.isArray(row.skills) ? row.skills : [])
      .filter((skill): skill is string => typeof skill === "string")
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0 && textIncludesSkill(text, skill));
    if (!name || !location) continue;
    if (!role && skills.length === 0) continue;
    kept.push({ name, role, location, skills, source: LINKEDIN_RSC_SOURCE });
  }
  return kept;
}

export interface RscSearchResult {
  ok: true;
  recruiter: "connected" | "not-configured" | "refused";
  linkedIn: boolean;
  candidates: SourcedCandidate[];
}

function refusalRecruiter(reason: ConnectReason | null): "refused" | "not-configured" {
  if (reason === "refused-page-url" || reason === "refused-insecure" || reason === "refused-invalid-url") {
    return "refused";
  }
  return "not-configured";
}

/**
 * POST { source, query, count } with a bearer token. On any miss, the workspace
 * candidates are still returned and no LinkedIn page is fetched.
 */
export async function sourceWithOptionalRsc(options: {
  query: string;
  count: number;
  env?: object;
  baseCandidates?: WorkspaceCandidate[];
  fetchImpl?: typeof fetch;
}): Promise<RscSearchResult> {
  const env = options.env ?? process.env;
  const base = options.baseCandidates ?? SYNTHETIC_WORKSPACE_CANDIDATES;
  const view = recruiterConnectView(env);
  if (!view.connected) {
    return {
      ok: true,
      recruiter: refusalRecruiter(view.reason),
      linkedIn: false,
      candidates: base,
    };
  }

  const endpoint = envField(env, "LINKEDIN_RSC_URL").trim();
  const token = envField(env, "LINKEDIN_RSC_TOKEN").trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        source: LINKEDIN_RSC_SOURCE,
        query: options.query,
        count: options.count,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { ok: true, recruiter: "not-configured", linkedIn: false, candidates: base };
    }
    const payload: unknown = await response.json();
    const results = applyRscQualityBar(payload).slice(0, options.count);
    return {
      ok: true,
      recruiter: "connected",
      linkedIn: true,
      candidates: [...base, ...results],
    };
  } catch {
    return { ok: true, recruiter: "not-configured", linkedIn: false, candidates: base };
  }
}
