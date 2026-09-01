// Real candidate sourcing via Apify's harvestapi/linkedin-profile-search actor
// ("LinkedIn Profile Search Scraper — No Cookies"). SERVER ONLY: called from
// /api/source/apify/{start,status} with a workspace's stored, decrypted Apify
// token — the token never reaches the browser.
//
// This is third-party public-profile data bought from a vendor API. The app
// performs no direct LinkedIn login, scraping, or session automation of its
// own — no recruiter cookies, no headless browser against linkedin.com, no
// session reuse. Enrichment is asynchronous, mirroring the Sillage account-
// mapping flow: POST .../runs starts the actor and returns a runId +
// datasetId, which the caller polls via getRunStatus() until a terminal
// status (SUCCEEDED / FAILED / TIMED-OUT / ABORTED), then fetches the
// dataset's items via fetchDatasetItems(). A real result is authoritative
// even at zero hits — this module never fabricates a profile.
//
// The candidate-mapping (Candidate shape + scoring + dedupe) step lives in
// sourcing-helpers.ts, not here — this module returns raw Apify data only,
// mirroring how sourcing/sillage.ts stays a thin API client.

import type { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto-secrets";
import { sourcingFetch, type ProviderClearance } from "@/lib/sourcing/provider-transport";

import { HARVEST_ACTOR, logAriaHarvest, type HarvestEvidence } from "@/lib/sourcing/harvest-evidence";
import { providerIsApify } from "@/lib/sourcing/people-connect";

const APIFY_API = "https://api.apify.com/v2";
const ACTOR_PATH = "/actors/harvestapi~linkedin-profile-search/runs";
const DEV_FUSION_PATH = "/actors/dev_fusion~linkedin-profile-scraper/run-sync-get-dataset-items";

/** Poll until terminal. Align with the 90s people-first client wait. Do not stamp 0 on a still-running actor. */
export const APIFY_HARVEST_WAIT_MS = 90_000;
export const APIFY_HARVEST_WAIT_CAP_MS = 90_000;

// Actor input is capped server-side regardless of what the caller requests —
// this is the single funnel every Apify run goes through.
const MAX_ITEMS_CEILING = 50;

export type ApifyResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; title: string; detail: string };

/* ---- Actor input ---------------------------------------------------------- */

export interface ApifyProfileSearchInput {
  searchQuery?: string;
  profileScraperMode?: "Short" | "Full" | "Full + email search";
  maxItems?: number;
  takePages?: number;
  startPage?: number;
  locations?: string[];
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  currentCompanies?: string[];
  pastCompanies?: string[];
  schools?: string[];
  firstNames?: string[];
  lastNames?: string[];
}

/* ---- Actor output (cleaned/normalized) ------------------------------------ */

export interface ApifyLocation {
  text: string;
  countryCode: string | null;
}

/** currentPosition/currentPositions and experience entries all normalize to this shape. */
export interface ApifyPosition {
  title: string;
  companyName: string;
  dateRange: string;
}

export interface ApifyExperience {
  title: string;
  companyName: string;
  dateRange: string;
}

export interface ApifyEducation {
  schoolName: string;
  degree: string;
  dateRange: string;
}

export interface ApifyProfile {
  id: string;
  publicIdentifier: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string;
  about: string;
  location: ApifyLocation | null;
  connectionsCount: number | null;
  followerCount: number | null;
  currentPosition: ApifyPosition[];
  experience: ApifyExperience[];
  education: ApifyEducation[];
  topSkills: string[];
  skills: string[];
  languages: string[];
  openToWork: boolean;
  hiring: boolean;
  premium: boolean;
  email: string | null;
  phone: string | null;
}

/* ---- Raw actor output (harvestapi/linkedin-profile-search, as observed live)
 *
 * The actor has two live response shapes depending on profileScraperMode:
 *  - "Full" / "Full + email search": headline/about/skills/emails/
 *    publicIdentifier are present; currentPosition is an array sharing the
 *    SAME item shape as experience (position/companyName/duration/startDate/
 *    endDate); linkedinUrl is the clean vanity url.
 *  - "Short": cheap discovery mode. No headline/about/skills/emails/
 *    publicIdentifier. currentPositions (plural) uses a different item shape
 *    (title/tenureAtPosition/startedOn); linkedinUrl is the obfuscated urn
 *    form (e.g. https://www.linkedin.com/in/ACwAAB...).
 * mapProfile() below is defensive across both and never throws on a missing
 * field, mirroring sourcing/sillage.ts's mapping style.
 */

