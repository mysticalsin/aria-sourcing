import {
  metrics,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

export const CRITICAL_SOURCING_STAGES = Object.freeze([
  "need_ingress",
  "requisition_parse",
  "campaign_create",
  "sourcing_batch",
]);

const STAGE_SET = new Set(CRITICAL_SOURCING_STAGES);
const STATUS_SET = new Set(["ok", "rejected", "degraded", "failed"]);
const CODE_SET = new Set([
  "accepted",
  "ambiguous_dead_lettered",
  "classification_error",
  "completed",
  "dead_lettered",
  "handler_exception",
  "no_op_replay",
  "ok",
  "outcome_invalid",
  "retry_scheduled",
  "stale_lease",
  "unavailable",
  "http_200",
  "http_202",
  "http_400",
  "http_401",
  "http_409",
  "http_413",
  "http_415",
  "http_423",
  "http_429",
  "http_503",
]);
const PROCESS_GROUP_RE = /^[a-z][a-z0-9_]{0,31}$/;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const MAX_DURATION_MS = 3_600_000;

function safeStatus(value) {
  return STATUS_SET.has(value) ? value : "degraded";
}

function safeCode(value, fallback) {
  return CODE_SET.has(value) ? value : fallback;
}

function safeDuration(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)));
}

function safeProcessGroup(value) {
  return typeof value === "string" && PROCESS_GROUP_RE.test(value) ? value : "unknown";
}

function safeSpanIdentity(span) {
  const spanContext = span?.spanContext?.();
  return {
    traceId: TRACE_ID_RE.test(spanContext?.traceId ?? "") ? spanContext.traceId : "unavailable",
    spanId: SPAN_ID_RE.test(spanContext?.spanId ?? "") ? spanContext.spanId : "unavailable",
  };
}

function instruments() {
  const meter = metrics.getMeter("aria-sourcing-critical-path", "1.0.0");
  return {
    executions: meter.createCounter("aria.sourcing.stage.executions", {
      description: "Critical sourcing stage executions",
      unit: "{execution}",
    }),
    duration: meter.createHistogram("aria.sourcing.stage.duration", {
      description: "Critical sourcing stage duration",
      unit: "ms",
    }),
  };
}

function emitTelemetry({ span, stage, status, code, durationMs, environment, logger }) {
  const releaseSha = RELEASE_SHA_RE.test(environment.ARIA_RELEASE_SHA ?? "")
    ? environment.ARIA_RELEASE_SHA
    : "unknown";
  const processGroup = safeProcessGroup(environment.FLY_PROCESS_GROUP);
  const identity = safeSpanIdentity(span);
  const attributes = {
    "aria.sourcing.stage": stage,
    "aria.sourcing.status": status,
    "aria.sourcing.code": code,
    "service.instance.group": processGroup,
  };

  try {
    const { executions, duration } = instruments();
    executions.add(1, attributes);
    duration.record(durationMs, attributes);
  } catch {
    // Observability must never change application authority or handler outcome.
  }
  try {
    span.setAttributes({ ...attributes, "service.version": releaseSha });
    span.setStatus({ code: status === "failed" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  } catch {
    // A broken exporter must surface through its own diagnostics and readiness,
    // never by changing the business operation.
  }
  try {
    logger(JSON.stringify({
      event: "aria_sourcing_stage",
      stage,
      status,
      code,
      durationMs,
      releaseSha,
      processGroup,
      traceId: identity.traceId,
      spanId: identity.spanId,
    }));
  } catch {
    // Log transport failures do not grant or revoke sourcing authority.
  }
}

/**
 * Wrap one bounded sourcing stage without accepting identifiers, queries,
 * candidate material, credentials, or provider response bodies as telemetry.
 *
 * @template T
 * @param {"need_ingress" | "requisition_parse" | "campaign_create" | "sourcing_batch"} stage
 * @param {() => Promise<T>} operation
 * @param {{
 *   classify?: (value: T) => {status?: string, code?: string},
 *   logger?: (line: string) => void,
 *   now?: () => number,
 *   environment?: Record<string, string | undefined>,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withCriticalPathTelemetry(stage, operation, options = {}) {
  if (!STAGE_SET.has(stage)) throw new Error("critical sourcing stage is invalid");
  const logger = options.logger ?? console.log;
  const now = options.now ?? Date.now;
  const environment = options.environment ?? process.env;
  const tracer = trace.getTracer("aria-sourcing-critical-path", "1.0.0");

  return tracer.startActiveSpan(`aria.sourcing.${stage}`, async (span) => {
    const startedAt = now();
    try {
      const value = await operation();
      let classification = { status: "ok", code: "completed" };
      try {
        classification = { ...classification, ...(options.classify?.(value) ?? {}) };
      } catch {
        classification = { status: "degraded", code: "classification_error" };
      }
      const status = safeStatus(classification.status);
      const code = safeCode(classification.code, "outcome_invalid");
      emitTelemetry({
        span,
        stage,
        status,
        code,
        durationMs: safeDuration(now() - startedAt),
        environment,
        logger,
      });
      return value;
    } catch (error) {
      emitTelemetry({
        span,
        stage,
        status: "failed",
        code: "handler_exception",
        durationMs: safeDuration(now() - startedAt),
        environment,
        logger,
      });
      throw error;
    } finally {
      try {
        span.end();
      } catch {
        // No-op spans and failed exporters must not affect the operation.
      }
    }
  });
}
