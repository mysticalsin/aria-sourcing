import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  observabilityConfiguration,
} from "../src/lib/observability/configuration.mjs";
import {
  CRITICAL_SOURCING_STAGES,
  withCriticalPathTelemetry,
} from "../src/lib/observability/critical-path.mjs";

const releaseSha = "a".repeat(40);
const baseEnvironment = {
  NODE_ENV: "production",
  ARIA_RELEASE_SHA: releaseSha,
  OTEL_SERVICE_NAME: "aria-msourcing",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/otel",
  OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20opaque-token",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "none",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

const ready = observabilityConfiguration(baseEnvironment);
assert.deepEqual(
  ready,
  {
    required: true,
    configured: true,
    status: "ready",
    reason: "configured",
    serviceName: "aria-msourcing",
  },
  "production telemetry configuration should be explicit and ready",
);

assert.deepEqual(
  observabilityConfiguration({ NODE_ENV: "production" }),
  {
    required: true,
    configured: false,
    status: "not_ready",
    reason: "service_name_invalid",
    serviceName: null,
  },
  "production must fail closed when collector metadata is missing",
);

for (const endpoint of [
  "http://collector.example.com:4318",
  "https://user:password@collector.example.com/otel",
  "https://collector.example.com/otel?token=secret",
  "https://collector.example.com/otel#fragment",
]) {
  const configuration = observabilityConfiguration({
    ...baseEnvironment,
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
  });
  assert.equal(configuration.configured, false, `unsafe endpoint must be rejected: ${endpoint}`);
}

assert.equal(
  observabilityConfiguration({
    ...baseEnvironment,
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.internal:4318",
    OTEL_EXPORTER_OTLP_HEADERS: "",
  }).configured,
  true,
  "private Fly collectors may use credential-free HTTP inside 6PN",
);

assert.equal(
  observabilityConfiguration({ ...baseEnvironment, OTEL_METRICS_EXPORTER: "none" }).reason,
  "exporter_contract_invalid",
  "production must export both traces and aggregate metrics",
);

assert.equal(
  observabilityConfiguration({
    NODE_ENV: "test",
    ARIA_OBSERVABILITY_REQUIRED: "false",
  }).status,
  "disabled",
  "local tests may explicitly run without an exporter",
);

assert.deepEqual(
  [...CRITICAL_SOURCING_STAGES],
  ["need_ingress", "requisition_parse", "campaign_create", "sourcing_batch"],
  "the low-cardinality stage vocabulary must remain closed",
);

const receipts: string[] = [];
const sensitiveResult = {
  outcome: "accepted",
  candidateEmail: "candidate@example.com",
  query: "site:linkedin.com/in private search",
  providerResponse: { apiKey: "do-not-log" },
};
const returned = await withCriticalPathTelemetry(
  "need_ingress",
  async () => sensitiveResult,
  {
    classify: (value) => ({ status: "ok", code: value.outcome }),
    logger: (line) => receipts.push(line),
    now: (() => {
      const values = [10_000, 10_025];
      return () => values.shift() ?? 10_025;
    })(),
    environment: {
      ARIA_RELEASE_SHA: releaseSha,
      FLY_PROCESS_GROUP: "web",
    },
  },
);
assert.equal(returned, sensitiveResult, "telemetry must not alter handler results");
assert.equal(receipts.length, 1, "one stage execution must emit one structured receipt");
assert.deepEqual(
  Object.keys(JSON.parse(receipts[0])).sort(),
  ["code", "durationMs", "event", "processGroup", "releaseSha", "spanId", "stage", "status", "traceId"].sort(),
  "structured receipts must have one exact bounded schema",
);
assert.match(receipts[0], /"stage":"need_ingress"/);
assert.match(receipts[0], /"code":"accepted"/);
assert.doesNotMatch(receipts[0], /candidate@example\.com|linkedin|do-not-log|apiKey|providerResponse/);

const untrustedCodeReceipts: string[] = [];
await withCriticalPathTelemetry(
  "campaign_create",
  async () => ({ outcome: "tenant_acme_private_requisition" }),
  {
    classify: (value) => ({ status: "degraded", code: value.outcome }),
    logger: (line) => untrustedCodeReceipts.push(line),
    now: () => 15_000,
    environment: { ARIA_RELEASE_SHA: releaseSha, FLY_PROCESS_GROUP: "loop" },
  },
);
assert.match(
  untrustedCodeReceipts[0],
  /"code":"outcome_invalid"/,
  "unknown handler material must not become a metric or log dimension",
);
assert.doesNotMatch(untrustedCodeReceipts[0], /tenant_acme_private_requisition/);

const failureReceipts: string[] = [];
await assert.rejects(
  withCriticalPathTelemetry(
    "sourcing_batch",
    async () => {
      throw new Error("provider leaked candidate@example.com and secret-token");
    },
    {
      logger: (line) => failureReceipts.push(line),
      now: () => 20_000,
      environment: { ARIA_RELEASE_SHA: releaseSha, FLY_PROCESS_GROUP: "loop" },
    },
  ),
  /provider leaked/,
);
assert.equal(failureReceipts.length, 1);
assert.match(failureReceipts[0], /"status":"failed"/);
assert.doesNotMatch(failureReceipts[0], /candidate@example\.com|secret-token|provider leaked/);

await assert.rejects(
  withCriticalPathTelemetry("invented_stage" as never, async () => undefined),
  /critical sourcing stage is invalid/,
);

const needRoute = readFileSync("src/app/api/webhooks/needs/route.ts", "utf8");
const parseRoute = readFileSync("src/app/api/internal/requisition-parse/route.ts", "utf8");
const loopWorker = readFileSync("scripts/sourcing-loop-worker.mjs", "utf8");
assert.match(needRoute, /withCriticalPathTelemetry\([\s\S]*?"need_ingress"/);
assert.match(parseRoute, /withCriticalPathTelemetry\([\s\S]*?"requisition_parse"/);
assert.match(loopWorker, /registerObservability\(process\.env\)/);
assert.match(loopWorker, /withCriticalPathTelemetry\([\s\S]*?"campaign_create"/);
assert.match(loopWorker, /withCriticalPathTelemetry\([\s\S]*?"sourcing_batch"/);

console.log("RESULT observability: configuration and redacted critical-path telemetry passed");
