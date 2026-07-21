#!/usr/bin/env node

import {
  appendFileSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { testManifest } from "../tests/test-manifest.mjs";

export const TEST_MANIFEST_TRACE_FILE = "ARIA_TEST_MANIFEST_TRACE_FILE";

const allowedExecutables = new Set(["bash", "node", "tsx"]);
const lifecycleGroups = ["pretest", "application", "posttest"];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {(executable: string, argv: string[], options: {
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   shell: false,
 *   stdio: string,
 * }) => {
 *   error?: Error,
 *   signal?: NodeJS.Signals | null,
 *   status: number | null,
 * }} ManifestSpawn
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

export function validateTestManifest(manifest) {
  if (!isRecord(manifest) || !hasExactKeys(manifest, ["commands", "groups", "version"])) {
    throw new Error("Test manifest must contain only version, commands, and groups.");
  }
  if (manifest.version !== 1) throw new Error("Unsupported test manifest version.");
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    throw new Error("Test manifest commands must be a non-empty array.");
  }
  if (!isRecord(manifest.groups)) throw new Error("Test manifest groups must be an object.");
  if (Object.hasOwn(manifest.groups, "all")) {
    throw new Error("The all group is derived and must not be stored.");
  }

  const commands = new Map();
  for (const command of manifest.commands) {
    if (!isRecord(command) || !hasExactKeys(command, ["argv", "executable", "id"])) {
      throw new Error("Every test command must contain only id, executable, and argv.");
    }
    if (typeof command.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(command.id)) {
      throw new Error("Test command identifiers must be non-empty lowercase slugs.");
    }
    if (commands.has(command.id)) throw new Error(`Duplicate test command identifier: ${command.id}`);
    if (typeof command.executable !== "string" || !allowedExecutables.has(command.executable)) {
      throw new Error(`Unsupported test executable for ${command.id}.`);
    }
    if (
      !Array.isArray(command.argv) ||
      command.argv.length === 0 ||
      command.argv.some((argument) => typeof argument !== "string" || argument.length === 0)
    ) {
      throw new Error(`Test command ${command.id} must have a non-empty string argv array.`);
    }
    commands.set(command.id, command);
  }

  for (const group of lifecycleGroups) {
    if (!Object.hasOwn(manifest.groups, group)) {
      throw new Error(`Required test group is missing: ${group}`);
    }
  }
  for (const [group, identifiers] of Object.entries(manifest.groups)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group)) {
      throw new Error(`Invalid test group name: ${group}`);
    }
    if (!Array.isArray(identifiers) || identifiers.length === 0) {
      throw new Error(`Test group ${group} must be a non-empty array.`);
    }
    for (const identifier of identifiers) {
      if (typeof identifier !== "string" || !commands.has(identifier)) {
        throw new Error(`Test group ${group} references unknown command: ${String(identifier)}`);
      }
    }
  }
  return commands;
}

export function resolveTestGroup(manifest, group) {
  const commands = validateTestManifest(manifest);
  const phases = group === "all"
    ? lifecycleGroups
    : Object.hasOwn(manifest.groups, group)
      ? [group]
      : null;
  if (!phases) throw new Error(`Unknown test group: ${group}`);

  return phases.flatMap((phase) =>
    manifest.groups[phase].map((identifier) => ({
      phase,
      ...commands.get(identifier),
    })),
  );
}

function invocationFor(command) {
  if (command.executable === "node") {
    return { executable: process.execPath, argv: command.argv };
  }
  if (command.executable === "tsx") {
    return { executable: process.execPath, argv: ["--import", "tsx", ...command.argv] };
  }
  return { executable: "bash", argv: command.argv };
}

export function executeResolvedCommands(
  commands,
  {
    spawn = /** @type {ManifestSpawn} */ (spawnSync),
    cwd = repositoryRoot,
    env = process.env,
    keepGoing = false,
    stdio = "inherit",
  } = {},
) {
  const failures = [];
  for (const command of commands) {
    const invocation = invocationFor(command);
    const result = spawn(invocation.executable, invocation.argv, {
      cwd,
      env,
      shell: false,
      stdio,
    });
    const failed = Boolean(result.error) || result.status !== 0;
    if (!failed) continue;
    failures.push({
      id: command.id,
      status: result.status,
      signal: result.signal ?? null,
      error: result.error instanceof Error ? result.error.message : null,
    });
    if (!keepGoing) break;
  }
  return { ok: failures.length === 0, failures };
}

function existingTraceRecords(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Test manifest trace path must be a pre-created regular file.");
  }
  const body = readFileSync(path, "utf8").trim();
  if (!body) return [];
  return body.split(/\r?\n/).map((line) => JSON.parse(line));
}

export function appendTrace(path, commands) {
  const existing = existingTraceRecords(path);
  const occurrences = new Map();
  for (const record of existing) {
    occurrences.set(record.id, Math.max(occurrences.get(record.id) ?? 0, record.occurrence ?? 0));
  }
  const records = commands.map((command, offset) => {
    const occurrence = (occurrences.get(command.id) ?? 0) + 1;
    occurrences.set(command.id, occurrence);
    return {
      index: existing.length + offset,
      occurrence,
      phase: command.phase,
      id: command.id,
      executable: command.executable,
      argv: command.argv,
    };
  });
  if (records.length > 0) {
    appendFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  return records;
}

function parseCli(argv) {
  if (argv.length !== 2 || !["--group", "--list"].includes(argv[0]) || !argv[1]) {
    throw new Error("Usage: run-test-manifest.mjs (--group|--list) <group>");
  }
  return { mode: argv[0] === "--list" ? "list" : "run", group: argv[1] };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { mode, group } = parseCli(argv);
  const commands = resolveTestGroup(testManifest, group);
  if (mode === "list") {
    commands.forEach((command, index) => {
      process.stdout.write(`${JSON.stringify({ index, ...command })}\n`);
    });
    return 0;
  }

  const tracePath = env[TEST_MANIFEST_TRACE_FILE];
  if (tracePath) {
    appendTrace(tracePath, commands);
    return 0;
  }
  return executeResolvedCommands(commands, { env }).ok ? 0 : 1;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
