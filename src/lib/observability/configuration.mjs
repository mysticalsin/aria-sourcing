const SERVICE_NAME_RE = /^[a-z][a-z0-9-]{2,62}$/;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const PRIVATE_HOST_RE = /(?:^|\.)internal$/;
const MAX_HEADER_LENGTH = 4_096;
const METRIC_INTERVAL_RE = /^(?:[1-9][0-9]{4,5}|300000)$/;

function exactBoolean(value) {
  return value === "true";
}

function safeCollectorEndpoint(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) return null;
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    return null;
  }
  const hostname = endpoint.hostname.toLowerCase();
  const privateHttp = endpoint.protocol === "http:" && (
    PRIVATE_HOST_RE.test(hostname) ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
  if (
    (endpoint.protocol !== "https:" && !privateHttp) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    return null;
  }
  return endpoint;
}

function safeHeaders(value, endpoint) {
  if (typeof value !== "string" || value.length > MAX_HEADER_LENGTH || /[\r\n\u0000]/.test(value)) {
    return false;
  }
  if (endpoint.protocol === "https:" && !PRIVATE_HOST_RE.test(endpoint.hostname.toLowerCase())) {
    if (value.length === 0) return false;
  }
  if (value.length === 0) return true;
  return value.split(",").every((item) => {
    const separator = item.indexOf("=");
    return separator > 0 && separator < item.length - 1 &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(item.slice(0, separator)) &&
      !/[\u0000-\u001f\u007f]/.test(item.slice(separator + 1));
  });
}

/**
 * Pure, secret-safe authority check for the standard OTLP environment contract.
 * It intentionally returns no endpoint or header values.
 *
 * @param {Record<string, string | undefined>} [environment]
 */
export function observabilityConfiguration(environment = process.env) {
  const required = environment.NODE_ENV === "production" ||
    exactBoolean(environment.ARIA_OBSERVABILITY_REQUIRED);
  const configuredFieldsPresent = [
    environment.OTEL_SERVICE_NAME,
    environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    environment.OTEL_EXPORTER_OTLP_HEADERS,
    environment.OTEL_EXPORTER_OTLP_PROTOCOL,
    environment.OTEL_TRACES_EXPORTER,
    environment.OTEL_METRICS_EXPORTER,
  ].some((value) => typeof value === "string" && value.length > 0);

  if (!required && !configuredFieldsPresent) {
    return {
      required: false,
      configured: false,
      status: "disabled",
      reason: "not_required",
      serviceName: null,
    };
  }

  const serviceName = environment.OTEL_SERVICE_NAME ?? "";
  if (!SERVICE_NAME_RE.test(serviceName)) {
    return { required, configured: false, status: "not_ready", reason: "service_name_invalid", serviceName: null };
  }
  if (!RELEASE_SHA_RE.test(environment.ARIA_RELEASE_SHA ?? "")) {
    return { required, configured: false, status: "not_ready", reason: "release_identity_invalid", serviceName };
  }
  if (environment.OTEL_EXPORTER_OTLP_PROTOCOL !== "http/protobuf") {
    return { required, configured: false, status: "not_ready", reason: "protocol_invalid", serviceName };
  }
  if (
    environment.OTEL_SDK_DISABLED === "true" ||
    environment.OTEL_TRACES_EXPORTER !== "otlp" ||
    environment.OTEL_METRICS_EXPORTER !== "otlp" ||
    environment.OTEL_LOGS_EXPORTER !== "none" ||
    !METRIC_INTERVAL_RE.test(environment.OTEL_METRIC_EXPORT_INTERVAL ?? "") ||
    Number(environment.OTEL_METRIC_EXPORT_INTERVAL) < 10_000 ||
    Number(environment.OTEL_METRIC_EXPORT_INTERVAL) > 300_000
  ) {
    return { required, configured: false, status: "not_ready", reason: "exporter_contract_invalid", serviceName };
  }
  const endpoint = safeCollectorEndpoint(environment.OTEL_EXPORTER_OTLP_ENDPOINT ?? "");
  if (!endpoint) {
    return { required, configured: false, status: "not_ready", reason: "collector_endpoint_invalid", serviceName };
  }
  if (!safeHeaders(environment.OTEL_EXPORTER_OTLP_HEADERS ?? "", endpoint)) {
    return { required, configured: false, status: "not_ready", reason: "collector_headers_invalid", serviceName };
  }
  return { required, configured: true, status: "ready", reason: "configured", serviceName };
}
