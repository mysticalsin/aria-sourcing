#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateAgentFrameworkProvenance } from "./provenance-policy.mjs";
import {
  DEERFLOW_SOURCE_COMMIT,
  FRAMEWORK_UPSTREAM_IMAGES,
  FLOWISE_SOURCE_COMMIT,
  POSTGRES_SOURCE_COMMIT,
  REDIS_SOURCE_COMMIT,
} from "../../../src/lib/agents/framework/source-identity.mjs";

const SCHEMA = "aria.agent-framework.image-release.v1";
const COMPONENTS = Object.freeze([
  "postgres",
  "redis",
  "model-gateway",
  "deerflow",
  "flowise",
  "flowise-worker",
  "adapter",
]);
const EVIDENCE_KINDS = Object.freeze(["trivy", "spdx", "provenance", "metadata"]);
const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_BUNDLE_BYTES = 512 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  record(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has unexpected fields`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function readSafeFile(file, label, maximum) {
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > maximum) fail(`${label} has an invalid size`);
    return await handle.readFile();
  } catch (error) {
    if (error instanceof Error && /(?:invalid|size|JSON|fields|hash|evidence|Trivy|SBOM|provenance)/i.test(error.message)) throw error;
    fail(`${label} could not be read safely`);
  } finally {
    await handle?.close();
  }
}

function expectedSourceCommits(releaseSha) {
  return Object.freeze({
    postgres: POSTGRES_SOURCE_COMMIT,
    redis: REDIS_SOURCE_COMMIT,
    "model-gateway": releaseSha,
    deerflow: DEERFLOW_SOURCE_COMMIT,
    flowise: FLOWISE_SOURCE_COMMIT,
    "flowise-worker": FLOWISE_SOURCE_COMMIT,
    adapter: releaseSha,
  });
}

function validateTrivy(document, expectedRef) {
  record(document, "Trivy evidence");
  if (document.SchemaVersion !== 2 || document.ArtifactName !== expectedRef) fail("Trivy evidence identity is invalid");
  if (!Array.isArray(document.Results) || document.Results.length < 1) fail("Trivy evidence results are invalid");
  let findings = 0;
  for (const result of document.Results) {
    record(result, "Trivy result");
    if (typeof result.Target !== "string" || !result.Target.trim() || result.Target.length > 4096) {
      fail("Trivy result target is invalid");
    }
    for (const field of ["Vulnerabilities", "Secrets", "Misconfigurations"]) {
      const findingLabel = field === "Vulnerabilities" ? "vulnerability" : field === "Secrets" ? "secret" : "misconfiguration";
      if (result[field] !== null && result[field] !== undefined && !Array.isArray(result[field])) {
        fail(`Trivy ${field} evidence is invalid`);
      }
      for (const finding of result[field] ?? []) {
        record(finding, `Trivy ${findingLabel}`);
        const identifier = field === "Vulnerabilities"
          ? finding.VulnerabilityID
          : field === "Secrets" ? finding.RuleID : finding.ID;
        if (
          typeof identifier !== "string" || !identifier.trim() || identifier.length > 512 ||
          !new Set(["HIGH", "CRITICAL"]).has(finding.Severity)
        ) fail(`Trivy ${findingLabel} is invalid`);
      }
      findings += (result[field] ?? []).length;
    }
  }
  if (findings > 0) fail(`Trivy evidence contains ${findings} blocked findings`);
}

function validateSpdx(document) {
  record(document, "SBOM evidence");
  const creationInfo = document.creationInfo;
  const packages = document.packages;
  const files = document.files;
  if (
    !/^SPDX-2\.[0-9]+$/.test(document.spdxVersion ?? "") ||
    document.SPDXID !== "SPDXRef-DOCUMENT" ||
    document.dataLicense !== "CC0-1.0" ||
    typeof document.name !== "string" || !document.name ||
    typeof document.documentNamespace !== "string" || !document.documentNamespace ||
    !creationInfo || typeof creationInfo !== "object" || Array.isArray(creationInfo) ||
    typeof creationInfo.created !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(creationInfo.created) ||
    !Array.isArray(creationInfo.creators) || creationInfo.creators.length < 1 ||
    !creationInfo.creators.every((creator) => typeof creator === "string" && creator.trim() && creator.length <= 512) ||
    (packages !== undefined && !Array.isArray(packages)) ||
    (files !== undefined && !Array.isArray(files)) ||
    (!Array.isArray(packages) && !Array.isArray(files)) ||
    (packages?.length ?? 0) + (files?.length ?? 0) < 1
  ) fail("SBOM evidence is incomplete");
  for (const item of packages ?? []) {
    record(item, "SBOM package");
    if (!/^SPDXRef-[A-Za-z0-9.-]+$/.test(item.SPDXID ?? "") || typeof item.name !== "string" || !item.name.trim()) {
      fail("SBOM package is invalid");
    }
  }
  for (const item of files ?? []) {
    record(item, "SBOM file");
    if (!/^SPDXRef-[A-Za-z0-9.-]+$/.test(item.SPDXID ?? "") || typeof item.fileName !== "string" || !item.fileName.trim()) {
      fail("SBOM file is invalid");
    }
  }
}

function validateMetadata(document, component, expectedRef) {
  record(document, `${component} metadata`);
  const digest = document[component]?.["containerimage.digest"];
  if (digest !== `sha256:${expectedRef.split("@sha256:")[1]}`) fail(`${component} metadata digest is invalid`);
}

async function readBundle(directory) {
  const bytes = await readSafeFile(path.join(directory, "release-bundle.json"), "release bundle", MAX_BUNDLE_BYTES);
  return parseJson(bytes.toString("utf8"), "release bundle");
}

export async function validateReleaseBundle({
  directory,
  releaseSha,
  repository,
  certificateIdentity,
  certificateIssuer,
}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) fail("release bundle directory is invalid");
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail("release bundle directory is unsafe");
  if (!COMMIT.test(releaseSha ?? "")) fail("release SHA is invalid");
  if (!/^registry\.fly\.io\/[a-z0-9][a-z0-9-]{0,62}$/.test(repository ?? "")) fail("release repository is invalid");
  if (typeof certificateIdentity !== "string" || !certificateIdentity.startsWith("https://github.com/") || certificateIdentity.length > 512) {
    fail("certificate identity is invalid");
  }
  if (certificateIssuer !== "https://token.actions.githubusercontent.com") fail("certificate issuer is invalid");

  const bundle = await readBundle(directory);
  exactKeys(bundle, [
    "schema", "releaseSha", "repository", "certificateIdentity", "certificateIssuer",
    "refs", "sourceCommits", "upstreamImages", "evidence",
  ], "release bundle");
  if (
    bundle.schema !== SCHEMA || bundle.releaseSha !== releaseSha || bundle.repository !== repository ||
    bundle.certificateIdentity !== certificateIdentity || bundle.certificateIssuer !== certificateIssuer
  ) fail("release bundle authority is invalid");

  for (const [value, label] of [
    [bundle.refs, "release refs"],
    [bundle.sourceCommits, "source commits"],
    [bundle.upstreamImages, "upstream images"],
    [bundle.evidence, "release evidence"],
  ]) exactKeys(value, COMPONENTS, label);

  const sources = expectedSourceCommits(releaseSha);
  const expectedFiles = new Set(["release-bundle.json"]);
  const seenRefs = new Set();
  for (const component of COMPONENTS) {
    const ref = bundle.refs[component];
    if (typeof ref !== "string" || !new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@sha256:[0-9a-f]{64}$`).test(ref)) {
      fail(`${component} final image is invalid`);
    }
    if (seenRefs.has(ref)) fail("final image references must be unique by component");
    seenRefs.add(ref);
    if (bundle.sourceCommits[component] !== sources[component]) fail(`${component} source commit is invalid`);
    const upstreamImage = bundle.upstreamImages[component];
    if (typeof upstreamImage !== "string" || !/^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$/.test(upstreamImage)) {
      fail(`${component} upstream image is invalid`);
    }
    if (upstreamImage !== FRAMEWORK_UPSTREAM_IMAGES[component]) fail(`${component} upstream image is not the reviewed identity`);

    exactKeys(bundle.evidence[component], EVIDENCE_KINDS, `${component} evidence`);
    const documents = {};
    for (const kind of EVIDENCE_KINDS) {
      const identity = bundle.evidence[component][kind];
      exactKeys(identity, ["file", "sha256"], `${component} ${kind} identity`);
      const expectedName = `${component}.${kind}.json`;
      if (identity.file !== expectedName || !HASH.test(identity.sha256 ?? "")) fail(`${component} ${kind} identity is invalid`);
      expectedFiles.add(expectedName);
      const bytes = await readSafeFile(path.join(directory, expectedName), `${component} ${kind} evidence`, MAX_EVIDENCE_BYTES);
      if (createHash("sha256").update(bytes).digest("hex") !== identity.sha256) fail(`${component} ${kind} evidence hash mismatch`);
      documents[kind] = parseJson(bytes.toString("utf8"), `${component} ${kind} evidence`);
    }
    validateTrivy(documents.trivy, ref);
    validateSpdx(documents.spdx);
    validateAgentFrameworkProvenance(documents.provenance, { component, releaseSha });
    validateMetadata(documents.metadata, component, ref);
  }

  const actualFiles = await readdir(directory);
  if (JSON.stringify(actualFiles.sort()) !== JSON.stringify([...expectedFiles].sort())) fail("release bundle contains unexpected files");
  return bundle;
}

