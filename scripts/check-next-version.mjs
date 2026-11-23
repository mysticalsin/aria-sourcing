#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Advisories `npm audit` reports for next@16.4.3. Each floor is the first
 * patched release on the 16.x line (GitHub Advisory Database / next 16.4.5).
 *
 * @type {readonly {id: string, patched: string, summary: string}[]}
 */
export const NEXT_ADVISORIES = [
  {
    id: "GHSA-mfr8-8qww-v76h",
    patched: "16.4.5",
    summary: "Information disclosure across root params when a 'use cache' function is called through unstable_cache()",
  },
  {
    id: "GHSA-vc7v-qv4w-wrv8",
    patched: "16.4.5",
    summary: "Cache leak across root param values in nested 'use cache' functions via delayed inner stream metadata",
  },
  {
    id: "GHSA-vvgp-ww4w-46vf",
    patched: "16.4.5",
    summary: "Cache poisoning of shared fallback shells in Cache Components via request-supplied placeholder route params",
  },
  {
    id: "GHSA-rhh4-g77r-r9qj",
    patched: "16.4.5",
    summary: "Cross-user cache disclosure and poisoning in Next.js use cache with binary arguments",
  },
  {
    id: "GHSA-pc58-hwjq-p385",
    patched: "16.4.5",
    summary: "Cross-client response injection and disclosure in self-hosted Next.js applications forwarding fetched responses",
  },
  {
    id: "GHSA-7qx7-33qx-rqx2",
    patched: "16.4.5",
    summary: "SVG rejection bypass in the image optimization",
  },
  {
    id: "GHSA-f3mh-rxg3-f5g2",
    patched: "16.4.5",
    summary: "HttpOnly cookie exposure through internal response header on Next.js Edge runtime routes",
  },
];

/**
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
export function parseRelease(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {readonly [number, number, number]} left
 * @param {readonly [number, number, number]} right
 * @returns {number}
 */
function compareRelease(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Advisories whose first patched release is newer than `version`.
 * Unstable or unparsable versions fail closed and miss every floor.
 *
 * @param {string} version
 * @returns {typeof NEXT_ADVISORIES[number][]}
 */
export function unmetAdvisories(version) {
  const installed = parseRelease(version);
  if (!installed) return [...NEXT_ADVISORIES];
  return NEXT_ADVISORIES.filter((advisory) => {
    const patched = parseRelease(advisory.patched);
    if (!patched) return true;
    return compareRelease(installed, patched) < 0;
  });
}

/**
 * @param {string} [root]
 * @returns {string}
 */
export function readInstalledNextVersion(root = repositoryRoot) {
  const manifestPath = join(root, "node_modules", "next", "package.json");
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unreadable";
    throw new Error(`Cannot read the installed next package at ${manifestPath} (${code}).`);
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.version !== "string") {
    throw new Error(`Installed next package has no version string at ${manifestPath}.`);
  }
  return parsed.version;
}

/**
 * @param {string} version
 * @returns {string}
 */
export function formatNextVersionReport(version) {
  const unmet = unmetAdvisories(version);
  if (unmet.length === 0) {
    return `next ${version} meets the first patched release for ${NEXT_ADVISORIES.length} advisories.`;
  }
  const lines = [
    `next ${version} is below the first patched release for ${unmet.length} advisories:`,
    ...unmet.map((advisory) => `${advisory.id} requires >= ${advisory.patched} (${advisory.summary})`),
  ];
  return lines.join("\n");
}

function main() {
  let version;
  try {
    version = readInstalledNextVersion();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read the installed next package.";
    console.error(message);
    process.exit(1);
  }
  const report = formatNextVersionReport(version);
  if (unmetAdvisories(version).length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
