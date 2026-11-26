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

function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => n > 255)) return true; // malformed → block
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** Eight hextets, or null when the text is not an IPv6 address. A dotted IPv4 tail is expanded first. */
function expandIpv6(input: string): number[] | null {
  let ip = input.toLowerCase();
  if (ip.includes("%")) return null;
  const dotted = ip.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const parts = dotted[2].split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => n > 255)) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    ip = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    if (side.startsWith(":") || side.endsWith(":")) return null;
    const bits = side.split(":");
    if (bits.some((hex) => !/^[0-9a-f]{1,4}$/.test(hex))) return null;
    return bits.map((hex) => Number.parseInt(hex, 16));
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseSide(halves[1] ?? "");
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function embeddedIpv4IsPrivate(hextets: number[]): boolean | null {
  const a = hextets[0] ?? 0;
  const b = hextets[1] ?? 0;
  const c = hextets[2] ?? 0;
  const d = hextets[3] ?? 0;
  const e = hextets[4] ?? 0;
  const f = hextets[5] ?? 0;
  const g = hextets[6] ?? 0;
  const h = hextets[7] ?? 0;
  const fromPair = (hi: number, lo: number) => isPrivateIpv4((hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255);
  // IPv4-mapped ::ffff:0:0/96. URL serialization rewrites ::ffff:169.254.169.254 to ::ffff:a9fe:a9fe.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return fromPair(g, h);
  // Deprecated IPv4-compatible ::/96, except :: and ::1 which the caller classifies itself.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && !(g === 0 && h <= 1)) return fromPair(g, h);
  // NAT64 well-known prefix 64:ff9b::/96.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return fromPair(g, h);
  // 6to4 2002::/16 embeds the IPv4 address in the next 32 bits.
  if (a === 0x2002) return fromPair(b, c);
  return null;
}

/** True if an IPv4/IPv6 literal is private, loopback, link-local, ULA, CGNAT, multicast, or embeds such an IPv4 address. */
function isPrivateIp(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return isPrivateIpv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  if (!ip.includes(":")) return false;
  const hextets = expandIpv6(ip);
  if (!hextets) return true; // colon text that is not a real address → block
  const head = hextets[0] ?? 0;
  if (hextets.every((part) => part === 0)) return true; // ::
  if (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) return true; // ::1
  if ((head & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((head & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((head & 0xff00) === 0xff00) return true; // multicast
  if ((head & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  const embedded = embeddedIpv4IsPrivate(hextets);
  if (embedded !== null) return embedded;
  return false;
}

/** True only for a syntactically valid IP literal that is not private or otherwise blocked. */
export function isPublicIpAddress(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIpLiteral(ip)) return false;
  return !isPrivateIp(ip);
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
