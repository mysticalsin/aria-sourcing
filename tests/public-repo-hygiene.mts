import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", name);
  }
}

const pemRe = new RegExp("-----BEGIN [A-Z0-9 ]*" + "PRIVATE KEY-----");
const emailRe = /[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g;
const profileRe = /(?:https?:\/\/)?(?:[a-z0-9.-]+\.)?linkedin\.com\/in\/([A-Za-z0-9_%\-]+)/gi;
const sampleSlugs = new Set(["jane-doe", "john-doe", "handle"]);
const placeholderDomains = new Set([
  "example.com",
  "example.org",
  "company.com",
  "email.com",
  "yourcompany.com",
  "acme.com",
  "acme.io",
]);

function domainAllowed(domain: string, path: string): boolean {
  const normalized = domain.toLowerCase().replace(/\.$/, "");
  if (normalized === "example.com" || normalized === "example.org") return true;
  // tests/ is the documented fixture tree (sample addresses and profile URLs).
  if (path.startsWith("tests/")) return true;
  if (
    normalized.endsWith(".example") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  return placeholderDomains.has(normalized);
}

function slugAllowed(slug: string, path: string): boolean {
  if (path.startsWith("tests/")) return true;
  const normalized = slug.toLowerCase();
  return normalized.startsWith("example") || sampleSlugs.has(normalized);
}

function skipEmail(text: string, index: number): boolean {
  if (index >= 7 && text.slice(index - 7, index).toLowerCase() === "mailto:") return false;
  return index > 0 && text[index - 1] === ":";
}

const trackedResult = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (trackedResult.status !== 0) throw new Error("git ls-files failed");
const tracked = trackedResult.stdout.split("\0").filter(Boolean);

const pemHits: string[] = [];
const profileHits: string[] = [];
const addressHits: string[] = [];

for (const path of tracked) {
  const bytes = readFileSync(path);
  const latin = bytes.toString("latin1");
  if (pemRe.test(latin)) pemHits.push(path);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const match of text.matchAll(emailRe)) {
    const domain = match[1] ?? "";
    const index = match.index ?? 0;
    if (skipEmail(text, index)) continue;
    if (!domainAllowed(domain, path)) addressHits.push(path);
  }
  for (const match of text.matchAll(profileRe)) {
    const slug = match[1] ?? "";
    if (!slugAllowed(slug, path)) profileHits.push(path);
  }
}

ok("tracked files have no PEM private-key block", pemHits.length === 0);
if (pemHits.length > 0) console.error("private-key block paths:", [...new Set(pemHits)].join(", "));
ok("tracked files have no non-sample profile URL outside fixtures", profileHits.length === 0);
if (profileHits.length > 0) console.error("profile URL paths:", [...new Set(profileHits)].join(", "));
ok("tracked files have no non-placeholder address outside fixtures", addressHits.length === 0);
if (addressHits.length > 0) console.error("address paths:", [...new Set(addressHits)].join(", "));

const gitleaks = readFileSync(".gitleaks.toml", "utf8");
ok("gitleaks config does not allowlist whole paths", !/^\s*paths\s*=/m.test(gitleaks));

console.log(`RESULT public-repo-hygiene: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
