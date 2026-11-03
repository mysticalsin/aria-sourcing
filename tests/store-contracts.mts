import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import type { WorkspaceActions as PublicWorkspaceActions } from "../src/lib/store";
import {
  WorkspaceProvider,
  useActions,
  useWorkspace,
  useHydrated,
} from "../src/lib/store";
import type {
  WorkspaceActions as ContractWorkspaceActions,
  WorkspaceContextValue,
} from "../src/lib/store/contracts";
import { buildImportGraph, graphCycles } from "./helpers/import-graph.mjs";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const publicContractMatches: Equal<PublicWorkspaceActions, ContractWorkspaceActions> = true;
const contextContractIncludesActions: ContractWorkspaceActions =
  null as unknown as WorkspaceContextValue["actions"];
void publicContractMatches;
void contextContractIncludesActions;

const storeSource = readFileSync(
  new URL("../src/lib/store.ts", import.meta.url),
  "utf8",
);
const contractsSource = readFileSync(
  new URL("../src/lib/store/contracts.ts", import.meta.url),
  "utf8",
);
const contractsAst = ts.createSourceFile(
  "contracts.ts",
  contractsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const storeAst = ts.createSourceFile(
  "store.ts",
  storeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

test("workspace hydration discards stale remote save authority before reload", () => {
  const start = storeSource.indexOf("const hydrateWorkspace = useCallback(async");
  const end = storeSource.indexOf("// Hydrate once on mount", start);
  const hydrateWorkspace = storeSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const reset of [
    "queuedRemoteSnapshot.current = null",
    "pendingRemoteSave.current = null",
    "remoteSaveOperation.current = null",
    "remoteSaveInFlight.current = false",
  ]) {
    assert.match(hydrateWorkspace, new RegExp(reset.replaceAll(".", "\\.")));
  }
});

function declaredName(node: { name?: ts.PropertyName }): string | null {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText();
}

function findInterface(name: string): ts.InterfaceDeclaration {
  const declaration = contractsAst.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  assert.ok(declaration, `${name} interface must exist in store contracts`);
  return declaration;
}

test("store keeps WorkspaceActions as a compatibility type export", () => {
  assert.match(
    storeSource,
    /export type \{ WorkspaceActions \} from ["']\.\/store\/contracts["'];/,
  );
  assert.doesNotMatch(storeSource, /export interface WorkspaceActions\s*\{/);
});

test("store contracts stay React-free and type-only", () => {
  assert.doesNotMatch(contractsSource, /["']use client["']/);
  assert.doesNotMatch(contractsSource, /from ["']react["']/);
  assert.doesNotMatch(contractsSource, /^import\s+(?!type\b)/m);
});

test("context contract preserves workspace recovery and recommendations", () => {
  assert.match(contractsSource, /workspaceStatus:\s*WorkspaceStatus/);
  assert.match(contractsSource, /retryWorkspace:\s*\(\) => Promise<void>/);
  assert.match(contractsSource, /retrySave:\s*\(\) => Promise<void>/);
  assert.match(contractsSource, /recommendations:\s*Recommendation\[\]/);
});

test("action contract, implementation object, and memo dependencies stay in parity", () => {
  const contractNames = findInterface("WorkspaceActions").members
    .map(declaredName)
    .filter((name): name is string => name !== null);

  let actionsDeclaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "actions"
    ) {
      actionsDeclaration = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(storeAst);
  assert.ok(actionsDeclaration?.initializer);
  assert.ok(ts.isCallExpression(actionsDeclaration.initializer));

  const [factory, dependencyList] = actionsDeclaration.initializer.arguments;
  assert.ok(factory && ts.isArrowFunction(factory));
  const factoryBody = ts.isParenthesizedExpression(factory.body)
    ? factory.body.expression
    : factory.body;
  assert.ok(ts.isObjectLiteralExpression(factoryBody));
  assert.ok(dependencyList && ts.isArrayLiteralExpression(dependencyList));

  const implementationNames = factoryBody.properties
    .map(declaredName)
    .filter((name): name is string => name !== null);
  const dependencyNames = dependencyList.elements.map((element) => element.getText());

  assert.equal(contractNames.length, 120);
  assert.deepEqual([...implementationNames].sort(), [...contractNames].sort());
  assert.deepEqual([...dependencyNames].sort(), [...contractNames].sort());
});

test("context contract keeps its exact public shape", () => {
  const contextNames = findInterface("WorkspaceContextValue").members
    .map(declaredName)
    .filter((name): name is string => name !== null)
    .sort();
  assert.deepEqual(contextNames, [
    "actions",
    "flushWorkspace",
    "hydrated",
    "recommendations",
    "retrySave",
    "retryWorkspace",
    "state",
    "workspaceStatus",
  ]);
});

function StoreHookProbe() {
  const context = useWorkspace();
  const actions = useActions();
  const hydrated = useHydrated();

  assert.strictEqual(actions, context.actions);
  assert.equal(
    context.state === null,
    true,
    "provider must not expose state during server render",
  );
  assert.equal(context.workspaceStatus.phase, "loading");
  assert.equal(hydrated, false);
  assert.equal(context.recommendations.length, 0);

  return createElement(
    "output",
    null,
    `${context.workspaceStatus.phase}:${String(hydrated)}:${Object.keys(actions).length}`,
  );
}

test("public hooks preserve their provider-bound initial behavior", () => {
  const markup = renderToStaticMarkup(
    createElement(WorkspaceProvider, null, createElement(StoreHookProbe)),
  );
  assert.equal(markup, "<output>loading:false:120</output>");
});

test("useWorkspace still rejects consumers outside WorkspaceProvider", () => {
  assert.throws(
    () => renderToStaticMarkup(createElement(StoreHookProbe)),
    /useWorkspace must be used within <WorkspaceProvider>\./,
  );
});

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

test("cycle detector identifies two-node and self cycles", () => {
  const first = join(sourceRoot, "__cycle_fixture_a.ts");
  const second = join(sourceRoot, "__cycle_fixture_b.ts");
  const self = join(sourceRoot, "__cycle_fixture_self.ts");
  const graph = new Map<string, Set<string>>([
    [first, new Set([second])],
    [second, new Set([first])],
    [self, new Set([self])],
  ]);
  assert.deepEqual(graphCycles(graph, sourceRoot), [
    ["__cycle_fixture_a.ts", "__cycle_fixture_b.ts"],
    ["__cycle_fixture_self.ts"],
  ]);
});

test("static import and re-export declaration graph remains acyclic", () => {
  const { graph } = buildImportGraph(sourceRoot, {
    includeTypeOnly: true,
    includeDynamic: false,
  });
  assert.deepEqual(graphCycles(graph, sourceRoot), []);
});

test("runtime import graph including dynamic imports remains acyclic", () => {
  const { graph, dynamicImportCount } = buildImportGraph(sourceRoot, {
    includeTypeOnly: false,
    includeDynamic: true,
  });
  assert.ok(
    dynamicImportCount > 0,
    "runtime cycle check must inspect at least one dynamic import",
  );
  assert.deepEqual(graphCycles(graph, sourceRoot), []);
});
