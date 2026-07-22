import { pathToFileURL } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_MAX_BYTES = 65_536;
const FAILURE_REPORT_LIMIT = 100;
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
  ordinary_results_expired: "ordinary_sourcing_results_expired",
  ordinary_result_payloads_scrubbed: "ordinary_sourcing_result_payloads_scrubbed",
};
const FRAMEWORK_COUNTERS = {
  deleted: "framework_authorizations_deleted",
};
const REQUISITION_COUNTERS = {
  processed: "requisition_inputs_processed",
  raw_inputs_scrubbed: "requisition_inputs_scrubbed",
  receipts_written: "requisition_cleanup_receipts_written",
};
const ALL_COUNTERS = [
  ...COUNTERS,
  ...Object.values(SOURCING_COUNTERS),
  ...Object.values(FRAMEWORK_COUNTERS),
  ...Object.values(REQUISITION_COUNTERS),
];
const CLEANUP_RPCS = new Set([
  "cleanup_apollo_enrichment_authority",
  "cleanup_sourcing_learning_authority",
  "cleanup_agent_framework_authority",
  "cleanup_requisition_input_authority",
]);
const CLEANUP_DOMAINS = [
  {
    rpc: "cleanup_apollo_enrichment_authority",
    unavailableCode: "apollo_cleanup_rpc_unavailable",
    boundCode: "apollo_cleanup_bound_reached",
    parseReceipt: (value) => cleanupReceipt(value),
    counterKeys: COUNTERS,
    processed: (receipt) => receipt.processed,
  },
  {
    rpc: "cleanup_sourcing_learning_authority",
    unavailableCode: "sourcing_cleanup_rpc_unavailable",
    boundCode: "sourcing_cleanup_bound_reached",
    parseReceipt: (value) => mappedCleanupReceipt(value, SOURCING_COUNTERS),
    counterKeys: Object.values(SOURCING_COUNTERS),
    processed: (receipt) => receiptTotal(receipt, Object.values(SOURCING_COUNTERS)),
  },
  {
    rpc: "cleanup_agent_framework_authority",
    unavailableCode: "framework_cleanup_rpc_unavailable",
    boundCode: "framework_cleanup_bound_reached",
    parseReceipt: (value) => mappedCleanupReceipt(value, FRAMEWORK_COUNTERS),
    counterKeys: Object.values(FRAMEWORK_COUNTERS),
    processed: (receipt) => receiptTotal(receipt, Object.values(FRAMEWORK_COUNTERS)),
  },
  {
    rpc: "cleanup_requisition_input_authority",
    unavailableCode: "requisition_cleanup_rpc_unavailable",
    boundCode: "requisition_cleanup_bound_reached",
    parseReceipt: (value, limit) => requisitionCleanupReceipt(value, limit),
    counterKeys: Object.values(REQUISITION_COUNTERS),
    processed: (receipt) => receipt.requisition_inputs_processed,
  },
];

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
      let lowerBound = "";
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
        gt(column, value) {
          if (column !== "id" || typeof value !== "string" || !UUID_RE.test(value)) {
            throw new Error("invalid cleanup cursor");
          }
          lowerBound = value;
          return this;
        },
        range(from, to) {
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
            throw new Error("invalid cleanup range");
          }
          const query = new URLSearchParams({ select: columns, order: ordering });
          if (lowerBound) query.set("id", `gt.${lowerBound}`);
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

function requisitionCleanupReceipt(value, limit) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expectedKeys = ["processed", "raw_inputs_scrubbed", "receipts_written", "status"];
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    value.status !== "cleaned"
  ) return null;
  const { processed, raw_inputs_scrubbed, receipts_written } = value;
  if (
    !Number.isSafeInteger(processed) || processed < 0 || processed > limit ||
    !Number.isSafeInteger(raw_inputs_scrubbed) || raw_inputs_scrubbed < 0 || raw_inputs_scrubbed > limit ||
    !Number.isSafeInteger(receipts_written) || receipts_written < 0 || receipts_written > limit ||
    processed !== raw_inputs_scrubbed || processed !== receipts_written
  ) return null;
  return {
    requisition_inputs_processed: processed,
    requisition_inputs_scrubbed: raw_inputs_scrubbed,
    requisition_cleanup_receipts_written: receipts_written,
  };
}

function receiptTotal(receipt, keys) {
  return keys.reduce((total, key) => total + receipt[key], 0);
}

