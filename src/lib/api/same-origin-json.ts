export type SameOriginJsonResult =
  | "ok"
  | "unsupported_media_type"
  | "cross_origin_request";

type RequestAuthorityInput = {
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
};

const WILDCARD_BIND_HOSTS = new Set(["::", "[::]", "0.0.0.0"]);

function canonicalHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim() ?? "";
  return first || null;
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostnameOf(hostOrOrigin: string): string | null {
  const asOrigin = originOf(hostOrOrigin);
  if (asOrigin) {
    try {
      return new URL(asOrigin).hostname;
    } catch {
      return null;
    }
  }
  try {
    return new URL(`http://${hostOrOrigin}`).hostname;
  } catch {
    return null;
  }
}

function isWildcardBindHost(host: string): boolean {
  const hostname = hostnameOf(host);
  if (hostname === null) return false;
  return WILDCARD_BIND_HOSTS.has(hostname) || WILDCARD_BIND_HOSTS.has(canonicalHostname(hostname));
}

/**
 * Site origins the browser may claim. nextUrl.origin is the listen address
 * behind Fly (`http://[::]:3000`) and is not the product host. Prefer Host
 * when it is not a wildcard bind; otherwise X-Forwarded-Host + proto.
 */
export function requestSiteOrigins(request: RequestAuthorityInput): readonly string[] {
  const origins = new Set<string>();
  const nextOrigin = originOf(request.nextUrl.origin);
  if (nextOrigin && !isWildcardBindHost(nextOrigin)) origins.add(nextOrigin);

  const hostHeader = firstHeaderValue(request.headers.get("host"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const publicHost =
    hostHeader && !isWildcardBindHost(hostHeader) ? hostHeader : forwardedHost;
  if (!publicHost || isWildcardBindHost(publicHost)) return [...origins];

  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : hostnameOf(publicHost) === "localhost" || hostnameOf(publicHost) === "127.0.0.1"
        ? "http"
        : "https";
  const publicOrigin = originOf(`${proto}://${publicHost}`);
  if (publicOrigin) origins.add(publicOrigin);
  return [...origins];
}

export function isSameSiteOrigin(request: RequestAuthorityInput, origin: string | null): boolean {
  const claimed = origin ? originOf(origin) : null;
  if (!claimed) return false;
  return requestSiteOrigins(request).includes(claimed);
}

/** Classify browser mutations before authentication, parsing, or side effects. */
export function classifySameOriginJsonRequest(
  request: RequestAuthorityInput,
): SameOriginJsonResult {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return "unsupported_media_type";
  }
  return isSameSiteOrigin(request, request.headers.get("origin"))
    ? "ok"
    : "cross_origin_request";
}
