#!/usr/bin/env node

// Keep-going diagnostic runner for environments where the tsx CLI's IPC pipe
// is unavailable. The canonical fail-fast gate remains npm test.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveTestGroup } from "./run-test-manifest.mjs";
import { testManifest } from "../tests/test-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {(executable: string, argv: string[], options: {
 *   cwd: string,
 *   encoding: string,
 *   env: NodeJS.ProcessEnv,
 *   shell: false,
 * }) => {
 *   error?: Error,
 *   signal?: NodeJS.Signals | null,
 *   status: number | null,
 *   stderr?: string,
 *   stdout?: string,
 * }} SandboxSpawn
 */

function sandboxInvocation(command) {
  if (command.executable === "node") {
    return { executable: process.execPath, argv: command.argv };
  }
  if (command.executable === "tsx") {
    return { executable: process.execPath, argv: ["--import", "tsx", ...command.argv] };
  }
  return { executable: "bash", argv: command.argv };
}

export function executeSandboxCommands(
  commands,
  {
    spawn = /** @type {SandboxSpawn} */ (spawnSync),
    cwd = repositoryRoot,
    env = process.env,
    writeLine = console.log,
  } = {},
) {
  const failures = [];
  let passed = 0;

  for (const command of commands) {
    const invocation = sandboxInvocation(command);
    const result = spawn(invocation.executable, invocation.argv, {
      cwd,
      encoding: "utf8",
      env,
      shell: false,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (!result.error && result.status === 0) {
      passed += 1;
      const summary = output.match(/RESULT [^\n]+/)?.[0];
      writeLine(`PASS ${command.id}${summary ? `  | ${summary}` : ""}`);
      continue;
    }

    failures.push({
      id: command.id,
      status: result.status,
      signal: result.signal ?? null,
      error: result.error instanceof Error ? result.error.message : null,
      tail: output.split("\n").slice(-25).join("\n"),
    });
    writeLine(`FAIL ${command.id}  (exit ${String(result.status)})`);
  }

  writeLine("");
  writeLine("==================== SUMMARY ====================");
  writeLine(`commands: ${commands.length}  passed: ${passed}  failed: ${failures.length}`);
  if (failures.length > 0) {
    writeLine("");
    writeLine("---------------- FAILURE DETAIL ----------------");
    for (const failure of failures) {
      writeLine("");
      writeLine(`### ${failure.id} (exit ${String(failure.status)})`);
      writeLine(failure.error ?? failure.tail);
    }
  }
  return { ok: failures.length === 0, failures, passed };
}

export function main() {
  const commands = resolveTestGroup(testManifest, "all");
  return executeSandboxCommands(commands).ok ? 0 : 1;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = main();