function image(bundle, component) {
  return Object.freeze({
    ref: bundle.refs[component],
    sourceCommit: bundle.sourceCommits[component],
    certificateIdentity: bundle.certificateIdentity,
    certificateIssuer: bundle.certificateIssuer,
  });
}

export function manifestImagesFromBundle(bundle) {
  exactKeys(bundle, [
    "schema", "releaseSha", "repository", "certificateIdentity", "certificateIssuer",
    "refs", "sourceCommits", "upstreamImages", "evidence",
  ], "release bundle");
  return Object.freeze({
    "deerflow-db": image(bundle, "postgres"),
    "deerflow-redis": image(bundle, "redis"),
    "flowise-db": image(bundle, "postgres"),
    "flowise-redis": image(bundle, "redis"),
    "model-gateway": image(bundle, "model-gateway"),
    deerflow: image(bundle, "deerflow"),
    flowise: image(bundle, "flowise"),
    "flowise-worker": image(bundle, "flowise-worker"),
    "deerflow-adapter": image(bundle, "adapter"),
    "flowise-adapter": image(bundle, "adapter"),
  });
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!/^--[a-z-]+$/.test(key ?? "") || typeof value !== "string" || Object.hasOwn(values, key)) fail("arguments are invalid");
    values[key] = value;
  }
  return values;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const values = parseArguments(args);
  if (command === "validate") {
    exactKeys(values, ["--directory", "--release-sha", "--repository", "--certificate-identity", "--certificate-issuer"], "arguments");
    await validateReleaseBundle({
      directory: path.resolve(values["--directory"]),
      releaseSha: values["--release-sha"],
      repository: values["--repository"],
      certificateIdentity: values["--certificate-identity"],
      certificateIssuer: values["--certificate-issuer"],
    });
    return;
  }
  if (command === "manifest") {
    exactKeys(values, ["--directory", "--output"], "arguments");
    const directory = path.resolve(values["--directory"]);
    const authority = await readBundle(directory);
    const bundle = await validateReleaseBundle({
      directory,
      releaseSha: authority.releaseSha,
      repository: authority.repository,
      certificateIdentity: authority.certificateIdentity,
      certificateIssuer: authority.certificateIssuer,
    });
    const output = path.resolve(values["--output"]);
    if (path.dirname(output) !== directory) fail("manifest output must remain inside the release bundle directory");
    await writeFile(output, `${JSON.stringify({ images: manifestImagesFromBundle(bundle) }, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return;
  }
  fail("usage: release-bundle.mjs validate|manifest [options]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "release bundle failed"}\n`);
    process.exitCode = 1;
  });
}
