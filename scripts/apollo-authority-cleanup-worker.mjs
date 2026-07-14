import { pathToFileURL } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_MAX_BYTES = 65_536;
const COUNTERS = [
  "processed",
  "expired_receipts_cleared",
  "confirmations_deleted",
  "targets_deleted",
  "expired_targets_scrubbed",
  "quota_rows_deleted",
];
const SOURCING_COUNTERS = {
  retired: "sourcing_lessons_retired",
  lessons_deleted: "sourcing_lessons_deleted",
  artifacts_deleted: "sourcing_artifacts_deleted",
  runs_deleted: "sourcing_runs_deleted",
  quota_deleted: "sourcing_quota_rows_deleted",
};
const FRAMEWORK_COUNTERS = {
  deleted: "framework_authorizations_deleted",
};
const ALL_COUNTERS = [
  ...COUNTERS,
  ...Object.values(SOURCING_COUNTERS),
  ...Object.values(FRAMEWORK_COUNTERS),
];
const CLEANUP_RPCS = new Set([
  "cleanup_apollo_enrichment_authority",
  "cleanup_sourcing_learning_authority",
  "cleanup_agent_framework_authority",
]);

async function readBoundedJson(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    return { data: null, error: { code: "invalid_json_response" } };
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = /^[0-9]+$/.test(declared) ? Number(declared) : Number.NaN;
    if (!Number.isSafeInteger(length) || length > RESPONSE_MAX_BYTES) {
      await response.body.cancel().catch(() => undefined);
      return { data: null, error: { code: "response_too_large" } };
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { data: null, error: { code: "response_too_large" } };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { data: null, error: { code: "invalid_json_response" } };
  } finally {
    reader.releaseLock();
  }
  try {
    return { data: JSON.parse(text), error: null };
  } catch {
    return { data: null, error: { code: "invalid_json_response" } };
  }
}

