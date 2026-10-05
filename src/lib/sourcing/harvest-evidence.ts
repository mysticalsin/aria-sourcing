/**
 * People-first harvest evidence. Safe for client + server.
 * Never put tokens or secrets in these strings or logs.
 */

export const HARVEST_ACTOR = "harvestapi~linkedin-profile-search";
export const HARVEST_ENRICH_ACTOR = "harvestapi~linkedin-profile-scraper";
export const GITHUB_STACK_ACTOR = "apivault_labs~github-profile-scraper";
export const HARVEST_LOG_PREFIX = "[aria-harvest]";
export const ARIA_HARVEST_EVENT = "aria_harvest";
/** User chrome.retry — never an actor-named button. */
export const SOURCE_VIA_APIFY_HREF = "";
export const SOURCE_VIA_APIFY_LABEL = "Source next batch";
export const CONNECT_APIFY_HREF = "/settings";
export const CONNECT_APIFY_LABEL = "Connect Apify";

/** Must cover every planned harvest in one Source click. 90s is 0-and-stop. */
export const PEOPLE_FIRST_CLIENT_WAIT_MS = 360_000;

export const PEOPLE_FIRST_HARVEST_NOT_STARTED = "PEOPLE_FIRST_HARVEST_NOT_STARTED";
export const PEOPLE_FIRST_HARVEST_STILL_RUNNING = "PEOPLE_FIRST_HARVEST_STILL_RUNNING";
export const PEOPLE_FIRST_HARVEST_EMPTY = "PEOPLE_FIRST_HARVEST_EMPTY";
export const PEOPLE_FIRST_HARVEST_ABORTED = "PEOPLE_FIRST_HARVEST_ABORTED";
export const PEOPLE_FIRST_HARVEST_MOCK = "PEOPLE_FIRST_HARVEST_MOCK";
export const PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS = "PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS";
/**
 * The server ran out of chain budget with planned harvests left. The same
 * click re-POSTs with `resume` and the server continues from that step.
 * Not a result, not 0 people, not a second user click.
 */
export const PEOPLE_FIRST_HARVEST_CONTINUE = "PEOPLE_FIRST_HARVEST_CONTINUE";

export type HarvestEvidenceKind =
  | "not_started"
  | "still_running"
  | "empty"
  | "gated_empty"
  | "incomplete_contacts"
  | "aborted"
  | "continue"
  | "mock";

export type HarvestActorName =
  | typeof HARVEST_ACTOR
  | typeof HARVEST_ENRICH_ACTOR
  | typeof GITHUB_STACK_ACTOR
  | string;

export interface HarvestEvidence {
  actor: HarvestActorName;
  query: string;
  runId: string;
  status: string;
  itemCount: number;
  started: boolean;
}

const SECRET_KEY = /^(token|secret|authorization|password|apikey|api_key|apikeyid)$/i;
const SECRET_VALUE = /apify_api_|eyJ[A-Za-z0-9_-]{20,}/;

export function isHarvestEvidenceCode(code: string | null | undefined): boolean {
  return (
    code === PEOPLE_FIRST_HARVEST_NOT_STARTED ||
    code === PEOPLE_FIRST_HARVEST_STILL_RUNNING ||
    code === PEOPLE_FIRST_HARVEST_EMPTY ||
    code === PEOPLE_FIRST_HARVEST_ABORTED ||
    code === PEOPLE_FIRST_HARVEST_MOCK ||
    code === PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS ||
    code === PEOPLE_FIRST_HARVEST_CONTINUE
  );
}

export function formatHarvestEvidenceError(
  kind: HarvestEvidenceKind,
  harvest: Pick<HarvestEvidence, "query"> & Partial<HarvestEvidence>,
  opts?: { startedSearches?: number },
): string {
  const query = harvest.query.trim() || "(missing query)";
  const run = harvest.runId ? ` run=${harvest.runId}` : "";
  const status = harvest.status ? ` status=${harvest.status}` : "";
  const items =
    harvest.itemCount != null && harvest.itemCount >= 0 ? ` items=${harvest.itemCount}` : "";
  const base = `query=${query}${run}${status}${items}`;
  const plannedExhausted = (opts?.startedSearches ?? 0) >= 2;
  const emptyTail = plannedExhausted
    ? "Every planned search was tried. Do not stop at 0 people. Do not invent people."
    : "Next planned search must start now. Do not stop at 0 people. Do not invent people.";
  if (kind === "not_started") {
    return `People-first harvest did not start. ${base}. Source next batch must start a real search.`;
  }
  if (kind === "still_running") {
    return `People-first harvest is still running. ${base}. Do not treat this as 0 people. Retry Source next batch.`;
  }
  if (kind === "aborted") {
    return `People-first harvest aborted after 90s. ${base}. Do not treat this as 0 people. Retry Source next batch.`;
  }
  if (kind === "continue") {
    return `Harvest chain needs another request. ${base}. Next planned search must start now. Do not stop at 0 people. Do not invent people.`;
  }
  if (kind === "mock") {
    return `Apify is in Mock mode. ${base}. Connect a real Apify key and switch the card to Live.`;
  }
  if (kind === "incomplete_contacts") {
    return `People-first harvest returned people without email, phone, and LinkedIn. ${base}. Do not invent contacts. Do not keep name-only rows.`;
  }
  if (kind === "gated_empty") {
    return `Empty harvest is not a result. ${base}. ${emptyTail} Skill-match ≥60 still required.`;
  }
  return `Empty harvest is not a result. ${base}. ${emptyTail}`;
}

function sanitizeHarvestPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === "string" && SECRET_VALUE.test(value)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Same channel as sourcing_loop_tick: JSON on process.stdout, not Next console. */
export function writeAriaHarvestStdout(payload: Record<string, unknown>): void {
  const line = `${JSON.stringify({
    event: ARIA_HARVEST_EVENT,
    tag: HARVEST_LOG_PREFIX,
    ...sanitizeHarvestPayload(payload),
  })}\n`;
  try {
    if (typeof process !== "undefined" && typeof process.stdout?.write === "function") {
      process.stdout.write(line);
    }
  } catch {
    // Logging must never throw or include secrets.
  }
}

export function logAriaHarvest(
  event: string,
  harvest: Partial<HarvestEvidence> & {
    detail?: string;
    campaign?: string;
    apifyKeyPresent?: boolean;
    actorInputField?: string;
    actorSearchQuery?: string;
    nextQuery?: string;
  } = {},
): void {
  writeAriaHarvestStdout({
    phase: event,
    actor: harvest.actor || HARVEST_ACTOR,
    query: harvest.query,
    runId: harvest.runId || undefined,
    status: harvest.status || undefined,
    items: harvest.itemCount != null && harvest.itemCount >= 0 ? harvest.itemCount : undefined,
    started: harvest.started,
    campaign: harvest.campaign,
    apifyKeyPresent: harvest.apifyKeyPresent,
    actorInputField: harvest.actorInputField,
    actorSearchQuery: harvest.actorSearchQuery,
    nextQuery: harvest.nextQuery,
    detail: harvest.detail,
  });
}
