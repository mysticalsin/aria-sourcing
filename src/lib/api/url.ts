import { URL } from "url";

/**
 * SSRF-safe URL validator for upstream HTTP proxies.
 *
 * Allows only http/https schemes and private/internal IPs commonly used for
 * local Aria deployments. Blocks file/ftp/gopher, metadata endpoints, and
 * ambiguous hostnames that could resolve to internal services.
 */
export function isAllowedHermesUrl(urlString: string): { ok: boolean; reason?: string } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http/https schemes are allowed." };
  }

  const hostname = url.hostname.toLowerCase();

  // Block metadata / link-local / broadcast / wildcard / cloud metadata addresses.
  const blockedHostPatterns = [
    /^169\.254\.\d+\.\d+$/, // link-local IPv4
    /^127\.(?!0\.0\.1$)\d+\.\d+\.\d+$/, // loopback IPv4 except exact 127.0.0.1
    /^0\.\d+\.\d+\.\d+$/, // current network
    /^255\.\d+\.\d+\.\d+$/, // broadcast
    /^::1$/, // loopback IPv6
    /^::$/, // unspecified IPv6
    /^fc00:/i, // unique local IPv6
    /^fe80:/i, // link-local IPv6
    /^ff00:/i, // multicast IPv6
    /^metadata$/, // AWS / GCP metadata
    /^metadata\.google\.internal$/,
    /^instance-data$/,
    /^169\.254\./,
  ];
  for (const pattern of blockedHostPatterns) {
    if (pattern.test(hostname)) {
      return { ok: false, reason: "Blocked host pattern (SSRF guard)." };
    }
  }

  // Allow common local hostnames and private IP prefixes used for Aria.
  const allowedHostPatterns = [
    /^localhost$/,
    /^127\.0\.0\.1$/,
    /^hermes$/,
    /^hermes-agent$/,
    /^gateway$/,
    /^host\.docker\.internal$/,
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
  ];
  const isAllowed = allowedHostPatterns.some((pattern) => pattern.test(hostname));
  if (!isAllowed) {
    return { ok: false, reason: "Host not in allow-list." };
  }

  return { ok: true };
}
