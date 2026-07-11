import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { URL } from "node:url";
import { classifyFetchHost, isPublicIpAddress } from "@/lib/api/url";

export interface PublicAddress {
  address: string;
  family: 4 | 6;
}

export type PublicResolver = (hostname: string) => Promise<readonly PublicAddress[]>;

export interface PublicFetchInit extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

export interface PublicTransportRequest {
  url: URL;
  address: PublicAddress;
  init: PublicFetchInit;
  requestBody: Buffer | null;
  maxResponseBytes: number;
  timeoutMs: number;
}

export type PublicFetchTransport = (request: PublicTransportRequest) => Promise<Response>;

interface PublicFetchDependencies {
  resolver?: PublicResolver;
  transport?: PublicFetchTransport;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 2_000_000;
const DEFAULT_RESPONSE_BYTES = 2_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_URL_BYTES = 8_192;
const MAX_REQUEST_HEADER_BYTES = 16_384;
const MAX_RESPONSE_HEADER_BYTES = 16_384;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);
const BLOCKED_REQUEST_HEADERS = new Set(["connection", "content-length", "host", "transfer-encoding"]);

function withoutBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid public egress limit.");
  return Math.min(value, maximum);
}

function requestPort(url: URL): number {
  if (url.port) return Number(url.port);
  return 443;
}

function validateUrl(input: string | URL, init: PublicFetchInit): URL {
  const raw = input.toString();
  if (Buffer.byteLength(raw, "utf8") > MAX_URL_BYTES) {
    throw new Error("Public URL exceeds the byte limit.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid public URL.");
  }
  if (url.protocol !== "https:") throw new Error("Public egress requires HTTPS.");
  if (url.username || url.password) throw new Error("Embedded URL credentials are not allowed.");
  if (url.hash) url.hash = "";

  const method = (init.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("Public egress method is not allowed.");
  if ((method === "GET" || method === "HEAD") && init.body != null) {
    throw new Error(`${method} public requests cannot carry a body.`);
  }
  const port = requestPort(url);
  if (port !== 443) throw new Error("Non-standard public egress port is blocked.");
  return url;
}

const systemResolver: PublicResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, order: "verbatim" });
  return results.map(({ address, family }) => {
    if (family !== 4 && family !== 6) throw new Error("DNS returned an unknown address family.");
    return { address, family };
  });
};

async function resolveTarget(url: URL, resolver: PublicResolver): Promise<PublicAddress[]> {
  const hostname = withoutBrackets(url.hostname);
  const hostVerdict = classifyFetchHost(hostname);
  if (hostVerdict === "blocked") throw new Error("Blocked internal/private host (SSRF guard).");

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : [...(await resolver(hostname))];
  if (!addresses.length) throw new Error("Public host did not resolve.");

  for (const address of addresses) {
    if ((address.family !== 4 && address.family !== 6) || isIP(address.address) !== address.family) {
      throw new Error("DNS returned a malformed address.");
    }
    if (!isPublicIpAddress(address.address)) {
      throw new Error("Host resolves to a private or non-public address (SSRF guard).");
    }
  }
  return addresses;
}

function assertBodySize(size: number, maxBytes: number): void {
  if (size > maxBytes) throw new Error("Public request exceeds the byte limit.");
}

async function bodyBuffer(body: BodyInit | null | undefined, maxBytes: number): Promise<Buffer | null> {
  if (body == null) return null;
  if (typeof body === "string") {
    assertBodySize(Buffer.byteLength(body, "utf8"), maxBytes);
    return Buffer.from(body, "utf8");
  }
  if (body instanceof URLSearchParams) {
    const encoded = body.toString();
    assertBodySize(Buffer.byteLength(encoded, "utf8"), maxBytes);
    return Buffer.from(encoded, "utf8");
  }
  if (body instanceof ArrayBuffer) {
    assertBodySize(body.byteLength, maxBytes);
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    assertBodySize(body.byteLength, maxBytes);
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) {
    assertBodySize(body.size, maxBytes);
    return Buffer.from(await body.arrayBuffer());
  }
  throw new Error("Streaming or multipart public request bodies are not supported.");
}

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Socket resolver that returns only the address validated for this request. */
export function createPinnedLookup(address: PublicAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

function safeRequestHeaders(init: PublicFetchInit, body: Buffer | null): Record<string, string> {
  const incoming = new Headers(init.headers);
  for (const name of incoming.keys()) {
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) {
      throw new Error(`Public egress header ${name} is managed by the transport.`);
    }
  }
  incoming.set("accept-encoding", "identity");
  if (body) incoming.set("content-length", String(body.byteLength));
  const entries = [...incoming.entries()];
  const headerBytes = entries.reduce(
    (total, [name, value]) => total + Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4,
    2,
  );
  if (headerBytes > MAX_REQUEST_HEADER_BYTES) {
    throw new Error("Public request headers exceed the byte limit.");
  }
  return Object.fromEntries(entries);
}

