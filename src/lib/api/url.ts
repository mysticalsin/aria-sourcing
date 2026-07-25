import { URL } from "url";
import { lookup } from "dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Deployment-owned exact-hostname allow-list for the Hermes runtime.
 *
 * The built-in patterns below only cover a developer's loopback and RFC1918
 * ranges. A real deployment reaches Hermes over its own private DNS — Fly, for
 * example, uses `<app>.internal` names on 6PN IPv6 — and none of those forms can
 * be expressed as a static pattern without weakening the guard for everyone.
 *
 * So the deployment names its own hosts, exactly. Read at call time rather than
 * at module load so a test (and a redeploy) can change it. Wildcards, paths and
 * embedded whitespace are rejected: every entry must be a bare hostname or IP
 * literal, which keeps this an allow-list rather than a pattern language.
 *
 * Note the ordering in isAllowedHermesUrl: the SSRF block-list is evaluated
 * BEFORE this, so naming a cloud metadata endpoint here cannot unblock it.
 */
function deploymentAllowedHermesHosts(): Set<string> {
  const raw = process.env.HERMES_ALLOWED_HOSTS ?? "";
  const hosts = new Set<string>();
  for (const entry of raw.split(",")) {
    const host = entry.trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) continue;
    // Bare hostname or IP literal only — no wildcards, no scheme, no path, no port.
    if (!/^[a-z0-9.:_-]+$/.test(host)) continue;
    if (host.includes("*")) continue;
    hosts.add(host);
  }
  return hosts;
}

/**
 * SSRF-safe URL validator for upstream HTTP proxies.
 *
 * Allows only http/https schemes, the private/internal IPs commonly used for
 * local Aria deployments, and any exact hostname the deployment names in
 * HERMES_ALLOWED_HOSTS. Blocks file/ftp/gopher, metadata endpoints, and
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

  // WHATWG URL keeps the surrounding brackets on an IPv6 literal, so
  // `http://[::1]/` yields hostname "[::1]". Strip them before matching:
  // every IPv6 pattern below (`^::1$`, `^fc00:`, `^fe80:`, `^ff00:`) is written
  // against the bare address and would otherwise never fire. Those block
  // patterns were previously unreachable for that reason — harmless only because
  // the default-deny allow-list rejected all IPv6 anyway, which stops being true
  // now that a deployment can name an IPv6 host explicitly.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

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
  const isAllowed =
    allowedHostPatterns.some((pattern) => pattern.test(hostname)) ||
    deploymentAllowedHermesHosts().has(hostname);
  if (!isAllowed) {
    return { ok: false, reason: "Host not in allow-list." };
  }

  return { ok: true };
}

/**
 * True when a Hermes runtime URL is configured but would be refused by the
 * validator above — i.e. the deployment believes it has a live runtime and every
 * request will in fact be rejected before it is sent.
 *
 * This is the silent-misconfiguration case: the client degrades to the
 * deterministic mock, the UI looks healthy, and nothing surfaces it. Readiness
 * consumes this so the deployment fails its own probe instead.
 */
export function hermesRuntimeMisconfigured(hermesApiUrl: string | undefined): boolean {
  const configured = (hermesApiUrl ?? "").trim();
  if (!configured) return false; // Hermes is simply not enabled — not a fault.
  return !isAllowedHermesUrl(configured).ok;
}

/* ------------------------------------------------------------------------- *
 * PUBLIC-web fetch guard (web-research tools).
 *
 * The OPPOSITE of isAllowedHermesUrl: this allows arbitrary PUBLIC http(s)
 * hosts but BLOCKS anything internal — private RFC1918/CGNAT ranges, loopback,
 * link-local (incl. 169.254.169.254 cloud metadata), IPv6 ULA/link-local,
 * multicast, embedded credentials, and non-http(s) schemes. It also resolves
 * DNS and rejects if ANY resolved address is private. This function is a
 * validation helper only: it cannot bind a later socket to that DNS answer.
 * Public callers must use fetchPublicUrl, which validates and pins one address
 * in the same operation. Chromium needs a separate egress-network control.
 * ------------------------------------------------------------------------- */

const BLOCKED_IPS = new BlockList();
const GLOBAL_IPV6 = new BlockList();
const IETF_PROTOCOL_ASSIGNMENTS = new BlockList();
const IETF_GLOBAL_EXCEPTIONS = new BlockList();

// IANA currently allocates global unicast from 2000::/3. The IETF protocol
// assignment block is non-global by default, with the current registry's
// explicit globally reachable more-specific exceptions below.
GLOBAL_IPV6.addSubnet("2000::", 3, "ipv6");
IETF_PROTOCOL_ASSIGNMENTS.addSubnet("2001::", 23, "ipv6");
for (const [network, prefix] of [
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:1::3", 128],
  ["2001:3::", 32],
  ["2001:4:112::", 48],
  ["2001:30::", 28],
] as const) {
  IETF_GLOBAL_EXCEPTIONS.addSubnet(network, prefix, "ipv6");
}

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_IPS.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_IPS.addSubnet(network, prefix, "ipv6");
}

/** True if an IP literal is non-global, malformed, or unsafe for public egress. */
function isPrivateIp(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 4) return BLOCKED_IPS.check(ip, "ipv4");
  if (!GLOBAL_IPV6.check(ip, "ipv6")) return true;
  if (
    IETF_PROTOCOL_ASSIGNMENTS.check(ip, "ipv6") &&
    !IETF_GLOBAL_EXCEPTIONS.check(ip, "ipv6")
  ) {
    return true;
  }
  return BLOCKED_IPS.check(ip, "ipv6");
}

/** True only for a syntactically valid, globally routable IP literal. */
export function isPublicIpAddress(ipRaw: string): boolean {
  return !isPrivateIp(ipRaw);
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
 * Preflight-classify a PUBLIC URL. This does not make a later global fetch safe;
 * use fetchPublicUrl for a connection-bound request.
 */
export async function assertPublicUrl(
  urlString: string,
  options: {
    lookupImpl?: (
      hostname: string,
      options: { all: true },
    ) => Promise<readonly { address: string; family: number }[]>;
    timeoutMs?: number;
  } = {},
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
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
    return { ok: false, reason: "Invalid DNS timeout." };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookupImpl = options.lookupImpl ?? ((hostname: string) => lookup(hostname, { all: true }));
    const addrs = await Promise.race([
      lookupImpl(host, { all: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("DNS resolution timed out.")), timeoutMs);
      }),
    ]);
    if (!addrs.length) return { ok: false, reason: "Host did not resolve." };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, reason: "Host resolves to a private address (SSRF guard)." };
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && /timed out/i.test(error.message)
        ? "DNS resolution timed out."
        : "DNS resolution failed.",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { ok: true, hostname: host };
}
