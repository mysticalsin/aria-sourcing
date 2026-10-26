import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  executeResolvedCommands,
  resolveTestGroup,
  TEST_MANIFEST_TRACE_FILE,
  validateTestManifest,
} from "../scripts/run-test-manifest.mjs";
import { executeSandboxCommands } from "../scripts/run-tests-sandbox.mjs";
import { testManifest } from "./test-manifest.mjs";

type MutableManifest = {
  version: number;
  commands: Array<{ id: string; executable: string; argv: string[]; extra?: boolean }>;
  groups: Record<string, string[]>;
  extra?: boolean;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const expectedLifecycleScripts = {
  pretest: "node scripts/run-test-manifest.mjs --group pretest",
  test: "node scripts/run-test-manifest.mjs --group application",
  posttest: "node scripts/run-test-manifest.mjs --group posttest",
};
const packageWiringMatches = Object.entries(expectedLifecycleScripts).every(
  ([name, command]) => packageJson.scripts[name] === command,
);

function mutableManifest(): MutableManifest {
  return structuredClone(testManifest) as MutableManifest;
}

function traceRecords(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("manifest validation rejects malformed authority", () => {
  assert.doesNotThrow(() => validateTestManifest(testManifest));

  const duplicate = mutableManifest();
  duplicate.commands.push(structuredClone(duplicate.commands[0]));
  assert.throws(() => validateTestManifest(duplicate), /Duplicate test command identifier/);

  const executor = mutableManifest();
  executor.commands[0].executable = "npm";
  assert.throws(() => validateTestManifest(executor), /Unsupported test executable/);

  const emptyArgv = mutableManifest();
  emptyArgv.commands[0].argv = [];
  assert.throws(() => validateTestManifest(emptyArgv), /non-empty string argv/);

  const unknownReference = mutableManifest();
  unknownReference.groups.application.push("missing-command");
  assert.throws(() => validateTestManifest(unknownReference), /references unknown command/);

  const storedAll = mutableManifest();
  storedAll.groups.all = [storedAll.commands[0].id];
  assert.throws(() => validateTestManifest(storedAll), /all group is derived/);

  const extraField = mutableManifest();
  extraField.commands[0].extra = true;
  assert.throws(() => validateTestManifest(extraField), /contain only id, executable, and argv/);
  assert.throws(() => resolveTestGroup(testManifest, "missing"), /Unknown test group/);
});

test("package lifecycle is wired to one manifest phase each", () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(expectedLifecycleScripts).map((name) => [name, packageJson.scripts[name]])),
    expectedLifecycleScripts,
  );
  assert.equal(packageJson.scripts["test:shift40"], undefined);
});

test(
  "npm lifecycle trace is identical to the direct derived all group",
  { skip: process.env.npm_execpath ? false : "requires an npm lifecycle" },
  () => {
    assert.equal(packageWiringMatches, true, "package lifecycle must be rewired before trace proof");
    const root = mkdtempSync(join(tmpdir(), "aria-test-manifest-"));
    const npmTrace = join(root, "npm.jsonl");
    const directTrace = join(root, "direct.jsonl");
    writeFileSync(npmTrace, "", { mode: 0o600 });
    writeFileSync(directTrace, "", { mode: 0o600 });
    try {
      const npmExecPath = process.env.npm_execpath;
      assert.ok(npmExecPath, "npm_execpath is required to prove lifecycle trace parity");
      const npmResult = spawnSync(process.execPath, [npmExecPath, "test", "--silent"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, [TEST_MANIFEST_TRACE_FILE]: npmTrace },
        shell: false,
      });
      assert.equal(npmResult.status, 0, npmResult.stderr || npmResult.stdout);
      const directResult = spawnSync(
        process.execPath,
        ["scripts/run-test-manifest.mjs", "--group", "all"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, [TEST_MANIFEST_TRACE_FILE]: directTrace },
        },
      );
      assert.equal(directResult.status, 0, directResult.stderr || directResult.stdout);
      assert.deepEqual(traceRecords(npmTrace), traceRecords(directTrace));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("canonical execution is shell-free and fail-fast", () => {
  const commands = resolveTestGroup(testManifest, "candidate-erasure");
  const calls: Array<{ executable: string; options: { shell?: boolean }; argv: string[] }> = [];
  const result = executeResolvedCommands(commands, {
    spawn: (executable: string, argv: string[], options: { shell?: boolean }) => {
      calls.push({ executable, argv, options });
      return { status: 1, signal: null };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, process.execPath);
  assert.deepEqual(calls[0].argv, ["--import", "tsx", ...commands[0].argv]);
  assert.equal(calls[0].options.shell, false);
});

test("sandbox execution is shell-free, keep-going, and still fails overall", () => {
  const commands = resolveTestGroup(testManifest, "candidate-erasure");
  const calls: Array<{ options: { shell?: boolean }; argv: string[] }> = [];
  const result = executeSandboxCommands(commands, {
    spawn: (_executable: string, argv: string[], options: { shell?: boolean }) => {
      calls.push({ argv, options });
      return {
        status: calls.length === 1 ? 1 : 0,
        signal: null,
        stdout: "",
        stderr: "",
      };
    },
    writeLine: () => undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.shell === false));
});
