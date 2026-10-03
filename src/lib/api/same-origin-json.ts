export type SameOriginJsonResult =
  | "ok"
  | "unsupported_media_type"
  | "cross_origin_request";

type RequestAuthorityInput = {
  headers: Pick<Headers, "get">;
  nextUrl: { origin: string };
};

/**
 * Bind addresses Next/Fly use for `req.nextUrl.origin` that browsers never send
 * as `Origin`. Accepting them would either never match real browsers (Fly) or
 * accept a nonsense CSRF origin.
 */
function isNonBrowserBindOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "0.0.0.0" || host === "::" || host === "[::]";
  } catch {
    return true;
  }
}

/**
 * Origins a real browser may present for this deployment.
 *
 * Never derived from attacker-controlled request headers (`x-forwarded-host`).
 * On Fly, `req.nextUrl.origin` is the internal bind (`http://0.0.0.0:3000`), so
 * production relies on `NEXT_PUBLIC_SITE_URL` and the canonical tenant hostname.
 */
export function trustedBrowserOrigins(nextUrlOrigin?: string): string[] {
  const trusted = new Set<string>();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      trusted.add(new URL(site).origin);
    } catch {
      // ignore invalid config
    }
  }
  trusted.add("https://aria-mantu-app.fly.dev");
  if (nextUrlOrigin && !isNonBrowserBindOrigin(nextUrlOrigin)) {
    trusted.add(nextUrlOrigin);
  }
  return [...trusted];
}

/** True when the request Origin matches this deployment's browser origin(s). */
export function isTrustedBrowserOrigin(
  origin: string | null,
  nextUrlOrigin: string,
): boolean {
  if (!origin) return false;
  return trustedBrowserOrigins(nextUrlOrigin).includes(origin);
}

/** Classify browser mutations before authentication, parsing, or side effects. */
export function classifySameOriginJsonRequest(
  request: RequestAuthorityInput,
): SameOriginJsonResult {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return "unsupported_media_type";
  }
  const origin = request.headers.get("origin");
  return isTrustedBrowserOrigin(origin, request.nextUrl.origin)
    ? "ok"
    : "cross_origin_request";
}