const nodeTransport: PublicFetchTransport = async ({
  url,
  address,
  init,
  requestBody,
  maxResponseBytes,
  timeoutMs,
}) => {
  const hostname = withoutBrackets(url.hostname);
  const headers = safeRequestHeaders(init, requestBody);
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname,
    port: requestPort(url),
    path: `${url.pathname}${url.search}`,
    method: (init.method ?? "GET").toUpperCase(),
    headers,
    lookup: createPinnedLookup(address),
    family: address.family,
    agent: false,
    maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
  };

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      reject(error);
    };
    const request = httpsRequest(options, (incoming) => {
      const declaredLength = Number(incoming.headers["content-length"] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        finishReject(new Error("Public response exceeds the byte limit."));
        incoming.destroy();
        return;
      }
      const encoding = String(incoming.headers["content-encoding"] ?? "identity").toLowerCase();
      if (encoding !== "identity") {
        finishReject(new Error("Compressed public responses are not accepted."));
        incoming.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on("data", (chunk: Buffer | Uint8Array | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > maxResponseBytes) {
          finishReject(new Error("Public response exceeds the byte limit."));
          incoming.destroy();
          return;
        }
        chunks.push(buffer);
      });
      incoming.on("error", (error) => finishReject(error));
      incoming.on("aborted", () => finishReject(new Error("Public response ended before completion.")));
      incoming.on("close", () => {
        if (!settled && !incoming.complete) finishReject(new Error("Public response closed before completion."));
      });
      incoming.on("end", () => {
        if (settled) return;
        const status = incoming.statusCode ?? 502;
        if (status < 200 || status > 599) {
          finishReject(new Error("Public response returned an invalid status."));
          return;
        }
        try {
          const responseBody = status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks);
          const response = new Response(responseBody, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders(incoming.headers),
          });
          settled = true;
          if (totalTimer) clearTimeout(totalTimer);
          resolve(response);
        } catch (error) {
          finishReject(error instanceof Error ? error : new Error("Public response could not be constructed."));
        }
      });
    });

    request.on("upgrade", (_response, socket) => {
      socket.destroy();
      finishReject(new Error("Public protocol upgrades are not allowed."));
    });
    totalTimer = setTimeout(() => request.destroy(new Error("Public request exceeded its total timeout.")), timeoutMs);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Public request timed out.")));
    request.on("error", finishReject);
    const abort = () => request.destroy(new Error("Public request aborted."));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => {
      init.signal?.removeEventListener("abort", abort);
      if (!settled) finishReject(new Error("Public request closed before the response completed."));
    });
    if (requestBody) request.write(requestBody);
    request.end();
  });
};

// Direct transport seam for deterministic socket/TLS contract tests. Runtime
// callers must use fetchPublicUrl so DNS classification and pinning cannot be
// bypassed.
export const _testOnlyNodeTransport: PublicFetchTransport = nodeTransport;

/**
 * Resolve, classify, and pin one public HTTPS request to the exact validated IP.
 * Redirects are never followed; every hop must be a fresh call and fresh pin.
 */
export async function fetchPublicUrl(
  input: string | URL,
  init: PublicFetchInit = {},
  dependencies: PublicFetchDependencies = {},
): Promise<Response> {
  const url = validateUrl(input, init);
  const timeoutMs = bounded(init.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortWith = (error: Error) => {
    if (controller.signal.aborted) return;
    controller.abort();
    rejectAbort(error);
  };
  const externalAbort = () => abortWith(new Error("Public request aborted."));
  if (init.signal?.aborted) externalAbort();
  else init.signal?.addEventListener("abort", externalAbort, { once: true });
  const deadlineTimer = setTimeout(
    () => abortWith(new Error("Public request exceeded its absolute timeout.")),
    timeoutMs,
  );

  const operation = async () => {
    const maxRequestBytes = bounded(init.maxRequestBytes, DEFAULT_REQUEST_BYTES, MAX_REQUEST_BYTES);
    const requestBody = await bodyBuffer(init.body, maxRequestBytes);
    if (controller.signal.aborted) throw new Error("Public request aborted.");
    // Validate caller-controlled headers before performing DNS. The transport
    // repeats this check when constructing the actual request.
    safeRequestHeaders(init, requestBody);
    const maxResponseBytes = bounded(init.maxResponseBytes, DEFAULT_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
    const addresses = await resolveTarget(url, dependencies.resolver ?? systemResolver);
    if (controller.signal.aborted) throw new Error("Public request aborted.");
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error("Public request exceeded its absolute timeout.");
    return (dependencies.transport ?? nodeTransport)({
      url,
      address: addresses[0],
      init: { ...init, redirect: "manual", signal: controller.signal },
      requestBody,
      maxResponseBytes,
      timeoutMs: remainingMs,
    });
  };

  try {
    return await Promise.race([operation(), abortPromise]);
  } finally {
    clearTimeout(deadlineTimer);
    init.signal?.removeEventListener("abort", externalAbort);
  }
}
