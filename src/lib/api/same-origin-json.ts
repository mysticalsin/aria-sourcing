export type SameOriginJsonResult =
  | "ok"
  | "unsupported_media_type"
  | "cross_origin_request";

type RequestAuthorityInput = {
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
};

function firstForwarded(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

/**
 * The origin the browser addressed. `nextUrl.origin` is built from the
 * server's bind address, so under `HOSTNAME=0.0.0.0` (Docker) it reads
 * http://0.0.0.0:3000 and never equals a browser Origin. Like Next's own
 * Server Action CSRF check, use the Host the request arrived with (Next fills
 * x-forwarded-host/proto from it when no proxy did). A cross-site page cannot
 * set these headers without a CORS preflight this app never grants.
 */
function addressedOrigin(request: RequestAuthorityInput): string | null {
  try {
    const fallback = new URL(request.nextUrl.origin);
    const host = firstForwarded(request.headers.get("x-forwarded-host")) ??
      request.headers.get("host") ?? fallback.host;
    const proto = firstForwarded(request.headers.get("x-forwarded-proto")) ??
      fallback.protocol.replace(/:$/, "");
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/** True only when the browser's Origin header names the origin it addressed. */
export function isSameOriginRequest(request: RequestAuthorityInput): boolean {
  const origin = request.headers.get("origin");
  const expected = addressedOrigin(request);
  return origin !== null && expected !== null && origin === expected;
}

/** Classify browser mutations before authentication, parsing, or side effects. */
export function classifySameOriginJsonRequest(
  request: RequestAuthorityInput,
): SameOriginJsonResult {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return "unsupported_media_type";
  }
  return isSameOriginRequest(request) ? "ok" : "cross_origin_request";
}
