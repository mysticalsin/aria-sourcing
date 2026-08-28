import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const expectedNamedScripts = {
  "test:agent-framework": "node scripts/run-test-manifest.mjs --group framework",
  "test:agent-framework-adapter": "node scripts/run-test-manifest.mjs --group framework-adapter",
  "test:all": "node scripts/run-test-manifest.mjs --group all",
  "test:authority-regression": "node scripts/run-test-manifest.mjs --group authority-regression",
  "test:candidate-erasure": "node scripts/run-test-manifest.mjs --group candidate-erasure",
  "test:database": "node scripts/run-test-manifest.mjs --group database",
  "test:manifest": "tsx tests/test-manifest-contract.mts",
  "test:obscura": "node scripts/run-test-manifest.mjs --group obscura",
  "test:owner-recovery": "node scripts/run-test-manifest.mjs --group owner-recovery",
  "test:recovery": "node scripts/run-test-manifest.mjs --group recovery",
  "test:security": "node scripts/run-test-manifest.mjs --group security",
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

test("manifest preserves parity and freezes the exact deduplicated lifecycle", () => {
  assert.deepEqual(
    Object.fromEntries(
      ["pretest", "application", "posttest", "all"].map((group) => [
        group,
        resolveTestGroup(testManifest, group).length,
      ]),
    ),
    { pretest: 51, application: 181, posttest: 2, all: 234 },
  );
  const commands = resolveTestGroup(testManifest, "all");
  const commandLines = commands.map(({ executable, argv }) => `${executable} ${argv.join(" ")}`);
  assert.equal(
    createHash("sha256").update(commandLines.join("\n")).digest("hex"),
    "e635706b3c3569c12fd26dd2f6e0fd33be22174ad845fd067fc01c7455485b30",
  );
  assert.equal(new Set(commandLines).size, commandLines.length, "canonical lifecycle must be duplicate-free");
  assert.equal(
    commands.filter(({ id }) => id === "test-manifest-contract").length,
    1,
    "the manifest contract must be permanently registered exactly once",
  );
  assert.equal(
    commands.filter(({ id }) => id === "store-booking-report-actions").length,
    1,
    "the booking and report action runtime suite must be registered exactly once",
  );

  const parityApplication = resolveTestGroup(testManifest, "application")
    .filter(
      ({ id }) =>
        id !== "test-manifest-contract" && id !== "store-booking-report-actions",
    )
    .flatMap((command) => {
      const line = `${command.executable} ${command.argv.join(" ")}`;
      if (command.id === "agent-run-disabled") {
        return [
          line,
          "tsx tests/agent-framework-contract.mts",
          "tsx tests/agent-framework-clients.mts",
          "tsx tests/agent-framework-authority.mts",
        ];
      }
      if (command.id === "integration-authority") {
        return [line, "tsx tests/mcp-query-auth.mts"];
      }
      return [line];
    });
  const parityLines = [
    ...resolveTestGroup(testManifest, "pretest").map(
      ({ executable, argv }) => `${executable} ${argv.join(" ")}`,
    ),
    ...parityApplication,
    ...resolveTestGroup(testManifest, "posttest").map(
      ({ executable, argv }) => `${executable} ${argv.join(" ")}`,
    ),
  ];
  assert.equal(parityLines.length, 235);
  assert.equal(
    createHash("sha256").update(parityLines.join("\n")).digest("hex"),
    "d6a2a0748ef8cd59eb11a3d2e96fe7577551a99c3beeb97e2e2478bba2b23299",
    "deduplication must preserve the frozen pre-expansion baseline while registering new suites additively",
  );
  assert.ok(
    resolveTestGroup(testManifest, "application").some(
      ({ argv }) => argv.at(-1) === "tests/module-boundaries.mts",
    ),
  );
});

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
  assert.deepEqual(
    Object.fromEntries(Object.keys(expectedNamedScripts).map((name) => [name, packageJson.scripts[name]])),
    expectedNamedScripts,
  );
  assert.equal(packageJson.scripts["test:shift40"], undefined);
});

test("named manifest groups freeze their recursive baselines", () => {
  const expected = {
    security: [29, "a3739eec6d0eaabfa5455ce2d46edf3cee81e40d277740be762fdaa18dd2c0f0"],
    framework: [16, "2d9fa255f4c284f3701105080f02ed2369bfb7ac71751d7c08616fff828a45be"],
    "framework-adapter": [1, "4228d976b2e63e34f97bf910208ffcf3263da48861744f187eef8781c5cb9f48"],
    "candidate-erasure": [2, "42ee1e6bf280c482f01bcfdb41d601ea8cdaaeb8891a210777901771f56212b7"],
    "owner-recovery": [2, "2ac6a4c9232561d07292eefd046f87d301995becd14048d270972adcbc14ded3"],
    database: [19, "248a4100e0250536203332135461d417124fde3cbe5b4d9c8e6edec81d26d4de"],
    recovery: [2, "2ac6a4c9232561d07292eefd046f87d301995becd14048d270972adcbc14ded3"],
    obscura: [1, "c3fe29ff86819660733b568917fd0e39d09d275d94261387747da26da852f544"],
    "authority-regression": [9, "6e51deb44286815d3e0f6cf75e59a603b79da3823dfa876a0fc1c030e2b740a4"],
  } as const;
  for (const [group, [count, digest]] of Object.entries(expected)) {
    const commands = resolveTestGroup(testManifest, group);
    const lines = commands.map(({ executable, argv }) => `${executable} ${argv.join(" ")}`);
    assert.equal(commands.length, count, `${group} count`);
    assert.equal(createHash("sha256").update(lines.join("\n")).digest("hex"), digest, `${group} digest`);
  }
});

test("durable groups exactly cover every retired shift-40 process", () => {
  const retiredShiftProcesses = [
    "tsx tests/candidate-erasure-contract.mts",
    "node --experimental-test-module-mocks --import tsx --test tests/candidate-erasure-route.mts",
    "tsx tests/agent-memory-authority.mts",
    "tsx tests/agent-operational-authority.mts",
    "node --experimental-test-module-mocks --import tsx --test tests/agent-memory-route.mts tests/agent-memory-route-adversarial.mts",
    "node --test --test-reporter=spec infra/agent-frameworks/adapter/adapter.test.mjs infra/agent-frameworks/adapter/secret-preflight.test.mjs infra/agent-frameworks/model-gateway/gateway.test.mjs infra/agent-frameworks/deployment.test.mjs infra/agent-frameworks/fly/deployment.test.mjs",
    "bash tests/agent-memory-db.sh",
    "bash tests/agent-operational-authority-rollback-db.sh",
    "bash tests/candidate-erasure-db.sh",
  ];
  assert.equal(
    createHash("sha256").update(retiredShiftProcesses.join("\n")).digest("hex"),
    "6e51deb44286815d3e0f6cf75e59a603b79da3823dfa876a0fc1c030e2b740a4",
  );
  const durableProcesses = new Set(
    [
      "application",
      "security",
      "framework",
      "framework-adapter",
      "candidate-erasure",
      "database",
      "recovery",
      "authority-regression",
    ].flatMap((group) =>
      resolveTestGroup(testManifest, group).map(
        ({ executable, argv }) => `${executable} ${argv.join(" ")}`,
      ),
    ),
  );
  assert.deepEqual(
    retiredShiftProcesses.filter((command) => !durableProcesses.has(command)),
    [],
  );
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
