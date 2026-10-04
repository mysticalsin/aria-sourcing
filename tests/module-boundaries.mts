import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildImportGraph,
  graphCycles,
  type ImportGraph,
  isClientModule,
  isServerOnlyModule,
} from "./helpers/import-graph.mjs";

type BoundaryViolation = {
  from: string;
  rule: "client-to-server" | "components-to-app" | "lib-to-ui";
  to: string;
};

const repositorySourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function normalizedRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function reachableFrom(graph: ImportGraph, start: string): Set<string> {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const dependency of graph.get(current) ?? []) {
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      pending.push(dependency);
    }
  }
  return visited;
}

function findBoundaryViolations(sourceRoot: string): BoundaryViolation[] {
  const staticGraph = buildImportGraph(sourceRoot, {
    includeDynamic: true,
    includeTypeOnly: true,
  }).graph;
  const runtimeGraph = buildImportGraph(sourceRoot, {
    includeDynamic: true,
    includeTypeOnly: false,
  }).graph;
  const violations: BoundaryViolation[] = [];

  for (const [from, dependencies] of staticGraph) {
    const fromPath = normalizedRelative(sourceRoot, from);
    for (const to of dependencies) {
      const toPath = normalizedRelative(sourceRoot, to);
      if (fromPath.startsWith("lib/") && (toPath.startsWith("components/") || toPath.startsWith("app/"))) {
        violations.push({ from: fromPath, rule: "lib-to-ui", to: toPath });
      }
      if (fromPath.startsWith("components/") && toPath.startsWith("app/")) {
        violations.push({ from: fromPath, rule: "components-to-app", to: toPath });
      }
    }
  }

  for (const clientFile of [...runtimeGraph.keys()].filter(isClientModule)) {
    const clientReachableFiles = reachableFrom(runtimeGraph, clientFile);
    clientReachableFiles.add(clientFile);
    for (const dependency of clientReachableFiles) {
      if (!isServerOnlyModule(dependency, sourceRoot)) continue;
      violations.push({
        from: normalizedRelative(sourceRoot, clientFile),
        rule: "client-to-server",
        to: normalizedRelative(sourceRoot, dependency),
      });
    }
  }

  return violations.sort((left, right) =>
    `${left.rule}:${left.from}:${left.to}`.localeCompare(`${right.rule}:${right.from}:${right.to}`),
  );
}

function withFixture(
  files: Record<string, string>,
  run: (sourceRoot: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "aria-module-boundaries-"));
  const sourceRoot = join(root, "src");
  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(sourceRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
    run(sourceRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("synthetic poison fixtures expose cycles and every forbidden direction", () => {
  withFixture(
    {
      "app/page.ts": "export const page = true;\n",
      "components/client.ts": '"use client"; import "@/lib/neutral-bridge";\n',
      "components/direct-server.ts": '"use client"; import "server-only";\n',
      "components/to-app.ts": 'export { page } from "@/app/page";\n',
      "components/widget.ts": "export const widget = true;\n",
      "lib/cycle-a.ts": 'import "./cycle-b";\n',
      "lib/cycle-b.ts": 'import "./cycle-a";\n',
      "lib/mjs-cycle.mjs": 'import "./mjs-cycle.ts";\n',
      "lib/mjs-cycle.ts": 'import "./mjs-cycle.mjs";\n',
      "lib/neutral-bridge.ts": 'import "@/lib/server/secret";\n',
      "lib/server/secret.ts": 'import "server-only"; export const secret = true;\n',
      "lib/to-app.ts": 'import "@/app/page";\n',
      "lib/to-ui.ts": 'import "@/components/widget";\n',
    },
    (sourceRoot) => {
      const { graph } = buildImportGraph(sourceRoot, {
        includeDynamic: true,
        includeTypeOnly: true,
      });
      assert.deepEqual(graphCycles(graph, sourceRoot), [
        ["lib/cycle-a.ts", "lib/cycle-b.ts"],
        ["lib/mjs-cycle.mjs", "lib/mjs-cycle.ts"],
      ]);
      assert.deepEqual(findBoundaryViolations(sourceRoot), [
        { from: "components/client.ts", rule: "client-to-server", to: "lib/server/secret.ts" },
        { from: "components/direct-server.ts", rule: "client-to-server", to: "components/direct-server.ts" },
        { from: "components/to-app.ts", rule: "components-to-app", to: "app/page.ts" },
        { from: "lib/to-app.ts", rule: "lib-to-ui", to: "app/page.ts" },
        { from: "lib/to-ui.ts", rule: "lib-to-ui", to: "components/widget.ts" },
      ]);
    },
  );
});

test("repository import graph remains acyclic and respects module boundaries", () => {
  const { graph, dynamicImportCount } = buildImportGraph(repositorySourceRoot, {
    includeDynamic: true,
    includeTypeOnly: true,
  });
  assert.ok(dynamicImportCount > 0, "the boundary graph must inspect dynamic imports");
  assert.deepEqual(graphCycles(graph, repositorySourceRoot), []);
  assert.deepEqual(findBoundaryViolations(repositorySourceRoot), []);
});