interface RawApifyDate {
  month?: string | null;
  year?: number | null;
  text?: string | null;
}

interface RawApifyEmail {
  email?: string | null;
  deliverable?: boolean | null;
  catchAllDomain?: boolean | null;
  validEmailServer?: boolean | null;
  free?: boolean | null;
  status?: string | null;
  qualityScore?: number | null;
}

interface RawApifyPhone {
  phone?: string | null;
  phoneNumber?: string | null;
  number?: string | null;
}

interface RawApifySkill {
  name?: string | null;
  endorsements?: string | number | null;
}

/** topSkills items are sometimes bare strings, sometimes {name} objects. */
type RawApifyTopSkill = string | { name?: string | null };

interface RawApifyLanguage {
  name?: string | null;
  proficiency?: string | null;
}

/** currentPosition (Full) and experience entries share this item shape. */
interface RawApifyExperienceItem {
  position?: string | null;
  companyName?: string | null;
  duration?: string | null;
  startDate?: RawApifyDate | null;
  endDate?: RawApifyDate | null;
}

/** currentPositions (Short, plural) uses a different item shape. */
interface RawApifyShortPosition {
  title?: string | null;
  companyName?: string | null;
  tenureAtPosition?: { numYears?: number | null; numMonths?: number | null } | null;
  startedOn?: { month?: number | null; year?: number | null } | null;
  current?: boolean | null;
}

interface RawApifyEducationItem {
  schoolName?: string | null;
  degree?: string | null;
  period?: string | null;
}

interface RawApifyLocation {
  linkedinText?: string | null;
  countryCode?: string | null;
  parsed?: { countryCode?: string | null } | null;
}

interface RawApifyProfile {
  id?: string;
  publicIdentifier?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  emails?: RawApifyEmail[] | null;
  phones?: RawApifyPhone[] | null;
  phoneNumbers?: RawApifyPhone[] | null;
  phone?: string | null;
  mobileNumber?: string | null;
  location?: RawApifyLocation | null;
  connectionsCount?: number;
  followerCount?: number;
  currentPosition?: RawApifyExperienceItem[] | null;
  currentPositions?: RawApifyShortPosition[] | null;
  experience?: RawApifyExperienceItem[] | null;
  education?: RawApifyEducationItem[] | null;
  topSkills?: RawApifyTopSkill[] | null;
  skills?: RawApifySkill[] | null;
  languages?: RawApifyLanguage[] | null;
  openToWork?: boolean;
  hiring?: boolean;
  premium?: boolean;
}

/** First emails[] item that's confirmed deliverable, else the first item, else none. */
function deriveEmail(emails?: RawApifyEmail[] | null): string | null {
  if (!Array.isArray(emails) || emails.length === 0) return null;
  const confirmed = emails.find((e) => e?.status === "valid" || e?.deliverable === true);
  return (confirmed ?? emails[0])?.email ?? null;
}

function phoneValue(row: RawApifyPhone | string | null | undefined): string | null {
  if (typeof row === "string") {
    const trimmed = row.trim();
    return trimmed || null;
  }
  const raw = row?.phone ?? row?.phoneNumber ?? row?.number ?? "";
  const trimmed = raw.trim();
  return trimmed || null;
}

/** First harvestapi phone that looks real. Never invent a number. */
function derivePhone(profile: RawApifyProfile): string | null {
  const listed = [...(profile.phones ?? []), ...(profile.phoneNumbers ?? [])]
    .map(phoneValue)
    .filter((value): value is string => Boolean(value));
  const singles = [profile.phone, profile.mobileNumber]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  return listed[0] ?? singles[0] ?? null;
}

function skillNames(skills?: RawApifySkill[] | null): string[] {
  if (!Array.isArray(skills)) return [];
  return skills.map((s) => s?.name ?? "").filter(Boolean);
}

