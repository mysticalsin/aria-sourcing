import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();
const providerEgressPath = "src/lib/sourcing/provider-egress.ts";
const providerTransportPath = "src/lib/sourcing/provider-transport.ts";
const allowlist = [
  {
    path: "src/lib/ai/web-tools.ts",
    justification: "Uses an injected SSRF-guarded fetchImpl and is covered by web-tools/web-tavily security suites.",
  },
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

test("provider egress chokepoint owns provider sockets", () => {
  assert.deepEqual(
    allowlist.map((entry) => entry.path),
    ["src/lib/ai/web-tools.ts"],
  );
  assert.match(allowlist[0].justification, /injected SSRF-guarded fetchImpl/);

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
    ...allowlist.map((entry) => entry.path),
  ];
  const allowed = new Set<string>([providerTransportPath, ...allowlist.map((entry) => entry.path)]);
  const rawFetchFiles = scannedFiles
    .filter((file, index, files) => files.indexOf(file) === index)
    .filter((file) => !allowed.has(file))
    .filter((file) => /\bfetch\s*\(/.test(read(file)));

  assert.deepEqual(rawFetchFiles, []);
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
