import { NodeSDK, resources } from "@opentelemetry/sdk-node";

import { observabilityConfiguration } from "./configuration.mjs";

const STATE_KEY = Symbol.for("aria.observability.sdk.v1");
const MACHINE_ID_RE = /^[0-9a-f]{14}$/;
const REGION_RE = /^[a-z]{3}$/;

function runtimeResource(configuration, environment) {
  const attributes = {
    "service.name": configuration.serviceName,
    "service.version": environment.ARIA_RELEASE_SHA,
    "deployment.environment.name": environment.NODE_ENV === "production" ? "production" : "non-production",
  };
  if (MACHINE_ID_RE.test(environment.FLY_MACHINE_ID ?? "")) {
    attributes["service.instance.id"] = environment.FLY_MACHINE_ID;
  }
  if (REGION_RE.test(environment.FLY_REGION ?? "")) {
    attributes["cloud.region"] = environment.FLY_REGION;
  }
  return resources.defaultResource().merge(resources.resourceFromAttributes(attributes));
}

function safeRuntimeReceipt(configuration, environment) {
  return {
    event: "aria_observability_runtime",
    status: "configured",
    serviceName: configuration.serviceName,
    releaseSha: environment.ARIA_RELEASE_SHA,
    processGroup: /^[a-z][a-z0-9_]{0,31}$/.test(environment.FLY_PROCESS_GROUP ?? "")
      ? environment.FLY_PROCESS_GROUP
      : "unknown",
  };
}

/**
 * Registers the standard OpenTelemetry Node SDK once per process. Exporter
 * endpoints and headers are consumed only by the SDK's OTEL_* environment
 * contract and are never copied into receipts, errors, or application logs.
 *
 * @param {Record<string, string | undefined>} [environment]
 */
export function registerObservability(environment = process.env) {
  const configuration = observabilityConfiguration(environment);
  if (!configuration.configured) {
    if (configuration.required) {
      throw new Error(`observability configuration is not ready: ${configuration.reason}`);
    }
    return configuration;
  }

  const identity = `${configuration.serviceName}:${environment.ARIA_RELEASE_SHA}`;
  const existing = globalThis[STATE_KEY];
  if (existing) {
    if (existing.identity !== identity) {
      throw new Error("observability runtime identity changed after registration");
    }
    return existing.receipt;
  }

  const sdk = new NodeSDK({
    serviceName: configuration.serviceName,
    resource: runtimeResource(configuration, environment),
  });
  sdk.start();
  const receipt = safeRuntimeReceipt(configuration, environment);
  globalThis[STATE_KEY] = { identity, receipt, sdk };
  console.log(JSON.stringify(receipt));
  process.once("beforeExit", () => {
    void sdk.shutdown().catch(() => undefined);
  });
  return receipt;
}