function topSkillNames(topSkills?: RawApifyTopSkill[] | null): string[] {
  if (!Array.isArray(topSkills)) return [];
  return topSkills.map((t) => (typeof t === "string" ? t : t?.name ?? "")).filter(Boolean);
}

function languageNames(languages?: RawApifyLanguage[] | null): string[] {
  if (!Array.isArray(languages)) return [];
  return languages.map((l) => l?.name ?? "").filter(Boolean);
}

/** startDate.text + endDate.text when either is present, else the free-text duration. */
function experienceDateRange(item: RawApifyExperienceItem): string {
  const start = item.startDate?.text ?? "";
  const end = item.endDate?.text ?? "";
  if (start || end) return [start, end].filter(Boolean).join(" - ");
  return item.duration ?? "";
}

function mapExperienceItem(item: RawApifyExperienceItem): ApifyPosition {
  return { title: item.position ?? "", companyName: item.companyName ?? "", dateRange: experienceDateRange(item) };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startedOnLabel(startedOn?: { month?: number | null; year?: number | null } | null): string {
  const year = startedOn?.year;
  if (!year) return "";
  const month = startedOn?.month;
  const name = month && month >= 1 && month <= 12 ? SHORT_MONTHS[month - 1] : null;
  return name ? `${name} ${year}` : String(year);
}

function tenureLabel(tenure?: { numYears?: number | null; numMonths?: number | null } | null): string {
  const years = tenure?.numYears ?? 0;
  const months = tenure?.numMonths ?? 0;
  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  if (months) parts.push(`${months} mo${months === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Short mode's currentPositions item, normalized to the same ApifyPosition shape. */
function mapShortPosition(item: RawApifyShortPosition): ApifyPosition {
  const start = startedOnLabel(item.startedOn);
  const tenure = tenureLabel(item.tenureAtPosition);
  let dateRange = "";
  if (item.current) dateRange = start ? `${start} - Present` : "Present";
  else if (start && tenure) dateRange = `${start} (${tenure})`;
  else dateRange = start || tenure;
  return { title: item.title ?? "", companyName: item.companyName ?? "", dateRange };
}

function mapEducationItem(item: RawApifyEducationItem): ApifyEducation {
  return { schoolName: item.schoolName ?? "", degree: item.degree ?? "", dateRange: item.period ?? "" };
}

function mapProfile(p: RawApifyProfile): ApifyProfile {
  // Full mode carries currentPosition (singular key, array value); Short mode
  // carries currentPositions (plural) with a different item shape instead.
  const currentPosition: ApifyPosition[] = p.currentPosition?.length
    ? p.currentPosition.map(mapExperienceItem)
    : (p.currentPositions ?? []).map(mapShortPosition);

  return {
    id: String(p.id ?? ""),
    publicIdentifier: p.publicIdentifier ?? "",
    linkedinUrl: p.linkedinUrl ?? "",
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    headline: p.headline ?? "",
    about: p.about ?? "",
    location: p.location
      ? {
          text: p.location.linkedinText ?? "",
          countryCode: p.location.countryCode ?? p.location.parsed?.countryCode ?? null,
        }
      : null,
    connectionsCount: p.connectionsCount ?? null,
    followerCount: p.followerCount ?? null,
    currentPosition,
    experience: (p.experience ?? []).map(mapExperienceItem),
    education: (p.education ?? []).map(mapEducationItem),
    topSkills: topSkillNames(p.topSkills),
    skills: skillNames(p.skills),
    languages: languageNames(p.languages),
    openToWork: p.openToWork ?? false,
    hiring: p.hiring ?? false,
    premium: p.premium ?? false,
    email: deriveEmail(p.emails),
    phone: derivePhone(p),
  };
}

/**
 * Exact harvestapi actor JSON. The field is `searchQuery` (keywords AND),
 * not `keywords`, `q`, or the LinkedIn boolean. Planned tokens must equal
 * this string or the harvest diverged before Apify ran.
 */
export function harvestapiActorInput(input: ApifyProfileSearchInput): Record<string, unknown> {
  return buildActorInput(input);
}

/** Send only the actor input fields the caller actually set. */
function buildActorInput(input: ApifyProfileSearchInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.searchQuery) body.searchQuery = input.searchQuery;
  if (input.profileScraperMode) body.profileScraperMode = input.profileScraperMode;
  if (input.maxItems !== undefined) body.maxItems = Math.min(input.maxItems, MAX_ITEMS_CEILING);
  if (input.takePages !== undefined) body.takePages = input.takePages;
  if (input.startPage !== undefined) body.startPage = input.startPage;
  if (input.locations?.length) body.locations = input.locations;
  if (input.currentJobTitles?.length) body.currentJobTitles = input.currentJobTitles;
  if (input.pastJobTitles?.length) body.pastJobTitles = input.pastJobTitles;
  if (input.currentCompanies?.length) body.currentCompanies = input.currentCompanies;
  if (input.pastCompanies?.length) body.pastCompanies = input.pastCompanies;
  if (input.schools?.length) body.schools = input.schools;
  if (input.firstNames?.length) body.firstNames = input.firstNames;
  if (input.lastNames?.length) body.lastNames = input.lastNames;
  return body;
}

/**
 * Low-level request wrapper. Apify wraps successful bodies as { data: ... }
 * and errors as { error: { type, message } } — read whatever the body
 * actually contains rather than assume a field is present, and surface it
 * honestly to the caller. Never logs the token.
 */
async function apifyRequest<T>(
  clearance: ProviderClearance,
  path: string,
  token: string,
  opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<ApifyResult<T>> {
  try {
    const res = await sourcingFetch(clearance, `${APIFY_API}${path}`, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const obj = (json && typeof json === "object" ? json : {}) as { error?: { type?: string; message?: string } };
      const title = typeof obj.error?.type === "string" ? obj.error.type : `Apify API error (${res.status})`;
      const detail = typeof obj.error?.message === "string" ? obj.error.message : "";
      return { ok: false, status: res.status, title, detail };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apify unreachable.";
    return { ok: false, status: 0, title: "Network error", detail: message };
  }
}

interface RawRunEnvelope {
  data?: { id?: string; defaultDatasetId?: string; status?: string };
}

/** Start the actor run. Async — the caller polls getRunStatus() for completion. */
export async function startProfileSearchRun(
  clearance: ProviderClearance,
  token: string,
  input: ApifyProfileSearchInput,
): Promise<ApifyResult<{ runId: string; datasetId: string; status: string }>> {
  const body = harvestapiActorInput(input);
  const planned = (input.searchQuery ?? "").trim();
  const sent = typeof body.searchQuery === "string" ? body.searchQuery.trim() : "";
  logAriaHarvest("actor_input", {
    query: planned,
    actorInputField: "searchQuery",
    actorSearchQuery: sent,
    detail: sent === planned ? "actor_input_matches_planned" : "actor_input_diverges",
  });
  const res = await apifyRequest<RawRunEnvelope>(clearance, ACTOR_PATH, token, { method: "POST", body, timeoutMs: 15_000 });
  if (!res.ok) return res;
  const r = res.data.data ?? {};
  return {
    ok: true,
    status: res.status,
    data: { runId: String(r.id ?? ""), datasetId: String(r.defaultDatasetId ?? ""), status: r.status ?? "READY" },
  };
}

interface RawStatusEnvelope {
  data?: { status?: string };
}

/** Poll the async run's status. Terminal: SUCCEEDED / FAILED / TIMED-OUT / ABORTED. */
export async function getRunStatus(
  clearance: ProviderClearance,
  token: string,
  runId: string,
): Promise<ApifyResult<{ status: string }>> {
  const res = await apifyRequest<RawStatusEnvelope>(clearance, `/actor-runs/${encodeURIComponent(runId)}`, token, {
    timeoutMs: 15_000,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: { status: res.data.data?.status ?? "READY" } };
}

/** Fetch a completed run's dataset items, normalized into ApifyProfile[]. */
export async function fetchDatasetItems(
  clearance: ProviderClearance,
  token: string,
  datasetId: string,
  limit: number,
): Promise<ApifyResult<ApifyProfile[]>> {
  const res = await apifyRequest<RawApifyProfile[]>(
    clearance,
    `/datasets/${encodeURIComponent(datasetId)}/items?format=json&limit=${encodeURIComponent(String(limit))}`,
    token,
    { timeoutMs: 30_000 },
  );
  if (!res.ok) return res;
  const items = Array.isArray(res.data) ? res.data : [];
  return { ok: true, status: res.status, data: items.map(mapProfile) };
}

const TERMINAL_FAIL = new Set(["FAILED", "TIMED-OUT", "ABORTED", "TIMED_OUT"]);
const TERMINAL_OK = "SUCCEEDED";

export type ApifyHarvestWaitResult =
  | { ok: true; status: number; data: ApifyProfile[]; harvest: HarvestEvidence }
  | { ok: false; status: number; title: string; detail: string; harvest: HarvestEvidence };

function harvestMeta(
  query: string,
  patch: Partial<HarvestEvidence> = {},
): HarvestEvidence {
  return {
    actor: HARVEST_ACTOR,
    query,
    runId: patch.runId ?? "",
    status: patch.status ?? "",
    itemCount: patch.itemCount ?? -1,
    started: patch.started ?? false,
  };
}

/** Start harvestapi search and poll until terminal. Used by search_candidates. */
export async function runProfileSearchAndWait(
  clearance: ProviderClearance,
  token: string,
  input: ApifyProfileSearchInput,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ApifyHarvestWaitResult> {
  const query = (input.searchQuery ?? "").trim();
  const started = await startProfileSearchRun(clearance, token, input);
  if (!started.ok) {
    const harvest = harvestMeta(query, { started: false, status: "NOT_STARTED" });
    logAriaHarvest("not_started", { ...harvest, detail: started.title });
    return { ...started, harvest };
  }
  const { runId, datasetId } = started.data;
  if (!runId || !datasetId) {
    const harvest = harvestMeta(query, { started: false, status: "MISSING_IDS" });
    logAriaHarvest("not_started", harvest);
    return { ok: false, status: 0, title: "Apify run missing ids", detail: "", harvest };
  }
  const harvestStart = harvestMeta(query, {
    runId,
    status: started.data.status || "READY",
    started: true,
  });
  logAriaHarvest("started", harvestStart);
  const deadline =
    Date.now() + Math.min(Math.max(opts?.timeoutMs ?? APIFY_HARVEST_WAIT_MS, 4_000), APIFY_HARVEST_WAIT_CAP_MS);
  let lastState = harvestStart.status;
  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) {
      const harvest = harvestMeta(query, { runId, status: lastState || "ABORTED", started: true });
      logAriaHarvest("still_running", { ...harvest, detail: "signal aborted" });
      return { ok: false, status: 0, title: "Apify search still running", detail: lastState, harvest };
    }
    const status = await getRunStatus(clearance, token, runId);
    if (!status.ok) {
      const harvest = harvestMeta(query, { runId, status: lastState || "STATUS_FAILED", started: true });
      logAriaHarvest("status_failed", { ...harvest, detail: status.title });
      return { ...status, harvest };
    }
    lastState = status.data.status.toUpperCase();
    if (lastState === TERMINAL_OK) {
      const items = await fetchDatasetItems(clearance, token, datasetId, input.maxItems ?? 8);
      if (!items.ok) {
        const harvest = harvestMeta(query, { runId, status: lastState, started: true });
        logAriaHarvest("dataset_failed", { ...harvest, detail: items.title });
        return { ...items, harvest };
      }
      const harvest = harvestMeta(query, {
        runId,
        status: lastState,
        itemCount: items.data.length,
        started: true,
      });
      logAriaHarvest("succeeded", harvest);
      return { ok: true, status: items.status, data: items.data, harvest };
    }
    if (TERMINAL_FAIL.has(lastState)) {
      const harvest = harvestMeta(query, { runId, status: lastState, itemCount: 0, started: true });
      logAriaHarvest("terminal_fail", harvest);
      return { ok: false, status: status.status, title: `Apify run ${lastState}`, detail: "", harvest };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  const lateStatus = await getRunStatus(clearance, token, runId);
  if (lateStatus.ok) lastState = lateStatus.data.status.toUpperCase();
  if (lateStatus.ok && lastState === TERMINAL_OK) {
    const items = await fetchDatasetItems(clearance, token, datasetId, input.maxItems ?? 8);
    if (items.ok) {
      const harvest = harvestMeta(query, {
        runId,
        status: lastState,
        itemCount: items.data.length,
        started: true,
      });
      logAriaHarvest("succeeded", harvest);
      return { ok: true, status: items.status, data: items.data, harvest };
    }
  }
  if (lateStatus.ok && TERMINAL_FAIL.has(lastState)) {
    const harvest = harvestMeta(query, { runId, status: lastState, itemCount: 0, started: true });
    logAriaHarvest("terminal_fail", harvest);
    return { ok: false, status: lateStatus.status, title: `Apify run ${lastState}`, detail: "", harvest };
  }
  const harvest = harvestMeta(query, {
    runId,
    status: lastState || "RUNNING",
    started: true,
  });
  logAriaHarvest("still_running", harvest);
  return {
    ok: false,
    status: 0,
    title: "Apify search still running",
    detail: harvest.status,
    harvest,
  };
}

/** Cheap, no-run connectivity check used by the API-key "Test connection" flow. */
export async function testApifyConnection(clearance: ProviderClearance, token: string): Promise<ApifyResult<unknown>> {
  return apifyRequest(clearance, "/users/me", token, { timeoutMs: 8_000 });
}

/**
 * dev_fusion (Apify family) — URL-in, full-profile-out LinkedIn enrichment, used
 * by the unified enrichment orchestrator (enrichment/runners.ts) to enrich a
 * candidate discovered by ANY provider as long as it has a `linkedinUrl`.
 * Unlike harvestapi/linkedin-profile-search (async run + poll + fetch-dataset),
 * run-sync-get-dataset-items runs the actor and returns the dataset's items
 * directly in one call — same response shape as fetchDatasetItems's endpoint
 * (a plain JSON array), so it reuses the same `mapProfile` normalization.
 *
 * dev_fusion is a "full permission" actor: an Apify account that hasn't
 * approved it yet gets a 403 with `error.type` "full-permission-actor-not-
 * approved". That's remapped here to a distinct `title: "not_approved"` (kept
 * separate from a generic error) so the runner can surface a graceful "needs
 * owner approval" not_configured state instead of a hard failure.
 */
export async function enrichProfilesByUrl(
  clearance: ProviderClearance,
  token: string,
  urls: string[],
): Promise<ApifyResult<ApifyProfile[]>> {
  const profileUrls = urls.map((u) => u.trim()).filter(Boolean);
  if (profileUrls.length === 0) return { ok: true, status: 200, data: [] };
  const res = await apifyRequest<RawApifyProfile[]>(clearance, DEV_FUSION_PATH, token, {
    method: "POST",
    body: { profileUrls },
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    if (res.status === 403 && res.title === "full-permission-actor-not-approved") {
      return { ok: false, status: res.status, title: "not_approved", detail: res.detail };
    }
    return res;
  }
  const items = Array.isArray(res.data) ? res.data : [];
  return { ok: true, status: res.status, data: items.map(mapProfile) };
}

/**
 * Resolve this workspace's stored, decrypted Apify key (service-role read —
 * `secret` is withheld from `authenticated` by column grant, same pattern
 * /api/email/sync uses for email_connections). Returns null when nothing is
 * stored — never accepts a raw key from the caller.
 */
export async function resolveStoredApifyKey(
  session: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
): Promise<string | null> {
  const svc = getServiceSupabase();
  if (!svc) return null;
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: rows } = await svc
    .from("api_keys")
    .select("secret, provider")
    .eq("workspace_id", wid)
    .order("created_at", { ascending: false })
    .limit(20);
  const row = (rows ?? []).find(
    (item) =>
      providerIsApify(String(item.provider ?? "")) &&
      typeof item.secret === "string" &&
      item.secret.length > 0,
  );
  if (!row?.secret || typeof row.secret !== "string") return null;
  return decryptSecret(row.secret);
}

export async function resolveStoredApifyKeyForWorkspace(workspaceId: string): Promise<string | null> {
  const svc = getServiceSupabase();
  if (!svc) return null;
  const { data: rows } = await svc
    .from("api_keys")
    .select("secret, provider")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);
  const row = (rows ?? []).find(
    (item) =>
      providerIsApify(String(item.provider ?? "")) &&
      typeof item.secret === "string" &&
      item.secret.length > 0,
  );
  if (!row?.secret || typeof row.secret !== "string") return null;
  return decryptSecret(row.secret);
}
