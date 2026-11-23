import { createHash } from "node:crypto";
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

function digestHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function foldPhrase(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Digests of the case-folded owner full name and the bare LinkedIn public id.
// The plaintext is not stored in this file.
const ownerNameDigests = new Set([
  "622eaa91f8fbbf69013d2c70054c9b55ce60944eac6dc19d8511dc42bc66e167",
]);
const barePublicIdDigests = new Set([
  "e678af467bfc79f8709db6c6952358bae84842df9671e61d042a4eba4898476e",
]);

const pemRe = new RegExp("-----BEGIN [A-Z0-9 ]*" + "PRIVATE KEY-----");
const emailRe = /[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g;
const profileRe = /(?:https?:\/\/)?(?:[a-z0-9.-]+\.)?linkedin\.com\/in\/([A-Za-z0-9_%\-]+)/gi;
const bareProfileIdRe = /publicIdentifier['"]?\s*[:=]\s*['"]([A-Za-z0-9_%\-]+)['"]/gi;
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

function listedName(text: string, denylist: ReadonlySet<string>): boolean {
  const words = text.match(/\p{L}+/gu) ?? [];
  for (let i = 0; i < words.length - 1; i += 1) {
    if (denylist.has(digestHex(foldPhrase(`${words[i]} ${words[i + 1]}`)))) return true;
  }
  return false;
}

function listedBareId(text: string, denylist: ReadonlySet<string>): boolean {
  const tokens = text.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? [];
  for (const token of tokens) {
    if (denylist.has(digestHex(token.toLowerCase()))) return true;
  }
  return false;
}

function bareProfileIds(text: string): string[] {
  return [...text.matchAll(bareProfileIdRe)].map((match) => match[1] ?? "");
}

const sampleName = "Alex Example";
const sampleNameDigest = digestHex(foldPhrase(sampleName));
const sampleId = "alexexample";
const sampleIdDigest = digestHex(sampleId);
const sampleIdText = `publicIdentifier='${sampleId}'`;
ok(
  "a listed full name is rejected in either case",
  listedName(`note ${sampleName} today`, new Set([sampleNameDigest])) &&
    listedName("note alex example today", new Set([sampleNameDigest])) &&
    !listedName("Workspace owner approved the change", new Set([sampleNameDigest])),
);
ok(
  "a listed bare public id is rejected outside a profile URL",
  listedBareId(sampleIdText, new Set([sampleIdDigest])) &&
    !listedBareId("https://www.linkedin.com/in/jane-doe", new Set([sampleIdDigest])) &&
    !/linkedin\.com\/in\//.test(sampleIdText),
);
ok(
  "a non-sample publicIdentifier is rejected outside fixtures",
  !slugAllowed(bareProfileIds(sampleIdText)[0] ?? "", "src/app.ts") &&
    slugAllowed(bareProfileIds("publicIdentifier='example-owner'")[0] ?? "", "src/app.ts") &&
    slugAllowed(bareProfileIds(sampleIdText)[0] ?? "", "tests/fixture.ts"),
);
ok(
  "role labels and sample ids do not match the production denylist",
  !listedName("Workspace owner", ownerNameDigests) &&
    !listedBareId("publicIdentifier='example-owner'", barePublicIdDigests),
);

const trackedResult = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (trackedResult.status !== 0) throw new Error("git ls-files failed");
const tracked = trackedResult.stdout.split("\0").filter(Boolean);

const pemHits: string[] = [];
const profileHits: string[] = [];
const addressHits: string[] = [];
const nameHits: string[] = [];
const bareIdHits: string[] = [];

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
  for (const slug of bareProfileIds(text)) {
    if (!slugAllowed(slug, path)) bareIdHits.push(path);
  }
  if (listedName(text, ownerNameDigests)) nameHits.push(path);
  if (listedBareId(text, barePublicIdDigests)) bareIdHits.push(path);
}

ok("tracked files have no PEM private-key block", pemHits.length === 0);
if (pemHits.length > 0) console.error("private-key block paths:", [...new Set(pemHits)].join(", "));
ok("tracked files have no non-sample profile URL outside fixtures", profileHits.length === 0);
if (profileHits.length > 0) console.error("profile URL paths:", [...new Set(profileHits)].join(", "));
ok("tracked files have no non-placeholder address outside fixtures", addressHits.length === 0);
if (addressHits.length > 0) console.error("address paths:", [...new Set(addressHits)].join(", "));
ok("tracked files have no denylisted owner full name", nameHits.length === 0);
if (nameHits.length > 0) console.error("owner-name paths:", [...new Set(nameHits)].join(", "));
ok("tracked files have no denylisted or non-sample bare public id", bareIdHits.length === 0);
if (bareIdHits.length > 0) console.error("bare public id paths:", [...new Set(bareIdHits)].join(", "));

const gitleaks = readFileSync(".gitleaks.toml", "utf8");
ok("gitleaks config does not allowlist whole paths", !/^\s*paths\s*=/m.test(gitleaks));

console.log(`RESULT public-repo-hygiene: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
