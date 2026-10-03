/**
 * Resolve the public origin for redirect URLs.
 *
 * On Fly, req.url is the internal bind address (http://0.0.0.0:3000) which
 * cannot be used in Location headers. This helper resolves the public HTTPS
 * origin from (in order):
 * 1. NEXT_PUBLIC_SITE_URL env var (explicit config)
 * 2. x-forwarded-host header (Fly proxy sets this to the public hostname)
 * 3. host header (standard HTTP)
 * 4. Fallback to https://aria-mantu-app.fly.dev (fail-safe)
 *
 * Always returns an https:// origin, never http://0.0.0.0 or localhost.
 */
export function publicOrigin(headers: Headers): string {
  const explicitSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicitSiteUrl) {
    try {
      const url = new URL(explicitSiteUrl);
      if (url.protocol === "https:" && url.hostname) return url.origin;
    } catch {
      // Invalid URL, fall through
    }
  }

  const forwardedHost = headers.get("x-forwarded-host")?.trim();
  if (forwardedHost && !forwardedHost.includes(",")) {
    return `https://${forwardedHost}`;
  }

  const host = headers.get("host")?.trim();
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("localhost")) {
    return `https://${host}`;
  }

  return "https://aria-mantu-app.fly.dev";
}
