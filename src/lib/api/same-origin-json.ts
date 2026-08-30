export type SameOriginJsonResult =
  | "ok"
  | "unsupported_media_type"
  | "cross_origin_request";

type RequestAuthorityInput = {
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
};

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",", 1)[0]?.trim() ?? "";
  return first || null;
}

/**
 * Origins that may legitimately call browser mutation routes.
 *
 * Fly/Next standalone sets HOSTNAME=0.0.0.0 for listen binding, which makes
 * `request.nextUrl.origin` become `https://0.0.0.0:3000`. Real browsers send
 * `Origin: https://<public-host>`, so a naive `origin === nextUrl.origin`
 * check rejects every legitimate Source click and the agent path never runs.
 */
export function requestSameOrigin(request: RequestAuthorityInput): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === request.nextUrl.origin) return true;

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? "https";
  if (forwardedHost) {
    try {
      if (origin === new URL(`${forwardedProto}://${forwardedHost}`).origin) {
        return true;
      }
    } catch {
      /* ignore malformed forwarded host */
    }
  }

  const host = firstHeaderValue(request.headers.get("host"));
  if (host) {
    for (const proto of ["https", "http"] as const) {
      try {
        if (origin === new URL(`${proto}://${host}`).origin) return true;
      } catch {
        /* ignore */
      }
    }
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (site) {
    try {
      if (origin === new URL(site).origin) return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}

/** Classify browser mutations before authentication, parsing, or side effects. */
export function classifySameOriginJsonRequest(
  request: RequestAuthorityInput,
): SameOriginJsonResult {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return "unsupported_media_type";
  }
  return requestSameOrigin(request) ? "ok" : "cross_origin_request";
}
