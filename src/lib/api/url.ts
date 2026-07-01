import { URL } from "url";
import { lookup } from "dns/promises";

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

/* ------------------------------------------------------------------------- *
 * PUBLIC-web fetch guard (web-research tools).
 *
 * The OPPOSITE of isAllowedHermesUrl: this allows arbitrary PUBLIC http(s)
 * hosts but BLOCKS anything internal — private RFC1918/CGNAT ranges, loopback,
 * link-local (incl. 169.254.169.254 cloud metadata), IPv6 ULA/link-local,
 * multicast, embedded credentials, and non-http(s) schemes. It also resolves
 * DNS and rejects if ANY resolved address is private, to blunt DNS-rebinding to
 * internal services. Read-only fetches only; callers must also use
 * redirect:"manual" so a 30x can't bounce to an internal host.
 * ------------------------------------------------------------------------- */

/** True if an IPv4/IPv6 literal is private, loopback, link-local, ULA, CGNAT, or multicast. */
function isPrivateIp(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true; // malformed → block
    if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved / broadcast
    return false;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  if (ip.startsWith("fe80")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  if (ip.startsWith("ff")) return true; // multicast
  return false;
}

function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h.includes(":");
}

const METADATA_HOSTS = /^(metadata(\.google\.internal)?|instance-data)$/i;
// Internal-ish TLDs/suffixes that must never be fetched.
const INTERNAL_SUFFIX = /(^|\.)(localhost|internal|local|lan|intranet|corp|home)$/i;

/**
 * Synchronous host classification (no DNS): "blocked" | "public" | "needs-dns".
 * Exported so the SSRF policy is unit-testable offline. Hostnames that aren't IP
 * literals and aren't known-internal return "needs-dns" (resolved by assertPublicUrl).
 */
export function classifyFetchHost(host: string): "blocked" | "public" | "needs-dns" {
  const h = host.toLowerCase().trim();
  if (!h) return "blocked";
  if (METADATA_HOSTS.test(h)) return "blocked";
  if (isIpLiteral(h)) return isPrivateIp(h) ? "blocked" : "public";
  if (h === "localhost" || INTERNAL_SUFFIX.test(h)) return "blocked";
  return "needs-dns";
}

/**
 * Assert a URL is safe to fetch as a PUBLIC resource. Resolves DNS for hostnames
 * and rejects if any address is private. Returns { ok:false, reason } on any block.
 */
export async function assertPublicUrl(
  urlString: string,
): Promise<{ ok: boolean; reason?: string; hostname?: string }> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http/https URLs are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials embedded in the URL are not allowed." };
  }
  const host = url.hostname.toLowerCase();
  const verdict = classifyFetchHost(host);
  if (verdict === "blocked") return { ok: false, reason: "Blocked internal/private host (SSRF guard)." };
  if (verdict === "public") return { ok: true, hostname: host };
  // needs-dns: resolve and ensure every address is public.
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return { ok: false, reason: "Host did not resolve." };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, reason: "Host resolves to a private address (SSRF guard)." };
    }
  } catch {
    return { ok: false, reason: "DNS resolution failed." };
  }
  return { ok: true, hostname: host };
}