export function createSupabaseServiceClient(baseUrl, serviceKey, fetchImpl = fetch) {
  const endpoint = new URL(baseUrl);
  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("apikey", serviceKey);
    headers.set("Authorization", `Bearer ${serviceKey}`);
    headers.set("Accept", "application/json");
    let response;
    try {
      response = await fetchImpl(new URL(path, endpoint), {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { data: null, error: { code: "transport_unavailable" } };
    }
    const parsed = await readBoundedJson(response);
    if (parsed.error) return parsed;
    return response.ok
      ? parsed
      : { data: null, error: { code: `http_${response.status}` } };
  };

  return {
    from(name) {
      if (name !== "workspaces") throw new Error("unsupported cleanup relation");
      let columns = "";
      let ordering = "";
      return {
        select(value) {
          if (value !== "id") throw new Error("unsupported cleanup projection");
          columns = value;
          return this;
        },
        order(column, options = {}) {
          if (column !== "id" || options.ascending !== true) {
            throw new Error("unsupported cleanup ordering");
          }
          ordering = `${column}.asc`;
          return this;
        },
        range(from, to) {
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
            throw new Error("invalid cleanup range");
          }
          const query = new URLSearchParams({ select: columns, order: ordering });
          return request(`/rest/v1/workspaces?${query}`, {
            headers: { Range: `${from}-${to}` },
          });
        },
      };
    },
    rpc(name, args) {
      if (!CLEANUP_RPCS.has(name)) {
        throw new Error("unsupported cleanup RPC");
      }
      return request(`/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    },
  };
}

function cleanupReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== "cleaned") return null;
  const receipt = {};
  for (const key of COUNTERS) {
    const parsed = value[key];
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
    receipt[key] = parsed;
  }
  return receipt;
}

function mappedCleanupReceipt(value, mapping) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== "cleaned") {
    return null;
  }
  const receipt = {};
  for (const [source, target] of Object.entries(mapping)) {
    const parsed = value[source];
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
    receipt[target] = parsed;
  }
  return receipt;
}

function receiptTotal(receipt, keys) {
  return keys.reduce((total, key) => total + receipt[key], 0);
}

export async function cleanupApolloAuthorityOnce(client, options = {}) {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  const perCallLimit = options.perCallLimit ?? 500;
  const maxPassesPerWorkspace = options.maxPassesPerWorkspace ?? 20;
  if (
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 ||
    !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1_000 ||
    !Number.isSafeInteger(perCallLimit) || perCallLimit < 1 || perCallLimit > 500 ||
    !Number.isSafeInteger(maxPassesPerWorkspace) || maxPassesPerWorkspace < 1 || maxPassesPerWorkspace > 100
  ) throw new Error("invalid cleanup worker bounds");

  const totals = Object.fromEntries(ALL_COUNTERS.map((key) => [key, 0]));
  const failures = [];
  let workspacesProcessed = 0;
  let incomplete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from("workspaces")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !Array.isArray(data)) {
      failures.push({ workspaceId: null, code: "workspace_page_unavailable" });
      break;
    }
    if (data.length === 0) break;

    for (const row of data) {
      const workspaceId = typeof row?.id === "string" && UUID_RE.test(row.id) ? row.id : "";
      if (!workspaceId) {
        failures.push({ workspaceId: null, code: "workspace_id_invalid" });
        continue;
      }
      let workspaceFailed = false;
      for (let pass = 0; pass < maxPassesPerWorkspace; pass += 1) {
        const { data: rawApolloReceipt, error: apolloCleanupError } = await client.rpc(
          "cleanup_apollo_enrichment_authority",
          { p_workspace_id: workspaceId, p_limit: perCallLimit },
        );
        const apolloReceipt = apolloCleanupError ? null : cleanupReceipt(rawApolloReceipt);
        if (!apolloReceipt) {
          failures.push({ workspaceId, code: "apollo_cleanup_rpc_unavailable" });
          workspaceFailed = true;
          break;
        }
        for (const key of COUNTERS) totals[key] += apolloReceipt[key];

        const { data: rawSourcingReceipt, error: sourcingCleanupError } = await client.rpc(
          "cleanup_sourcing_learning_authority",
          { p_workspace_id: workspaceId, p_limit: perCallLimit },
        );
        const sourcingReceipt = sourcingCleanupError
          ? null
          : mappedCleanupReceipt(rawSourcingReceipt, SOURCING_COUNTERS);
        if (!sourcingReceipt) {
          failures.push({ workspaceId, code: "sourcing_cleanup_rpc_unavailable" });
          workspaceFailed = true;
          break;
        }
        for (const key of Object.values(SOURCING_COUNTERS)) totals[key] += sourcingReceipt[key];

        const { data: rawFrameworkReceipt, error: frameworkCleanupError } = await client.rpc(
          "cleanup_agent_framework_authority",
          { p_workspace_id: workspaceId, p_limit: perCallLimit },
        );
        const frameworkReceipt = frameworkCleanupError
          ? null
          : mappedCleanupReceipt(rawFrameworkReceipt, FRAMEWORK_COUNTERS);
        if (!frameworkReceipt) {
          failures.push({ workspaceId, code: "framework_cleanup_rpc_unavailable" });
          workspaceFailed = true;
          break;
        }
        for (const key of Object.values(FRAMEWORK_COUNTERS)) totals[key] += frameworkReceipt[key];

        const sourcingProcessed = receiptTotal(
          sourcingReceipt,
          Object.values(SOURCING_COUNTERS),
        );
        const frameworkProcessed = receiptTotal(
          frameworkReceipt,
          Object.values(FRAMEWORK_COUNTERS),
        );
        const moreWorkMayRemain =
          apolloReceipt.processed >= perCallLimit ||
          sourcingProcessed >= perCallLimit ||
          frameworkProcessed >= perCallLimit;
        if (!moreWorkMayRemain) break;
        if (pass === maxPassesPerWorkspace - 1) {
          failures.push({ workspaceId, code: "workspace_cleanup_bound_reached" });
          workspaceFailed = true;
          incomplete = true;
        }
      }
      if (!workspaceFailed) workspacesProcessed += 1;
    }
    if (data.length < pageSize) break;
    if (page === maxPages - 1) incomplete = true;
  }

  return {
    status: failures.length > 0 ? "degraded" : incomplete ? "incomplete" : "ok",
    workspacesProcessed,
    failures,
    incomplete,
    ...totals,
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function main() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const releaseSha = process.env.ARIA_RELEASE_SHA ?? "";
  const intervalHours = Number(process.env.ARIA_APOLLO_CLEANUP_INTERVAL_HOURS ?? "6");
  if (
    !/^https?:\/\//.test(url) ||
    key.length < 32 ||
    !/^[0-9a-f]{40}$/.test(releaseSha) ||
    !Number.isInteger(intervalHours) ||
    intervalHours < 1 ||
    intervalHours > 24
  ) {
    console.error(JSON.stringify({ event: "apollo_authority_cleanup_configuration_error", status: "failed" }));
    process.exit(78);
  }

  const client = createSupabaseServiceClient(url, key);
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort());

  while (!controller.signal.aborted) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const result = await cleanupApolloAuthorityOnce(client);
      const output = {
        event: "apollo_authority_cleanup",
        releaseSha,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...result,
      };
      const writer = result.status === "ok" ? console.log : console.error;
      writer(JSON.stringify(output));
    } catch {
      console.error(JSON.stringify({
        event: "apollo_authority_cleanup",
        releaseSha,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        status: "failed",
        failures: [{ workspaceId: null, code: "worker_exception" }],
      }));
    }
    await delay(intervalHours * 60 * 60 * 1_000, controller.signal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
