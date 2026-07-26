import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();
const providerEgressPath = "src/lib/sourcing/provider-egress.ts";
const providerTransportPath = "src/lib/sourcing/provider-transport.ts";
const transportAllowlist = [
  {
    path: "src/lib/ai/web-tools.ts",
    justification: "Uses an injected SSRF-guarded fetchImpl and is covered by web-tools/web-tavily security suites.",
  },
] as const;
const providerProbeAllowlist = [
  {
    path: providerEgressPath,
    justification: "Defines the probe clearance helper and delegates minting to provider transport.",
  },
  {
    path: "src/app/api/source/route.ts",
    justification: "Uses probe clearances only for fixed GitHub rate-limit and authenticated-user credential checks.",
  },
  {
    path: "src/app/api/keys/test/route.ts",
    justification: "Uses probe clearances only for fixed provider API-key authentication checks.",
  },
] as const;
const prohibitedTransportModules = [
  "@/lib/api/public-fetch",
  "undici",
  "node:http",
  "node:https",
  "node:net",
  "https",
  "http",
] as const;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const abs = join(root, dir, entry);
    const rel = relative(root, abs);
    const stats = statSync(abs);
    if (stats.isDirectory()) return walk(rel);
    return /\.(?:ts|tsx|mts)$/.test(entry) ? [rel] : [];
  });
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("provider egress chokepoint owns provider sockets", () => {
  assert.deepEqual(
    transportAllowlist.map((entry) => entry.path),
    ["src/lib/ai/web-tools.ts"],
  );
  assert.match(transportAllowlist[0].justification, /injected SSRF-guarded fetchImpl/);

  const providerEgress = read(providerEgressPath);
  assert.match(providerEgress, /validateSourcingCriteria/);

  const providerTransport = read(providerTransportPath);
  assert.equal(providerTransport.split(/\r?\n/, 1)[0], 'import "server-only";');
  assert.doesNotMatch(providerTransport, /@\/lib\/sourcing\//);
  assert.match(providerTransport, /declare const CLEARANCE: unique symbol/);
  assert.match(providerTransport, /export async function sourcingFetch/);

  for (const [provider, host] of [
    ["GitHub", "api.github.com"],
    ["Apify", "api.apify.com"],
    ["Apollo", "api.apollo.io"],
    ["Seamless", "api.seamless.ai"],
    ["Sillage", "api.getsillage.com"],
    ["Tavily", "api.tavily.com"],
    ["DuckDuckGo", "api.duckduckgo.com"],
  ]) {
    assert.match(providerTransport, new RegExp(`${provider}: "${host.replaceAll(".", "\\.")}"`));
  }

  const scannedFiles = [
    ...walk("src/lib/sourcing"),
    ...walk("src/app/api/source"),
    ...walk("src/lib/enrichment"),
    ...transportAllowlist.map((entry) => entry.path),
  ];
  const allowed = new Set<string>([providerTransportPath, ...transportAllowlist.map((entry) => entry.path)]);
  const uniqueScannedFiles = scannedFiles.filter((file, index, files) => files.indexOf(file) === index);
  const rawFetchFiles = uniqueScannedFiles
    .filter((file) => !allowed.has(file))
    .filter((file) => /\bfetch\s*\(/.test(read(file)));

  assert.deepEqual(rawFetchFiles, []);

  const transportModulePattern = prohibitedTransportModules.map(regexEscape).join("|");
  const transportImportPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:`
      + String.raw`import(?:\s+type)?[\s\S]*?\bfrom\s*["'](?:${transportModulePattern})["']`
      + String.raw`|import\s*["'](?:${transportModulePattern})["']`
      + String.raw`|(?:const|let|var)\s+[^=\n]+\s*=\s*require\(\s*["'](?:${transportModulePattern})["']\s*\)`
      + String.raw`|import\(\s*["'](?:${transportModulePattern})["']\s*\)`
      + String.raw`)`,
  );
  const fetchAliasPattern =
    /\b(?:const|let|var)\s+(?:(?:[A-Za-z_$][\w$]*)\s*=\s*(?:fetch\b|globalThis\.fetch\b)|\{[^}\n]*\bfetch\b(?:\s*:\s*[A-Za-z_$][\w$]*)?[^}\n]*\}\s*=\s*globalThis\b)/;
  const transportImportFiles = uniqueScannedFiles
    .filter((file) => !allowed.has(file))
    .filter((file) => transportImportPattern.test(read(file)) || fetchAliasPattern.test(read(file)));

  assert.deepEqual(transportImportFiles, []);
});

test("provider clearance cannot be cast outside the chokepoint", () => {
  const forbidden = "as " + "ProviderClearance";
  const offenders = walk("src")
    .filter((file) => file !== providerTransportPath)
    .filter((file) => read(file).includes(forbidden));
  assert.deepEqual(offenders, []);
});

test("provider transport mint helper is reachable only from policy egress", () => {
  const importers = walk("src")
    .filter((file) => file !== providerTransportPath)
    .filter((file) => /mintProviderClearance/.test(read(file)));
  assert.deepEqual(importers, [providerEgressPath]);
});

test("provider probe clearance is confined to fixed-endpoint credential checks", () => {
  assert.deepEqual(
    providerProbeAllowlist.map((entry) => entry.path),
    [
      providerEgressPath,
      "src/app/api/source/route.ts",
      "src/app/api/keys/test/route.ts",
    ],
  );
  assert.match(providerProbeAllowlist[0].justification, /Defines the probe clearance helper/);
  assert.match(providerProbeAllowlist[1].justification, /fixed GitHub rate-limit and authenticated-user credential checks/);
  assert.match(providerProbeAllowlist[2].justification, /fixed provider API-key authentication checks/);

  const allowed = new Set<string>(providerProbeAllowlist.map((entry) => entry.path));
  const probeReferences = walk("src")
    .filter((file) => /clearProviderProbe/.test(read(file)));
  assert.deepEqual(probeReferences.sort(), [...allowed].sort());
});
