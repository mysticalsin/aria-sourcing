import type { DatabricksSettings } from "@/lib/types";
import { fetchPublicUrl } from "@/lib/api/public-fetch";

export type DatabricksFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type DatabricksRow = Record<string, string>;

export type DatabricksNeedsResult =
  | { ok: true; rows: DatabricksRow[] }
  | { ok: false; error: string; status?: number; state?: string };

type StatementColumn = { name?: unknown };
type StatementResponse = {
  statement_id?: unknown;
  status?: { state?: unknown; error?: { message?: unknown } };
  manifest?: { schema?: { columns?: StatementColumn[] } };
  result?: { data_array?: unknown };
};

type ExecuteNeedsOptions = {
  since: string;
  /** Server-derived workspace/connection/revision/key binding. Never caller supplied. */
  authorityScope: string;
  fetchImpl?: DatabricksFetch;
  pollDelayMs?: number;
};

const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000;
const MAX_POLLS = 5;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, "");
}

function tokenCacheKey(authorityScope: string, host: string, clientId?: string): string {
  return `${authorityScope}|${normalizeHost(host)}|${clientId ?? ""}`;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basicAuth(clientId: string, secret: string): string {
  return Buffer.from(`${clientId}:${secret}`, "utf8").toString("base64");
}

async function jsonOrNull(res: Response): Promise<StatementResponse | Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as StatementResponse | Record<string, unknown> | null;
}

export function clearDatabricksTokenCacheForTests(): void {
  tokenCache.clear();
}

export function mapJsonArrayRows(payload: StatementResponse): DatabricksRow[] {
  const columns = payload.manifest?.schema?.columns ?? [];
  const names = columns
    .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
    .filter(Boolean);
  const data = payload.result?.data_array;
  if (!names.length || !Array.isArray(data)) return [];

  const rows: DatabricksRow[] = [];
  for (const rawRow of data) {
    if (!Array.isArray(rawRow) || rawRow.length !== names.length) continue;
    if (rawRow.some((value) => value == null)) continue;
    const row: DatabricksRow = {};
    for (let i = 0; i < names.length; i += 1) {
      row[names[i]] = String(rawRow[i]);
    }
    rows.push(row);
  }
  return rows;
}

async function getBearerToken(
  cfg: DatabricksSettings,
  secret: string,
  authorityScope: string,
  fetchImpl: DatabricksFetch,
): Promise<{ ok: true; token: string } | { ok: false; error: string; status?: number }> {
  if (cfg.authMode === "pat") return { ok: true, token: secret.trim() };

  const clientId = cfg.clientId?.trim();
  if (!clientId) return { ok: false, error: "Databricks OAuth client id is not configured." };

  const host = normalizeHost(cfg.host);
  const key = tokenCacheKey(authorityScope, host, clientId);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, token: cached.token };

  const res = await fetchImpl(`${host}/oidc/v1/token`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Basic ${basicAuth(clientId, secret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }).toString(),
  });
  const json = (await jsonOrNull(res)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!res.ok || typeof json?.access_token !== "string") {
    return { ok: false, error: `Databricks token request failed (${res.status}).`, status: res.status };
  }

  const ttlMs =
    typeof json.expires_in === "number"
      ? Math.min(TOKEN_CACHE_TTL_MS, Math.max(1, json.expires_in - 300) * 1000)
      : TOKEN_CACHE_TTL_MS;
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + ttlMs });
  return { ok: true, token: json.access_token };
}

function responseState(payload: StatementResponse): string {
  return typeof payload.status?.state === "string" ? payload.status.state : "";
}

function statementId(payload: StatementResponse): string {
  return typeof payload.statement_id === "string" ? payload.statement_id : "";
}

async function submitStatement(
  cfg: DatabricksSettings,
  bearerToken: string,
  since: string,
  fetchImpl: DatabricksFetch,
): Promise<{ res: Response; payload: StatementResponse | null }> {
  const host = normalizeHost(cfg.host);
  const res = await fetchImpl(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      statement: cfg.needsQuery,
      warehouse_id: cfg.warehouseId,
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY",
      parameters: [{ name: "since", value: since, type: "TIMESTAMP" }],
      row_limit: 500,
    }),
  });
  return { res, payload: (await jsonOrNull(res)) as StatementResponse | null };
}

async function pollStatement(
  cfg: DatabricksSettings,
  statementIdValue: string,
  bearerToken: string,
  fetchImpl: DatabricksFetch,
): Promise<{ res: Response; payload: StatementResponse | null }> {
  const host = normalizeHost(cfg.host);
  const res = await fetchImpl(`${host}/api/2.0/sql/statements/${encodeURIComponent(statementIdValue)}`, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  return { res, payload: (await jsonOrNull(res)) as StatementResponse | null };
}

export async function executeNeedsQuery(
  cfg: DatabricksSettings,
  secret: string,
  opts: ExecuteNeedsOptions,
): Promise<DatabricksNeedsResult> {
  const fetchImpl = opts.fetchImpl ?? fetchPublicUrl;
  let token: Awaited<ReturnType<typeof getBearerToken>>;
  try {
    token = await getBearerToken(cfg, secret, opts.authorityScope, fetchImpl);
  } catch {
    return { ok: false, error: "Databricks authentication transport failed.", status: 502 };
  }
  if (!token.ok) return token;

  let submitted: Awaited<ReturnType<typeof submitStatement>>;
  try {
    submitted = await submitStatement(cfg, token.token, opts.since, fetchImpl);
  } catch {
    return { ok: false, error: "Databricks statement transport failed.", status: 502 };
  }
  if (!submitted.res.ok || !submitted.payload) {
    return { ok: false, error: `Databricks statement request failed (${submitted.res.status}).`, status: submitted.res.status };
  }

  let payload = submitted.payload;
  let state = responseState(payload);
  if (state === "SUCCEEDED") return { ok: true, rows: mapJsonArrayRows(payload) };
  if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
    return { ok: false, error: "Databricks statement execution failed.", state };
  }

  const id = statementId(payload);
  if (!id) return { ok: false, error: "Databricks statement did not return a statement id.", state };

  for (let i = 0; i < MAX_POLLS && (state === "PENDING" || state === "RUNNING"); i += 1) {
    await sleep(opts.pollDelayMs ?? Math.min(2_000, 250 * 2 ** i));
    let polled: Awaited<ReturnType<typeof pollStatement>>;
    try {
      polled = await pollStatement(cfg, id, token.token, fetchImpl);
    } catch {
      return { ok: false, error: "Databricks statement transport failed.", status: 502 };
    }
    if (!polled.res.ok || !polled.payload) {
      return { ok: false, error: `Databricks statement poll failed (${polled.res.status}).`, status: polled.res.status };
    }
    payload = polled.payload;
    state = responseState(payload);
    if (state === "SUCCEEDED") return { ok: true, rows: mapJsonArrayRows(payload) };
    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
      return { ok: false, error: "Databricks statement execution failed.", state };
    }
  }

  return { ok: false, error: "Databricks statement did not finish before the poll cap.", state };
}
