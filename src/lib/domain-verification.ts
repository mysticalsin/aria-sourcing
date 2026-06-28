import { promises as dns } from "dns";

/**
 * Lightweight DNS-based deliverability check for a sender domain.
 *
 * Returns true if the domain has at least one of SPF, DKIM, or DMARC evidence.
 * This is a production safety gate: a seat cannot go live until its domain
 * publishes some sender-policy record.
 *
 * Note: DKIM checks require knowing the selector; we look for a common default
 * selector "default._domainkey" as a heuristic. In a real org flow this would
 * be replaced by an explicit DKIM setup check against the email provider.
 */
export async function domainVerified(domain: string): Promise<boolean> {
  const d = domain.toLowerCase().trim();
  if (!d || !d.includes(".")) return false;

  const checks = await Promise.allSettled([
    hasTxtRecord(d, "v=spf1"),
    hasTxtRecord(`_dmarc.${d}`, "v=DMARC1"),
    hasTxtRecord(`default._domainkey.${d}`, "v=DKIM1"),
  ]);

  return checks.some((c) => c.status === "fulfilled" && c.value);
}

async function hasTxtRecord(name: string, prefix: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.resolveTxt(name),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("DNS timeout")), 8_000)),
    ]);
    return records.some((rr) => rr.some((txt) => txt.toLowerCase().startsWith(prefix.toLowerCase())));
  } catch {
    return false;
  }
}
