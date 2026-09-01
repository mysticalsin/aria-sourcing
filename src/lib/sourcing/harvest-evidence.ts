/**
 * People-first harvest evidence. Safe for client + server.
 * Never put tokens or secrets in these strings or logs.
 */

export const HARVEST_ACTOR = "harvestapi~linkedin-profile-search";
export const HARVEST_LOG_PREFIX = "[aria-harvest]";
export const SOURCE_VIA_APIFY_HREF = "#source-apify";
export const SOURCE_VIA_APIFY_LABEL = "Source via Apify";

export const PEOPLE_FIRST_HARVEST_NOT_STARTED = "PEOPLE_FIRST_HARVEST_NOT_STARTED";
export const PEOPLE_FIRST_HARVEST_STILL_RUNNING = "PEOPLE_FIRST_HARVEST_STILL_RUNNING";
export const PEOPLE_FIRST_HARVEST_EMPTY = "PEOPLE_FIRST_HARVEST_EMPTY";

export type HarvestEvidenceKind = "not_started" | "still_running" | "empty" | "gated_empty";

export interface HarvestEvidence {
  actor: typeof HARVEST_ACTOR;
  query: string;
  runId: string;
  status: string;
  itemCount: number;
  started: boolean;
}

export function isHarvestEvidenceCode(code: string | null | undefined): boolean {
  return (
    code === PEOPLE_FIRST_HARVEST_NOT_STARTED ||
    code === PEOPLE_FIRST_HARVEST_STILL_RUNNING ||
    code === PEOPLE_FIRST_HARVEST_EMPTY
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
  if (kind === "gated_empty") {
    return `People-first harvest returned profiles that did not meet skill-match ≥60. ${base}. Try Source via Apify with a narrower query.`;
  }
  return `People-first harvest returned 0 profiles. ${base}. Try Source via Apify with a narrower query.`;
}

export function logAriaHarvest(
  event: string,
  harvest: Partial<HarvestEvidence> & { detail?: string } = {},
): void {
  const parts = [
    HARVEST_LOG_PREFIX,
    event,
    `actor=${HARVEST_ACTOR}`,
    harvest.query != null ? `query=${JSON.stringify(harvest.query)}` : null,
    harvest.runId ? `runId=${harvest.runId}` : null,
    harvest.status ? `status=${harvest.status}` : null,
    harvest.started != null ? `started=${harvest.started}` : null,
    harvest.itemCount != null && harvest.itemCount >= 0 ? `items=${harvest.itemCount}` : null,
    harvest.detail ? `detail=${JSON.stringify(harvest.detail)}` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
}