async function cleanupDomain(client, domain, workspaceId, perCallLimit, maxPasses, totals) {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let response;
    try {
      response = await client.rpc(domain.rpc, {
        p_workspace_id: workspaceId,
        p_limit: perCallLimit,
      });
    } catch {
      return { failureCode: domain.unavailableCode, incomplete: true };
    }
    const receipt = response?.error
      ? null
      : domain.parseReceipt(response?.data, perCallLimit);
    if (!receipt) return { failureCode: domain.unavailableCode, incomplete: true };

    for (const key of domain.counterKeys) totals[key] += receipt[key];
    if (domain.processed(receipt) < perCallLimit) {
      return { failureCode: null, incomplete: false };
    }
    if (pass === maxPasses - 1) {
      return { failureCode: domain.boundCode, incomplete: true };
    }
  }
  throw new Error("unreachable cleanup domain state");
}

export async function cleanupApolloAuthorityOnce(client, options = {}) {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  const perCallLimit = options.perCallLimit ?? 500;
  const maxPassesPerWorkspace = options.maxPassesPerWorkspace ?? 20;
  const afterWorkspaceId = options.afterWorkspaceId ?? null;
  if (
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 ||
    !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1_000 ||
    !Number.isSafeInteger(perCallLimit) || perCallLimit < 1 || perCallLimit > 500 ||
    !Number.isSafeInteger(maxPassesPerWorkspace) || maxPassesPerWorkspace < 1 || maxPassesPerWorkspace > 100 ||
    (afterWorkspaceId !== null && (typeof afterWorkspaceId !== "string" || !UUID_RE.test(afterWorkspaceId)))
  ) throw new Error("invalid cleanup worker bounds");

  const totals = Object.fromEntries(ALL_COUNTERS.map((key) => [key, 0]));
  const failures = [];
  let failureCount = 0;
  let failuresTruncated = false;
  let workspacesProcessed = 0;
  let incomplete = false;
  let scanIncomplete = false;
  let nextWorkspaceCursor = afterWorkspaceId;

  const recordFailure = (workspaceId, code) => {
    failureCount += 1;
    if (failures.length < FAILURE_REPORT_LIMIT) {
      failures.push({ workspaceId, code });
    } else {
      failuresTruncated = true;
    }
  };

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    let pageResult;
    try {
      let query = client
        .from("workspaces")
        .select("id")
        .order("id", { ascending: true });
      if (afterWorkspaceId) query = query.gt("id", afterWorkspaceId);
      pageResult = await query.range(from, from + pageSize - 1);
    } catch {
      pageResult = { data: null, error: { code: "workspace_page_unavailable" } };
    }
    const { data, error } = pageResult ?? {};
    if (error || !Array.isArray(data)) {
      recordFailure(null, "workspace_page_unavailable");
      incomplete = true;
      break;
    }
    if (data.length === 0) {
      nextWorkspaceCursor = null;
      break;
    }

    for (const row of data) {
      const workspaceId = typeof row?.id === "string" && UUID_RE.test(row.id) ? row.id : "";
      if (!workspaceId) {
        recordFailure(null, "workspace_id_invalid");
        incomplete = true;
        continue;
      }
      nextWorkspaceCursor = workspaceId;
      let workspaceFailed = false;
      for (const domain of CLEANUP_DOMAINS) {
        const outcome = await cleanupDomain(
          client,
          domain,
          workspaceId,
          perCallLimit,
          maxPassesPerWorkspace,
          totals,
        );
        if (outcome.failureCode) {
          recordFailure(workspaceId, outcome.failureCode);
          workspaceFailed = true;
        }
        if (outcome.incomplete) {
          incomplete = true;
        }
      }
      if (!workspaceFailed) workspacesProcessed += 1;
    }
    if (data.length < pageSize) {
      nextWorkspaceCursor = null;
      break;
    }
    if (page === maxPages - 1) {
      incomplete = true;
      scanIncomplete = true;
    }
  }

  return {
    status: failureCount > 0 ? "degraded" : incomplete ? "incomplete" : "ok",
    workspacesProcessed,
    failures,
    failureCount,
    failuresTruncated,
    incomplete,
    scanIncomplete,
    nextWorkspaceCursor,
    ...totals,
    ordinary_sourcing_results_expired: totals.ordinary_sourcing_results_expired,
    ordinary_sourcing_result_payloads_scrubbed: totals.ordinary_sourcing_result_payloads_scrubbed,
    requisition_inputs_processed: totals.requisition_inputs_processed,
    requisition_inputs_scrubbed: totals.requisition_inputs_scrubbed,
    requisition_cleanup_receipts_written: totals.requisition_cleanup_receipts_written,
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
  let workspaceCursor = null;

  while (!controller.signal.aborted) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const result = await cleanupApolloAuthorityOnce(client, {
        afterWorkspaceId: workspaceCursor,
      });
      workspaceCursor = result.nextWorkspaceCursor;
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
      if (result.scanIncomplete && workspaceCursor && !controller.signal.aborted) continue;
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
