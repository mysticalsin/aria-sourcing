# Production observability

Status: source instrumentation is present; collector, log drain, alert delivery,
on-call ownership, retention approval, and exact-release ingestion evidence are
external release gates.

This runbook defines the production telemetry contract for the critical path:

```text
need_ingress -> requisition_parse -> campaign_create -> sourcing_batch
```

It does not establish capacity for 50,000 registered users. That claim requires
the separate staged evidence and receipt in
[`capacity/README.md`](capacity/README.md).

## Source contract

Web and loop processes register the standard OpenTelemetry Node SDK. The SDK
exports traces and aggregate metrics over OTLP HTTP/protobuf. There is no
application `/metrics` endpoint and no process-local metric aggregation.

The protected Fly release sets these non-secret values in `fly.app.toml`:

```text
ARIA_OBSERVABILITY_REQUIRED=true
OTEL_SERVICE_NAME=aria-msourcing
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_METRIC_EXPORT_INTERVAL=60000
```

The protected GitHub `Production` environment must supply these two secrets:

```text
FLY_OTEL_EXPORTER_OTLP_ENDPOINT
FLY_OTEL_EXPORTER_OTLP_HEADERS
```

The deploy maps them to the Fly application secrets
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. Public collector
origins require HTTPS and a non-empty authorization header. HTTP is accepted
only for loopback or a Fly-private `.internal` collector. User information,
passwords, query strings, and URL fragments are rejected in collector URLs.

Production startup and `/api/ready` fail closed when this contract is absent or
invalid. The readiness component proves configuration validity only. It does
not prove collector ingestion, dashboard queries, alert delivery, or log-drain
delivery.

## Signals and data boundary

Each execution creates one span named `aria.sourcing.<stage>`, increments
`aria.sourcing.stage.executions`, records `aria.sourcing.stage.duration` in
milliseconds, and emits one structured application-log receipt.

Metric and span dimensions are closed and low-cardinality:

- `aria.sourcing.stage`: one of the four stages above;
- `aria.sourcing.status`: `ok`, `rejected`, `degraded`, or `failed`;
- `aria.sourcing.code`: a bounded machine code such as `http_200`;
- `service.instance.group`: a bounded Fly process group;
- `service.version`: the exact 40-character release SHA.

The structured receipt contains exactly:

```json
{
  "event": "aria_sourcing_stage",
  "stage": "sourcing_batch",
  "status": "ok",
  "code": "completed",
  "durationMs": 125,
  "releaseSha": "<40-lowercase-hex>",
  "processGroup": "loop",
  "traceId": "<trace-id-or-unavailable>",
  "spanId": "<span-id-or-unavailable>"
}
```

Do not add tenant IDs, workspace IDs, requisition text, search queries,
candidate fields, contact details, provider response bodies, credential values,
or exception messages to telemetry. Handler exceptions use the fixed code
`handler_exception`. Telemetry failures never change sourcing authority or the
business operation result.

OpenTelemetry log export is intentionally disabled. Application receipts must
reach the monitoring system through an owner-configured Fly log drain. This
keeps the metrics and traces transport separate from the platform log transport
and avoids pretending an in-process logger is a durable log system.

## Release-candidate SLO contract

These objectives are release candidates, not achieved production evidence. The
service owner and incident owner must ratify them before production acceptance,
then calculate them from collector and log-drain data across all Machines for
the exact release.

| Indicator | Candidate objective | Window and exclusions |
|---|---:|---|
| Deep readiness availability | at least 99.9% | rolling 30 days; approved maintenance recorded separately |
| Critical-stage service reliability | at least 99.5% | rolling 30 days; `ok` and policy `rejected` are successful handling; `degraded` and `failed` are service failures |
| Runnable queue freshness | p95 at most 60 s and maximum at most 120 s | exact test or production window; same bounds as the capacity gate |
| Health and readiness error rate under the ratified workload | at most 0.1% | exact capacity-test window |

Latency objectives for sourcing stages remain unratified until staging measures
provider, database, and queue time separately. Do not copy endpoint thresholds
from the read-only capacity profile onto provider-backed stages.

## Alert contract

The monitoring owner must implement and test these routes before acceptance:

| Priority | Condition | Initial response |
|---|---|---|
| P1 | `/api/ready` is non-200 for two consecutive minutes | page primary and backup; identify the failed component and exact release |
| P1 | any stage has at least 5 executions and `failed` plus `degraded` is 5% or more over 5 minutes | engage service owner; stop activation or engage the loop kill switch when sourcing authority is uncertain |
| P1 | queue freshness exceeds 120 seconds | stop new activation, preserve receipts, inspect worker and database authority |
| P1 | collector or log drain rejects, drops, or cannot deliver production signals for 5 minutes | treat production state as unobservable and block release acceptance |
| P2 | `failed` plus `degraded` is 1% or more with at least 10 executions over 15 minutes | investigate by stage, code, process group, and release SHA |
| P2 | the same active-workload window has gateway traffic but no corresponding critical-stage signal for 5 minutes | inspect instrumentation, exporter diagnostics, and log-drain delivery |

Alert payloads must contain only bounded dimensions and links to restricted
dashboards. They must not embed candidate data or provider bodies. An alert is
not accepted until a non-production drill proves delivery to both the primary
and backup responders and records acknowledgement and escalation times.

## External activation checklist

All items below require operator or owner action outside source control:

1. Provision a supported OTLP collector with TLS, authentication, regional data
   handling, encrypted storage, and documented capacity.
2. Add the two `FLY_OTEL_*` secrets to the protected GitHub `Production`
   environment and verify their Fly application secret inventory is
   `Deployed`.
3. Configure a Fly log drain and prove that one redacted startup receipt and one
   receipt for each critical stage arrive without transformation loss.
4. Create dashboards grouped by release SHA, stage, status, code, and process
   group. Do not use tenant or candidate dimensions.
5. Create every alert above and assign a named primary responder, named backup,
   service owner, security contact, and privacy contact. Source control must not
   invent those people.
6. Approve retention, access control, deletion, data residency, and incident
   evidence rules for collector and log-drain data.
7. Deploy one exact release to production-shaped staging. Prove a trace and
   aggregate metric for each stage, the matching structured receipt, safe
   redaction under adversarial inputs, and alert delivery during a collector
   outage drill.
8. Bind the collector, dashboard, alert, and drill evidence to the exact release
   SHA in the release evidence bundle. Readiness alone is insufficient.
9. Run the ratified capacity, soak, fault, failover, and restore gates before a
   50,000-user claim.

## Incident sequence

1. Record the exact release SHA, affected stage, bounded code, process group,
   readiness component, and first observed time.
2. If authorization or external contact state is uncertain, set the sourcing
   loop kill switch and stop activation. Do not delete queue or receipt data.
3. Check collector ingestion, exporter diagnostics, and Fly log-drain delivery
   before concluding that no work occurred.
4. Correlate with trace and span IDs in restricted tooling. Do not paste
   candidate or requisition content into an incident channel.
5. Restore service through the approved rollback or recovery runbook, then
   verify readiness and one controlled no-contact sourcing canary.
6. Preserve the bounded evidence, record the owner decision, and run the
   incident postmortem process.

## Source verification

```sh
npx tsx tests/observability.mts
npx tsx tests/readiness.mts
npx tsx tests/infra-release-contract.mts
```

These tests prove the checked-in contract and redaction behavior. They do not
replace collector ingestion, log-drain, alert, on-call, capacity, or live
release evidence.
