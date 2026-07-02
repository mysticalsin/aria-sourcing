import dnsModule from "dns";
import { domainVerified } from "../src/lib/domain-verification";

/*
 * Target: src/lib/domain-verification.ts — the DNS-based sender-policy gate
 * that /api/outreach/send relies on before it will let a real email go out
 * for a not-yet-verified seat domain. The real behavior (read from source,
 * not assumed) is an OR across SPF / DMARC / a default-selector DKIM TXT
 * record: ANY one of the three being present is enough to verify, and a
 * lookup failure on a given record is swallowed and treated as absent for
 * that record (so an all-failures domain is unverified, i.e. fails closed).
 *
 * `import { promises as dns } from "dns"` in the source module binds to the
 * same singleton object as this file's `import dnsModule from "dns"`, so
 * mutating `dnsModule.promises.resolveTxt` here reaches the source's calls.
 */

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalResolveTxt = dnsModule.promises.resolveTxt;
function restoreDns() {
  dnsModule.promises.resolveTxt = originalResolveTxt;
}

/** Install a resolveTxt mock keyed by exact DNS name; any other name rejects (NXDOMAIN). */
function mockDns(table: Record<string, string[][]>, calls: string[] = []) {
  dnsModule.promises.resolveTxt = (async (name: string) => {
    calls.push(name);
    if (name in table) return table[name];
    const err = new Error("queryTxt ENOTFOUND " + name) as NodeJS.ErrnoException;
    err.code = "ENOTFOUND";
    throw err;
  }) as typeof dnsModule.promises.resolveTxt;
}

// --- Fully verified: SPF + DMARC + DKIM selector all present ---------------
{
  const calls: string[] = [];
  mockDns(
    {
      "good.example.com": [["v=spf1 include:_spf.example.com ~all"]],
      "_dmarc.good.example.com": [["v=DMARC1; p=none;"]],
      "default._domainkey.good.example.com": [["v=DKIM1; k=rsa; p=abc"]],
    },
    calls,
  );
  const result = await domainVerified("good.example.com");
  ok("all three sender-policy records present -> verified true", result === true);
  ok(
    "queries SPF, DMARC and default-selector DKIM DNS names",
    calls.includes("good.example.com") && calls.includes("_dmarc.good.example.com") && calls.includes("default._domainkey.good.example.com"),
  );
  restoreDns();
}

// --- OR semantics: a single signal (SPF only) is already enough ------------
{
  mockDns({ "spf-only.example.com": [["v=spf1 -all"]] });
  ok("SPF alone verifies the domain (OR semantics, not AND)", (await domainVerified("spf-only.example.com")) === true);
  restoreDns();
}
{
  mockDns({ "_dmarc.dmarc-only.example.com": [["v=DMARC1; p=reject;"]] });
  ok("DMARC alone verifies the domain (OR semantics, not AND)", (await domainVerified("dmarc-only.example.com")) === true);
  restoreDns();
}

// --- TXT records exist but none match the expected prefixes -> unverified --
{
  mockDns({
    "bare.example.com": [["some-other-txt-record=1"]],
    "_dmarc.bare.example.com": [["unrelated=1"]],
    "default._domainkey.bare.example.com": [["unrelated=1"]],
  });
  ok("unrelated TXT records present but no SPF/DMARC/DKIM prefix -> not verified", (await domainVerified("bare.example.com")) === false);
  restoreDns();
}

// --- Lookup failure on every query -> fails closed (not verified) ----------
{
  mockDns({}); // every name misses the table -> throws ENOTFOUND
  ok("DNS lookup failure on all three queries -> fails closed, not verified", (await domainVerified("nxdomain.example.com")) === false);
  restoreDns();
}

// --- Malformed domain input: rejected before any DNS query -----------------
{
  const calls: string[] = [];
  mockDns({}, calls);
  ok("empty domain -> not verified", (await domainVerified("")) === false);
  ok("domain without a dot -> not verified", (await domainVerified("localhost")) === false);
  ok("malformed domain input never triggers a DNS lookup", calls.length === 0);
  restoreDns();
}

// --- Case + whitespace normalization before querying DNS -------------------
{
  const calls: string[] = [];
  mockDns({ "case.example.com": [["v=spf1 -all"]] }, calls);
  const result = await domainVerified("  Case.Example.COM  ");
  ok("uppercase/whitespace domain still verifies (normalized before lookup)", result === true);
  ok("DNS is queried using the lowercased, trimmed domain", calls.includes("case.example.com"));
  restoreDns();
}

console.log(`RESULT domain-verification: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
