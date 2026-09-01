/**
 * People-first harvest evidence. Safe for client + server.
 * Never put tokens or secrets in these strings or logs.
 */

export const HARVEST_ACTOR = "harvestapi~linkedin-profile-search";
export const HARVEST_LOG_PREFIX = "[aria-harvest]";
export const ARIA_HARVEST_EVENT = "aria_harvest";
export const SOURCE_VIA_APIFY_HREF = "#source-apify";
export const SOURCE_VIA_APIFY_LABEL = "Source via Apify";
export const CONNECT_APIFY_HREF = "/settings";
export const CONNECT_APIFY_LABEL = "Connect Apify";

export const PEOPLE_FIRST_CLIENT_WAIT_MS = 90_000;

export const PEOPLE_FIRST_HARVEST_NOT_STARTED = "PEOPLE_FIRST_HARVEST_NOT_STARTED";
export const PEOPLE_FIRST_HARVEST_STILL_RUNNING = "PEOPLE_FIRST_HARVEST_STILL_RUNNING";
export const PEOPLE_FIRST_HARVEST_EMPTY = "PEOPLE_FIRST_HARVEST_EMPTY";
export const PEOPLE_FIRST_HARVEST_ABORTED = "PEOPLE_FIRST_HARVEST_ABORTED";
export const PEOPLE_FIRST_HARVEST_MOCK = "PEOPLE_FIRST_HARVEST_MOCK";

export type HarvestEvidenceKind = "not_started" | "still_running" | "empty" | "gated_empty" | "aborted" | "mock";

export interface HarvestEvidence {
  actor: typeof HARVEST_ACTOR;
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
    code === PEOPLE_FIRST_HARVEST_MOCK
  );
}

export function formatHarvestEvidenceError(
  kind: HarvestEvidenceKind,
  harvest: Pick<HarvestEvidence, "query"> & Partial<HarvestEvidence>,
): string {
  const query = harvest.query.trim() || "(missing query)";
  const run = harvest.runId ? ` run=${harvest.runId}` : "";
  const status = harvest.status ? ` status=${harvest.status}` : "";
  const items =
    harvest.itemCount != null && harvest.itemCount >= 0 ? ` items=${harvest.itemCount}` : "";
  const base = `actor=${HARVEST_ACTOR} query=${query}${run}${status}${items}`;
  if (kind === "not_started") {
    return `People-first harvest did not start. ${base}. Source next batch must start a harvestapi Full run.`;
  }
  if (kind === "still_running") {
    return `People-first harvest is still running. ${base}. Do not treat this as 0 people. Retry or open Source via Apify.`;
  }
  if (kind === "aborted") {
    return `People-first harvest aborted after 90s. ${base}. Do not treat this as 0 people. Retry Source next batch.`;
  }
  if (kind === "mock") {
    return `Apify is in Mock mode. ${base}. Connect a real Apify key and switch the card to Live.`;
  }
  if (kind === "gated_empty") {
    return `People-first harvest returned profiles that did not meet skill-match ≥60. ${base}. Try Source via Apify with a narrower query.`;
  }
  return `People-first harvest returned 0 profiles. ${base}. Try Source via Apify with a narrower query.`;
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
  harvest: Partial<HarvestEvidence> & { detail?: string; campaign?: string; apifyKeyPresent?: boolean } = {},
): void {
  writeAriaHarvestStdout({
    phase: event,
    actor: HARVEST_ACTOR,
    query: harvest.query,
    runId: harvest.runId || undefined,
    status: harvest.status || undefined,
    items: harvest.itemCount != null && harvest.itemCount >= 0 ? harvest.itemCount : undefined,
    started: harvest.started,
    campaign: harvest.campaign,
    apifyKeyPresent: harvest.apifyKeyPresent,
    detail: harvest.detail,
  });
}
