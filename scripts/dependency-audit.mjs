import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exceptionPath = resolve(
  root,
  "production-readiness/dependency-audit-exceptions.json",
);
const config = JSON.parse(readFileSync(exceptionPath, "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const blockingSeverities = new Set(["high", "critical"]);

class DependencyAuditError extends Error {}

function fail(message) {
  throw new DependencyAuditError(message);
}

function runAudit(extraArgs) {
  const result = spawnSync(
    npm,
    ["audit", "--json", "--audit-level=high", ...extraArgs],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, npm_config_loglevel: "silent" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) fail(`npm audit could not start: ${result.error.message}`);
  if (result.signal) fail(`npm audit terminated by ${result.signal}`);
  if (result.status !== 0 && result.status !== 1) {
    fail(`npm audit exited unexpectedly with ${result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("npm audit returned malformed JSON");
  }
}

function blockingCount(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (!counts || !Number.isInteger(counts.high) || !Number.isInteger(counts.critical)) {
    fail("npm audit response omitted severity counts");
  }
  return counts.high + counts.critical;
}

function validateException(exception, now) {
  const keys = Object.keys(exception).sort().join(",");
  const expectedKeys = [
    "advisory",
    "allowedNodes",
    "allowedVersions",
    "expiresAt",
    "package",
    "reason",
    "reviewedAt",
    "scope",
    "trackingUrl",
  ].sort().join(",");
  if (keys !== expectedKeys) fail("dependency audit exception schema drifted");
  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(exception.advisory)) {
    fail("dependency audit exception advisory is invalid");
  }
  if (!/^[a-z0-9@/._-]+$/.test(exception.package)) {
    fail("dependency audit exception package is invalid");
  }
  if (exception.scope !== "development-only") {
    fail("dependency audit exception is not development-only");
  }
  if (!Array.isArray(exception.allowedVersions) || exception.allowedVersions.length < 1) {
    fail("dependency audit exception has no exact allowed version");
  }
  if (exception.allowedVersions.some((version) => !/^\d+\.\d+\.\d+$/.test(version))) {
    fail("dependency audit exception version is not exact semver");
  }
  if (
    !Array.isArray(exception.allowedNodes) ||
    exception.allowedNodes.length < 1 ||
    exception.allowedNodes.some(
      (node) =>
        typeof node !== "string" ||
        !/^node_modules(?:\/[a-zA-Z0-9@._-]+)+$/.test(node) ||
        isAbsolute(node) ||
        node.split("/").includes(".."),
    )
  ) {
    fail("dependency audit exception node is not an exact node_modules path");
  }
  if (
    new Set(exception.allowedNodes).size !== exception.allowedNodes.length ||
    new Set(exception.allowedVersions).size !== exception.allowedVersions.length
  ) {
    fail("dependency audit exception contains duplicate authority");
  }
  const canonicalTimestamp = (value) => {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ) {
      return false;
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  };
  if (!canonicalTimestamp(exception.reviewedAt) || !canonicalTimestamp(exception.expiresAt)) {
    fail("dependency audit exception dates are not canonical UTC timestamps");
  }
  const reviewedAt = new Date(exception.reviewedAt);
  const expiresAt = new Date(exception.expiresAt);
  if (reviewedAt > now) fail("dependency audit exception review is in the future");
  if (expiresAt <= reviewedAt) fail("dependency audit exception window is reversed or empty");
  if (expiresAt <= now) fail("dependency audit exception expired");
  if (expiresAt.getTime() - reviewedAt.getTime() > 14 * 24 * 60 * 60 * 1000) {
    fail("dependency audit exception exceeds the 14-day review window");
  }
  if (!/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/\d+$/.test(
    exception.trackingUrl,
  )) {
    fail("dependency audit exception tracking URL is invalid");
  }
  if (typeof exception.reason !== "string" || exception.reason.length < 80 || exception.reason.length > 500) {
    fail("dependency audit exception reason is not bounded");
  }
}

function advisoryIds(vulnerabilities, name, seen = new Set()) {
  if (seen.has(name)) fail(`dependency audit contains a cycle at ${name}`);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !Array.isArray(vulnerability.via)) {
    fail(`dependency audit is missing transitive evidence for ${name}`);
  }
  const nextSeen = new Set(seen).add(name);
  const ids = new Set();
  for (const cause of vulnerability.via) {
    if (typeof cause === "string") {
      for (const id of advisoryIds(vulnerabilities, cause, nextSeen)) ids.add(id);
      continue;
    }
    const match = cause?.url?.match(
      /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/,
    );
    if (!match) fail(`dependency audit advisory evidence is invalid for ${name}`);
    ids.add(match[1]);
  }
  if (ids.size === 0) fail(`dependency audit has no terminal advisory for ${name}`);
  return ids;
}

function validateAuditReports({
  auditConfig,
  now,
  productionReport,
  fullReport,
  readInstalledPackage,
}) {
  if (
    auditConfig === null ||
    typeof auditConfig !== "object" ||
    Array.isArray(auditConfig) ||
    Object.keys(auditConfig).sort().join(",") !== "exceptions,schemaVersion" ||
    auditConfig.schemaVersion !== 1 ||
    !Array.isArray(auditConfig.exceptions)
  ) {
    fail("dependency audit exception file has an unsupported schema");
  }
  const exceptions = new Map();
  for (const exception of auditConfig.exceptions) {
    validateException(exception, now);
    if (exceptions.has(exception.advisory)) {
      fail(`duplicate dependency audit exception ${exception.advisory}`);
    }
    exceptions.set(exception.advisory, exception);
  }

  if (blockingCount(productionReport) !== 0) {
    fail("production dependency graph contains a HIGH or CRITICAL advisory");
  }

  const vulnerabilities = fullReport?.vulnerabilities;
  if (
    !vulnerabilities ||
    typeof vulnerabilities !== "object" ||
    Array.isArray(vulnerabilities)
  ) {
    fail("npm audit response omitted vulnerability details");
  }
  const blocking = Object.entries(vulnerabilities).filter(([, vulnerability]) =>
    blockingSeverities.has(vulnerability.severity),
  );
  const used = new Set();
  for (const [name] of blocking) {
    for (const advisory of advisoryIds(vulnerabilities, name)) {
      if (!exceptions.has(advisory)) {
        fail(`unreviewed blocking advisory ${advisory} reaches ${name}`);
      }
      used.add(advisory);
    }
  }

  for (const [advisory, exception] of exceptions) {
    if (!used.has(advisory)) fail(`unused dependency audit exception ${advisory}`);
    const vulnerability = vulnerabilities[exception.package];
    if (!vulnerability || !Array.isArray(vulnerability.nodes) || vulnerability.nodes.length < 1) {
      fail(`exception package ${exception.package} has no affected install path`);
    }
    if (!advisoryIds(vulnerabilities, exception.package).has(advisory)) {
      fail(`exception advisory ${advisory} does not reach ${exception.package}`);
    }
    const actualNodes = [...vulnerability.nodes].sort();
    const allowedNodes = [...exception.allowedNodes].sort();
    if (
      actualNodes.length !== allowedNodes.length ||
      actualNodes.some((node, index) => node !== allowedNodes[index])
    ) {
      fail(`dependency audit node set drifted for ${exception.package}`);
    }
    for (const node of actualNodes) {
      if (isAbsolute(node) || node.split(/[\\/]+/).includes("..")) {
        fail(`unsafe dependency audit node path for ${exception.package}`);
      }
      const installed = readInstalledPackage(node);
      if (installed.name !== exception.package) {
        fail(`dependency audit node package mismatch at ${node}`);
      }
      if (!exception.allowedVersions.includes(installed.version)) {
        fail(`unreviewed ${exception.package} version ${installed.version}`);
      }
    }
  }

  if (blocking.length !== blockingCount(fullReport)) {
    fail("blocking vulnerability details do not match severity counts");
  }
  return { reviewedAdvisories: used.size, exceptions: [...exceptions.values()] };
}

function installedPackage(node) {
  const packageJsonPath = resolve(root, node, "package.json");
  const nodeModulesRoot = resolve(root, "node_modules") + sep;
  if (!packageJsonPath.startsWith(nodeModulesRoot)) {
    fail(`dependency audit node escaped node_modules at ${node}`);
  }
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    fail(`dependency audit node package metadata is unreadable at ${relative(root, packageJsonPath)}`);
  }
}

function runPolicySelfTest() {
  const now = new Date("2026-07-25T12:00:00.000Z");
  const advisory = "GHSA-mh99-v99m-4gvg";
  const allowedNode = "node_modules/minimatch/node_modules/brace-expansion";
  const baseException = {
    advisory,
    package: "brace-expansion",
    scope: "development-only",
    reviewedAt: "2026-07-25T00:00:00.000Z",
    expiresAt: "2026-08-08T00:00:00.000Z",
    allowedVersions: ["1.1.16"],
    allowedNodes: [allowedNode],
    trackingUrl: "https://github.com/juliangruber/brace-expansion/pull/129",
    reason: "A bounded development-only exception used by the dependency audit policy behavior test fixture.",
  };
  const cleanReport = {
    metadata: { vulnerabilities: { high: 0, critical: 0 } },
    vulnerabilities: {},
  };
  const fullReport = {
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
    vulnerabilities: {
      "brace-expansion": {
        severity: "high",
        nodes: [allowedNode],
        via: [{ url: `https://github.com/advisories/${advisory}` }],
      },
    },
  };
  const base = {
    auditConfig: { schemaVersion: 1, exceptions: [baseException] },
    now,
    productionReport: cleanReport,
    fullReport,
    readInstalledPackage: () => ({ name: "brace-expansion", version: "1.1.16" }),
  };
  const cloneBase = () => ({
    ...base,
    auditConfig: structuredClone(base.auditConfig),
    productionReport: structuredClone(base.productionReport),
    fullReport: structuredClone(base.fullReport),
  });
  let pass = 0;
  const rejects = (name, mutate, expected) => {
    try {
      validateAuditReports(mutate(cloneBase()));
      throw new Error(`${name} was accepted`);
    } catch (error) {
      if (!(error instanceof DependencyAuditError) || !error.message.includes(expected)) throw error;
      pass += 1;
    }
  };

  validateAuditReports(cloneBase());
  pass += 1;
  rejects("future review", (input) => {
    input.auditConfig.exceptions[0].reviewedAt = "2099-07-25T00:00:00.000Z";
    input.auditConfig.exceptions[0].expiresAt = "2099-08-01T00:00:00.000Z";
    return input;
  }, "review is in the future");
  rejects("reversed window", (input) => {
    input.auditConfig.exceptions[0].reviewedAt = "2026-07-24T00:00:00.000Z";
    input.auditConfig.exceptions[0].expiresAt = "2026-07-23T00:00:00.000Z";
    return input;
  }, "window is reversed or empty");
  rejects("expired exception", (input) => {
    input.auditConfig.exceptions[0].reviewedAt = "2026-07-10T00:00:00.000Z";
    input.auditConfig.exceptions[0].expiresAt = "2026-07-24T00:00:00.000Z";
    return input;
  }, "expired");
  rejects("stale exception", (input) => {
    input.fullReport.metadata.vulnerabilities.high = 0;
    input.fullReport.vulnerabilities = {};
    return input;
  }, "unused dependency audit exception");
  rejects("unexpected node", (input) => {
    input.fullReport.vulnerabilities["brace-expansion"].nodes.push(
      "node_modules/other/node_modules/brace-expansion",
    );
    return input;
  }, "node set drifted");
  rejects("unexpected version", (input) => {
    input.readInstalledPackage = () => ({ name: "brace-expansion", version: "1.1.15" });
    return input;
  }, "unreviewed brace-expansion version");
  rejects("advisory package mismatch", (input) => {
    input.fullReport.vulnerabilities["brace-expansion"].severity = "moderate";
    input.fullReport.vulnerabilities["brace-expansion"].via = [
      { url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
    ];
    input.fullReport.vulnerabilities.transitive = {
      severity: "high",
      nodes: ["node_modules/transitive"],
      via: [{ url: `https://github.com/advisories/${advisory}` }],
    };
    input.fullReport.metadata.vulnerabilities.high = 1;
    return input;
  }, `exception advisory ${advisory} does not reach brace-expansion`);
  rejects("malformed audit", (input) => {
    delete input.fullReport.metadata;
    return input;
  }, "omitted severity counts");
  rejects("production high", (input) => {
    input.productionReport.metadata.vulnerabilities.high = 1;
    return input;
  }, "production dependency graph");

  console.log(`RESULT dependency-audit-policy: ${pass} passed, 0 failed`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") {
    runPolicySelfTest();
    return;
  }
  if (args.length !== 0) fail("unsupported command-line argument");
  const result = validateAuditReports({
    auditConfig: config,
    now: new Date(),
    productionReport: runAudit(["--omit=dev"]),
    fullReport: runAudit([]),
    readInstalledPackage: installedPackage,
  });
  console.log(
    `RESULT dependency-audit: production=clean reviewed_dev_advisories=${result.reviewedAdvisories} expires=${result.exceptions
      .map((entry) => entry.expiresAt)
      .sort()[0]}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`dependency-audit: ${message}`);
  process.exitCode = 1;
}
